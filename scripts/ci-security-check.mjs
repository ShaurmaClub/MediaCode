#!/usr/bin/env node
/**
 * CI Security, Package & Build Integrity Gate
 * Проверяет:
 * 1. Отсутствие в git-индексе запрещённых файлов (.env, *.db, *.pem, *.key, id_rsa)
 * 2. Отсутствие утекших приватных ключей и токенов в исходном коде
 * 3. Согласованность package.json и package-lock.json + наличие защитных пакетов
 * 4. Точную проверку блокировки старта сервера в NODE_ENV=production со слабым SESSION_SECRET
 * 5. При флаге --verify-dist: целостность dist/, отсутствие .map и отсутствие утечек секретов в бандл
 */

import fs from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const verifyDistOnly = process.argv.includes('--verify-dist');

let failures = 0;

function pass(msg) {
  console.log(`✅ [SECURITY] ${msg}`);
}

function fail(msg) {
  console.error(`❌ [SECURITY] ${msg}`);
  failures += 1;
}

const SECRET_REGEXES = [
  { name: 'Private Key Header', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'GitHub PAT Token', re: /\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82})\b/ },
  { name: 'AWS Access Key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Telegram Bot Token', re: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/ }
];

function checkTrackedFilesAndSecrets() {
  let trackedFiles = [];
  try {
    const out = execFileSync('git', ['ls-files'], { cwd: rootDir, encoding: 'utf8' });
    trackedFiles = out.split(/\r?\n/).filter(Boolean);
  } catch (err) {
    fail(`Не удалось получить список файлов git ls-files: ${err.message}`);
    return;
  }

  const forbiddenPatterns = [
    { re: /(^|\/)\.env(\..+)?$/, allow: /(^|\/)\.env\.example$/, reason: 'Файл переменных окружения (.env)' },
    { re: /\.(db|sqlite|sqlite3)(-shm|-wal)?$/i, reason: 'Дамп базы данных SQLite' },
    { re: /\.(pem|key|p12|pfx)$/i, reason: 'Приватный криптографический ключ/сертификат' },
    { re: /(^|\/)id_(rsa|ed25519|ecdsa)$/i, reason: 'Приватный SSH-ключ' }
  ];

  for (const file of trackedFiles) {
    for (const rule of forbiddenPatterns) {
      if (rule.re.test(file) && (!rule.allow || !rule.allow.test(file))) {
        fail(`В git отслеживается запрещённый файл "${file}" (${rule.reason})`);
      }
    }
  }

  if (failures === 0) {
    pass(`Проверено ${trackedFiles.length} файлов в git: секретных .env, .db и приватных ключей не обнаружено`);
  }

  const scannableExts = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.yml', '.yaml', '.sh', '.conf', '.service']);
  let scannedCount = 0;

  for (const relFile of trackedFiles) {
    const ext = path.extname(relFile).toLowerCase();
    if (!scannableExts.has(ext) || relFile === 'package-lock.json') continue;
    const absPath = path.join(rootDir, relFile);
    if (!fs.existsSync(absPath)) continue;
    const content = fs.readFileSync(absPath, 'utf8');
    scannedCount += 1;

    for (const pattern of SECRET_REGEXES) {
      if (pattern.re.test(content)) {
        fail(`Обнаружен подозрительный паттерн (${pattern.name}) в файле ${relFile}`);
      }
    }
  }

  if (failures === 0) {
    pass(`Просканировано ${scannedCount} исходных файлов на утечки токенов и ключей`);
  }
}

