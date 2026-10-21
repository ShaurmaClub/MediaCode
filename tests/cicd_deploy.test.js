import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import request from 'supertest';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const tmpTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mediacode-cicd-test-'));
const testDbPath = path.join(tmpTestRoot, 'cicd-test.db');
const testUploadsDir = path.join(tmpTestRoot, 'uploads');
const testBackupDir = path.join(tmpTestRoot, 'backups');

fs.mkdirSync(testUploadsDir, { recursive: true });
fs.mkdirSync(testBackupDir, { recursive: true });

process.env.DB_PATH = testDbPath;
process.env.NODE_ENV = 'test';
process.env.DEPLOY_ENV = 'staging';
process.env.PORT = '0';

const { default: app, server } = await import('../server/index.js');
const { default: db, SCHEMA_VERSION, MIN_COMPATIBLE_SCHEMA_VERSION, getSchemaState } = await import('../server/db.js');
const { runBackup } = await import('../server/backup.js');
const { performRestore } = await import('../server/restore.js');
const { buildAlertPayload } = await import('../scripts/ci-notify.mjs');

describe('Production-Ready CI/CD, Migrations, Readiness & Backup/Restore Suite', () => {
  after(() => {
    try {
      server.close();
      db.close();
    } catch {
      // ignore
    }
    try {
      fs.rmSync(tmpTestRoot, { recursive: true, force: true });
    } catch {
      // ignore Windows EPERM on open handle during process exit
    }
  });

  it('1. Схема БД версионируется через schema_migrations и PRAGMA user_version', () => {
    const state = getSchemaState(db);
    assert.strictEqual(state.ok, true);
    assert.strictEqual(state.compatible, true);
    assert.strictEqual(state.currentVersion, SCHEMA_VERSION);
    assert.strictEqual(state.minCompatibleVersion, MIN_COMPATIBLE_SCHEMA_VERSION);
    assert.ok(Array.isArray(state.appliedMigrations));
    assert.ok(state.appliedMigrations.length >= 3, 'Должны быть зафиксированы минимум 3 миграции схемы');
  });

  it('2. server/migrate.js проверяет совместимость схемы и блокирует небезопасный rollback', () => {
    const migrateScript = path.join(rootDir, 'server', 'migrate.js');

    // Стандартная проверка совместимой БД проходит с кодом 0
    const okRun = spawnSync(process.execPath, [migrateScript, '--verify-rollback'], {
      env: { ...process.env, DB_PATH: testDbPath },
      encoding: 'utf-8',
    });
    assert.strictEqual(okRun.status, 0, `Ожидался код 0, получен ${okRun.status}: ${okRun.stderr}`);

    // Создаём изолированную БД с несовместимой будущей версией схемы (например v99)
    const futureDbPath = path.join(tmpTestRoot, 'future-schema.db');
    const futureDb = new Database(futureDbPath);
    futureDb.pragma('user_version = 99');
    futureDb.close();

    const failRun = spawnSync(process.execPath, [migrateScript, '--verify-rollback'], {
      env: { ...process.env, DB_PATH: futureDbPath },
      encoding: 'utf-8',
    });
    assert.strictEqual(
      failRun.status,
      2,
      'При несовместимой версии схемы (v99 > codeVersion) migrate.js --verify-rollback обязан блокировать откат с кодом 2',
    );
  });

  it('3. Эндпоинты /api/health, /api/health/live и /api/health/ready возвращают детальный статус', async () => {
    const liveRes = await request(app).get('/api/health/live');
    assert.strictEqual(liveRes.status, 200);
    assert.strictEqual(liveRes.body.ok, true);
    assert.strictEqual(liveRes.body.status, 'alive');

    const readyRes = await request(app).get('/api/health/ready');
    assert.strictEqual(readyRes.status, 200);
    assert.strictEqual(readyRes.body.ok, true);
    assert.strictEqual(readyRes.body.db, 'ok');
    assert.strictEqual(readyRes.body.schemaVersion, SCHEMA_VERSION);
    assert.strictEqual(readyRes.body.schemaCompatible, true);
    assert.strictEqual(typeof readyRes.body.frontendReady, 'boolean');
    assert.strictEqual(typeof readyRes.body.commit, 'string');

    const healthRes = await request(app).get('/api/health');
    assert.strictEqual(healthRes.status, 200);
    assert.strictEqual(healthRes.body.ok, true);
    assert.strictEqual(healthRes.body.db, 'ok');
  });

  it('4. Онлайн-бэкап создаёт проверенный снимок SQLite, копию uploads и манифест с SHA-256, а restore восстанавливает БД и файлы', async () => {
    // Подготовим тестовый файл в uploads и запись в БД
    const sampleUploadFile = path.join(testUploadsDir, 'avatar-sample.txt');
    fs.writeFileSync(sampleUploadFile, 'original-upload-content-v1', 'utf-8');

    db.prepare('UPDATE users SET bio = ? WHERE id = 1').run('bio-before-backup');

    const backupResult = await runBackup(db, {
      dir: testBackupDir,
      uploadsDir: testUploadsDir,
      keep: 5,
      label: 'predeploy',
    });

    assert.strictEqual(backupResult.ok, true);
    assert.ok(fs.existsSync(backupResult.path), 'Файл БД бэкапа должен существовать');
    assert.ok(fs.existsSync(backupResult.manifestPath), 'Манифест бэкапа должен существовать');
    assert.ok(fs.existsSync(backupResult.uploadsBackupPath), 'Копия каталога uploads должна существовать');
    assert.match(backupResult.sha256, /^[a-f0-9]{64}$/, 'Манифест должен содержать SHA-256 хеш снимка БД');

    // 4.1 Изолированный тестовый прогон восстановления (--test-restore) без остановки и модификации боевой БД
    const testRestoreResult = performRestore({
      backupFile: backupResult.path,
      backupDir: testBackupDir,
      targetDbPath: testDbPath,
      targetUploadsDir: testUploadsDir,
      testRestore: true,
    });
    assert.strictEqual(testRestoreResult.ok, true);
    assert.strictEqual(testRestoreResult.mode, 'test-restore');
    assert.strictEqual(testRestoreResult.schemaVersion, SCHEMA_VERSION);

    // 4.2 Проверка защиты от повреждённого бэкапа (несовпадение SHA-256 в манифесте)
    const manifestObj = JSON.parse(fs.readFileSync(backupResult.manifestPath, 'utf-8'));
    const validSha = manifestObj.sha256;
    manifestObj.sha256 = '0'.repeat(64);
    fs.writeFileSync(backupResult.manifestPath, JSON.stringify(manifestObj), 'utf-8');

    assert.throws(
      () =>
        performRestore({
          backupFile: backupResult.path,
          backupDir: testBackupDir,
          targetDbPath: testDbPath,
          targetUploadsDir: testUploadsDir,
          testRestore: true,
        }),
      /Несовпадение контрольной суммы SHA-256/,
      'Повреждённый бэкап должен блокироваться при проверке SHA-256',
    );

    // Возвращаем корректный SHA-256 в манифест
    manifestObj.sha256 = validSha;
    fs.writeFileSync(backupResult.manifestPath, JSON.stringify(manifestObj), 'utf-8');

    // 4.3 Полное восстановление БД и файлов во временный контур
    const isolatedTargetDir = path.join(tmpTestRoot, 'isolated-prod');
    const isolatedDbPath = path.join(isolatedTargetDir, 'data', 'media.db');
    const isolatedUploadsDir = path.join(isolatedTargetDir, 'uploads');
    fs.mkdirSync(path.dirname(isolatedDbPath), { recursive: true });
    fs.mkdirSync(isolatedUploadsDir, { recursive: true });

    // Имитируем испорченные/изменённые данные до восстановления
    fs.writeFileSync(path.join(isolatedUploadsDir, 'avatar-sample.txt'), 'corrupted-content', 'utf-8');
    fs.writeFileSync(path.join(isolatedUploadsDir, 'extra-unwanted.txt'), 'should-be-removed', 'utf-8');

    const fullRestoreResult = performRestore({
      backupFile: backupResult.path,
      backupDir: testBackupDir,
      targetDbPath: isolatedDbPath,
      targetUploadsDir: isolatedUploadsDir,
      testRestore: false,
      confirm: true,
    });

    assert.strictEqual(fullRestoreResult.ok, true);
    assert.strictEqual(fullRestoreResult.mode, 'full-restore');
    assert.strictEqual(
      fs.readFileSync(path.join(isolatedUploadsDir, 'avatar-sample.txt'), 'utf-8'),
      'original-upload-content-v1',
      'Содержимое файла в uploads должно быть точно восстановлено из бэкапа',
    );
    assert.strictEqual(
      fs.existsSync(path.join(isolatedUploadsDir, 'extra-unwanted.txt')),
      false,
      'Лишние файлы, отсутствовавшие в бэкапе, должны быть очищены при восстановлении',
    );

    const restoredDb = new Database(isolatedDbPath, { readonly: true });
    const row = restoredDb.prepare('SELECT bio FROM users WHERE id = 1').get();
    restoredDb.close();
    assert.strictEqual(row?.bio, 'bio-before-backup', 'Данные в SQLite должны соответствовать точке бэкапа');
  });

  it('5. Контракт CI/CD-скриптов: отсутствие скрытия ошибок, строгий SSH known_hosts и санитизация секретов в алертах', () => {
    const remoteDeploy = fs.readFileSync(path.join(rootDir, 'deploy', 'remote-deploy.sh'), 'utf-8');
    const ciWorkflow = fs.readFileSync(path.join(rootDir, '.github', 'workflows', 'ci.yml'), 'utf-8');

    assert.ok(!remoteDeploy.includes('DEPLOY_MODE'), 'В remote-deploy.sh не должно быть неоднозначного DEPLOY_MODE=auto');
    assert.ok(remoteDeploy.includes('flock -n 9'), 'remote-deploy.sh должен защищать контур от параллельных деплоев через flock');
    assert.ok(remoteDeploy.includes('exit 20'), 'Ошибка предрелизного бэкапа должна завершать деплой с кодом 20');
    assert.ok(remoteDeploy.includes('exit 30'), 'Откат после сбоя проверки должен возвращать код 30 (Failure в GitHub Actions)');
    assert.ok(remoteDeploy.includes('exit 31'), 'Авария отката должна возвращать код 31');

    assert.ok(ciWorkflow.includes('StrictHostKeyChecking=yes'), 'GitHub Actions обязан проверять подлинность SSH-сервера через StrictHostKeyChecking=yes');
    assert.ok(!ciWorkflow.includes('StrictHostKeyChecking=accept-new'), 'В CI/CD запрещено слепое доверие первому подключению');
    assert.ok(ciWorkflow.includes('permissions:\n  contents: read'), 'В ci.yml должны быть зафиксированы минимальные права GITHUB_TOKEN');

    // Проверка санитизации секретов в ci-notify.mjs
    const fakeSecret = 'super-secret-token-value-12345';
    process.env.SESSION_SECRET = fakeSecret;
    const payload = buildAlertPayload({
      eventType: 'rollback-success',
      status: 'failure',
      environment: 'production',
      failedSteps: `Failed with secret=${fakeSecret} and -----BEGIN OPENSSH PRIVATE KEY-----`,
    });
    assert.ok(!payload.plainText.includes(fakeSecret), 'Значения секретов должны маскироваться перед отправкой в Telegram/Webhook');
    assert.ok(!payload.plainText.includes('BEGIN OPENSSH PRIVATE KEY'), 'Приватные ключи должны вырезаться из уведомлений');
  });
});