function checkPackageAndLockfileIntegrity() {
  const pkgPath = path.join(rootDir, 'package.json');
  const lockPath = path.join(rootDir, 'package-lock.json');

  if (!fs.existsSync(pkgPath) || !fs.existsSync(lockPath)) {
    fail('Отсутствует package.json или package-lock.json');
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

  const requiredSecurityDeps = ['helmet', 'express-rate-limit', 'express-session', 'bcryptjs', 'zod'];
  for (const dep of requiredSecurityDeps) {
    if (!pkg.dependencies || !pkg.dependencies[dep]) {
      fail(`Отсутствует критическая зависимость безопасности: ${dep}`);
    }
  }

  if (!lock.lockfileVersion || lock.lockfileVersion < 2) {
    fail(`Устаревший формат package-lock.json (lockfileVersion=${lock.lockfileVersion})`);
    return;
  }

  // Проверяем согласованность спецификаторов зависимостей между package.json и package-lock.json (packages[""])
  const rootLockPkg = lock.packages && lock.packages[''];
  if (!rootLockPkg) {
    fail('В package-lock.json отсутствует корневой блок packages[""]');
    return;
  }

  const allDeclaredDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const allLockedDeps = { ...(rootLockPkg.dependencies || {}), ...(rootLockPkg.devDependencies || {}) };

  for (const [depName, depRange] of Object.entries(allDeclaredDeps)) {
    if (allLockedDeps[depName] !== depRange) {
      fail(`Рассинхронизация lock-файла для пакета "${depName}": в package.json="${depRange}", в package-lock.json="${allLockedDeps[depName]}"`);
    }
    if (!lock.packages[`node_modules/${depName}`]) {
      fail(`Пакет "${depName}" отсутствует в дереве node_modules внутри package-lock.json`);
    }
  }

  if (failures === 0) {
    pass('Согласованность package.json и package-lock.json, а также защитных пакетов (helmet, rate-limit, bcryptjs, zod) подтверждена');
  }
}

function checkProductionSecretGuardrail() {
  // Проверяем не просто ненулевой код выхода, а именно штатное срабатывание защиты SESSION_SECRET
  const probe = spawnSync(
    process.execPath,
    ['-e', "import('./server/app.js')"],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        SESSION_SECRET: 'change-me-insecure'
      },
      encoding: 'utf8',
      timeout: 10000
    }
  );

  const expectedErrorSubstring = 'CRITICAL ERROR: В режиме production переменная окружения SESSION_SECRET обязательна';
  const combinedOutput = `${probe.stdout || ''}\n${probe.stderr || ''}`;

  if (probe.status === 0) {
    fail('КРИТИЧЕСКАЯ ОШИБКА: сервер запустился в NODE_ENV=production с небезопасным SESSION_SECRET!');
  } else if (!combinedOutput.includes(expectedErrorSubstring)) {
    fail(
      `Проверка SESSION_SECRET завершилась с кодом ${probe.status}, но без ожидаемого сообщения защиты! Вывод: ${combinedOutput.trim()}`
    );
  } else {
    pass('Защита production-контура проверена: сервер блокирует старт со слабым SESSION_SECRET с точным сообщением ошибки');
  }
}

function checkDistBuild() {
  const distDir = path.join(rootDir, 'dist');
  const indexHtml = path.join(distDir, 'index.html');
  const assetsDir = path.join(distDir, 'assets');

  if (!fs.existsSync(indexHtml)) {
    fail('Не найден dist/index.html после сборки');
    return;
  }
  if (!fs.existsSync(assetsDir)) {
    fail('Не найден каталог dist/assets после сборки');
    return;
  }

  const assetFiles = fs.readdirSync(assetsDir);
  const hasJs = assetFiles.some((f) => f.endsWith('.js'));
  const hasCss = assetFiles.some((f) => f.endsWith('.css'));
  const hasSourceMaps = assetFiles.some((f) => f.endsWith('.map'));

  if (!hasJs || !hasCss) {
    fail('В dist/assets отсутствуют скомпилированные JS или CSS бандлы');
  }
  if (hasSourceMaps) {
    fail('В продакшн-сборке dist/assets обнаружены source-map файлы (*.map)');
  }

  // Сканируем собранные ассеты на случайное попадание серверных секретов/ключей
  for (const f of assetFiles) {
    if (!f.endsWith('.js') && !f.endsWith('.css') && !f.endsWith('.html')) continue;
    const content = fs.readFileSync(path.join(assetsDir, f), 'utf8');
    for (const pattern of SECRET_REGEXES) {
      if (pattern.re.test(content)) {
        fail(`В клиентском бандле dist/assets/${f} обнаружен секрет (${pattern.name})!`);
      }
    }
  }

  if (failures === 0) {
    pass(`Продакшн-бандл dist/ проверен (${assetFiles.length} ассетов, source-map и утечки секретов отсутствуют)`);
  }
}

try {
  if (verifyDistOnly) {
    checkDistBuild();
  } else {
    checkTrackedFilesAndSecrets();
    checkPackageAndLockfileIntegrity();
    checkProductionSecretGuardrail();
  }
} catch (err) {
  fail(`Непредвиденная ошибка выполнения проверки безопасности: ${err.message}`);
}

if (failures > 0) {
  console.error(`\n🚨 Проверка безопасности завершилась с ошибками (${failures}). Деплой заблокирован.`);
  process.exit(1);
}
