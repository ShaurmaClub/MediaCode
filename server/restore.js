#!/usr/bin/env node
/**
 * Утилита проверяемого восстановления из резервной копии (Disaster Recovery).
 *
 * Режимы:
 *   1. Список доступных копий:
 *      node server/restore.js --list
 *   2. Тестовое изолированное восстановление БЕЗ затрагивания рабочей БД и файлов:
 *      node server/restore.js --backup=<имя_или_путь> --test-restore
 *   3. Боевое восстановление (требует остановленного приложения или вызывается через deploy/restore.sh):
 *      node server/restore.js --backup=<имя_или_путь> --confirm
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import { SCHEMA_VERSION, MIN_COMPATIBLE_SCHEMA_VERSION } from './config/schema.js';

if (process.env.ENV_FILE && fs.existsSync(process.env.ENV_FILE)) {
  dotenv.config({ path: process.env.ENV_FILE, quiet: true });
} else {
  dotenv.config({ quiet: true });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function copyDirRecursive(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return 0;
  fs.mkdirSync(destDir, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      count += copyDirRecursive(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
      count += 1;
    }
  }
  return count;
}

function findCompanionPaths(parentDir, base) {
  const stamp = base.replace(/^media-/, '');
  const manifestCandidates = [
    path.join(parentDir, `manifest-${stamp}.json`),
    path.join(parentDir, `${base}.manifest.json`),
  ];
  const uploadsCandidates = [
    path.join(parentDir, `uploads-${stamp}`),
    path.join(parentDir, `${base}.uploads`),
  ];
  const manifestPath = manifestCandidates.find((p) => fs.existsSync(p)) || null;
  const uploadsDir = uploadsCandidates.find((p) => fs.existsSync(p)) || null;
  return { manifestPath, uploadsDir };
}

export function listBackups(backupDir) {
  const dir = path.resolve(backupDir || process.env.BACKUP_DIR || './data/backups');
  if (!fs.existsSync(dir)) return [];
  const dbFiles = fs
    .readdirSync(dir)
    .filter((f) => /^media-\d{8}-\d{6}\.db$/.test(f))
    .sort()
    .reverse();

  return dbFiles.map((dbFile) => {
    const base = dbFile.replace(/\.db$/, '');
    const { manifestPath, uploadsDir } = findCompanionPaths(dir, base);
    let manifest = null;
    if (manifestPath) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch {
        manifest = null;
      }
    }
    return {
      backupId: base,
      dbPath: path.join(dir, dbFile),
      manifestPath,
      uploadsDir,
      manifest
    };
  });
}

export function resolveBackupEntry(backupSpec, backupDir) {
  const dir = path.resolve(backupDir || process.env.BACKUP_DIR || './data/backups');
  if (!backupSpec || backupSpec === 'latest') {
    const all = listBackups(dir);
    if (!all.length) throw new Error(`В каталоге ${dir} не найдено ни одной резервной копии`);
    return all[0];
  }

  const normalized = backupSpec.replace(/\.db$/, '').replace(/\.manifest\.json$/, '');
  const candidateDb = fs.existsSync(backupSpec) && backupSpec.endsWith('.db')
    ? path.resolve(backupSpec)
    : path.join(dir, `${path.basename(normalized)}.db`);

  if (!fs.existsSync(candidateDb)) {
    throw new Error(`Файл резервной копии БД не найден: ${candidateDb}`);
  }
  const base = path.basename(candidateDb, '.db');
  const parentDir = path.dirname(candidateDb);
  const { manifestPath, uploadsDir } = findCompanionPaths(parentDir, base);

  return {
    backupId: base,
    dbPath: candidateDb,
    manifestPath,
    uploadsDir,
    manifest: manifestPath ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null
  };
}

export function verifyBackupIntegrity(entry) {
  if (!fs.existsSync(entry.dbPath)) {
    throw new Error(`Отсутствует файл БД резервной копии: ${entry.dbPath}`);
  }

  const expectedHash = entry.manifest && (entry.manifest.sha256 || entry.manifest.dbSha256);
  if (expectedHash) {
    const actualHash = sha256File(entry.dbPath);
    if (actualHash !== expectedHash) {
      throw new Error(
        `Несовпадение контрольной суммы SHA-256 резервной копии ${entry.backupId}: ожидалась ${expectedHash}, получена ${actualHash}`
      );
    }
  }

  const checkDb = new Database(entry.dbPath, { readonly: true });
  try {
    const integrity = checkDb.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      throw new Error(`Повреждена структура SQLite в резервной копии: ${integrity}`);
    }
    const schemaVersion = Number(checkDb.pragma('user_version', { simple: true }) || 0);
    // Если копия создана до введения user_version, проверим наличие основных таблиц
    const tables = new Set(
      checkDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => r.name)
    );
    for (const reqTable of ['users', 'tasks', 'applications', 'points']) {
      if (!tables.has(reqTable)) {
        throw new Error(`В резервной копии отсутствует обязательная таблица: ${reqTable}`);
      }
    }
    if (schemaVersion > SCHEMA_VERSION) {
      throw new Error(
        `Схема резервной копии (v${schemaVersion}) новее текущего релиза кода (v${SCHEMA_VERSION}). Сначала обновите код до соответствующего релиза.`
      );
    }
    return {
      ok: true,
      backupId: entry.backupId,
      schemaVersion: schemaVersion || MIN_COMPATIBLE_SCHEMA_VERSION,
      usersCount: checkDb.prepare('SELECT COUNT(*) as c FROM users').get().c,
      tasksCount: checkDb.prepare('SELECT COUNT(*) as c FROM tasks').get().c
    };
  } finally {
    checkDb.close();
  }
}

export function performRestore(options = {}) {
  const {
    backupSpec = options.backupFile || 'latest',
    backupDir = process.env.BACKUP_DIR || './data/backups',
    targetDbPath = process.env.DB_PATH || './data/media.db',
    targetUploadDir = options.targetUploadsDir ||
      process.env.UPLOADS_DIR ||
      process.env.UPLOAD_DIR ||
      path.join(rootDir, 'uploads', 'recruitment'),
    testRestore = false
  } = options;

  const entry = resolveBackupEntry(backupSpec, backupDir);
  const verification = verifyBackupIntegrity(entry);

  if (testRestore) {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mediacode-test-restore-'));
    try {
      const tmpDb = path.join(tmpRoot, 'media.restored.db');
      const tmpUploads = path.join(tmpRoot, 'uploads');
      fs.copyFileSync(entry.dbPath, tmpDb);
      const restoredUploads = entry.uploadsDir ? copyDirRecursive(entry.uploadsDir, tmpUploads) : 0;

      // Проверяем открытие и запись в изолированную восстановленную копию
      const testConn = new Database(tmpDb);
      testConn.pragma('journal_mode = WAL');
      const integrity = testConn.pragma('quick_check', { simple: true });
      testConn.close();
      if (integrity !== 'ok') {
        throw new Error(`Тестовое восстановление не прошло quick_check: ${integrity}`);
      }

      return {
        mode: 'test-restore',
        ok: true,
        backupId: entry.backupId,
        schemaVersion: verification.schemaVersion,
        usersCount: verification.usersCount,
        tasksCount: verification.tasksCount,
        restoredUploads
      };
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }

  const resolvedDbPath = path.resolve(targetDbPath);
  const resolvedUploadDir = path.resolve(targetUploadDir);
  fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });

  // Если передан открытый дескриптор БД, корректно сбрасываем WAL и закрываем соединение перед заменой файла
  if (options.db && typeof options.db.close === 'function') {
    try {
      if (options.db.open) {
        options.db.pragma('wal_checkpoint(TRUNCATE)');
        options.db.close();
      }
    } catch {
      // ignore if already closed
    }
  }

  // Удаляем старые WAL/SHM файлы перед заменой файла БД
  for (const suffix of ['-wal', '-shm']) {
    const walFile = `${resolvedDbPath}${suffix}`;
    if (fs.existsSync(walFile)) fs.unlinkSync(walFile);
  }

  fs.copyFileSync(entry.dbPath, resolvedDbPath);

  let restoredUploads = 0;
  if (entry.uploadsDir && fs.existsSync(entry.uploadsDir)) {
    fs.rmSync(resolvedUploadDir, { recursive: true, force: true });
    fs.mkdirSync(resolvedUploadDir, { recursive: true });
    restoredUploads = copyDirRecursive(entry.uploadsDir, resolvedUploadDir);
  } else {
    fs.mkdirSync(resolvedUploadDir, { recursive: true });
  }

  return {
    mode: 'full-restore',
    ok: true,
    backupId: entry.backupId,
    restoredDbPath: resolvedDbPath,
    schemaVersion: verification.schemaVersion,
    usersCount: verification.usersCount,
    tasksCount: verification.tasksCount,
    restoredUploads
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    const list = listBackups();
    if (!list.length) {
      console.log('Резервные копии не найдены.');
      process.exit(0);
    }
    for (const item of list) {
      const m = item.manifest;
      console.log(
        `• ${item.backupId} | создана: ${m?.createdAt || 'н/д'} | схема: v${m?.schemaVersion ?? '?'} | релиз: ${m?.releaseSha || 'н/д'} | файлов: ${m?.uploadsCount ?? 0}`
      );
    }
    process.exit(0);
  }

  const backupSpec = args.find((a) => a.startsWith('--backup='))?.split('=')[1] || 'latest';
  const isTestRestore = args.includes('--test-restore') || args.includes('--dry-run');
  const isConfirmed = args.includes('--confirm');

  if (!isTestRestore && !isConfirmed) {
    console.error('❌ Укажите --test-restore (для безопасной проверки) или --confirm (для боевого восстановления).');
    process.exit(1);
  }

  try {
    const res = performRestore({ backupSpec, testRestore: isTestRestore });
    console.log(`✅ [RESTORE] Успешно (${res.mode}): копия ${res.backupId}`);
    console.log(`   Пользователей: ${res.usersCount} | Задач: ${res.tasksCount} | Файлов восстановлено: ${res.restoredUploads}`);
    process.exit(0);
  } catch (err) {
    console.error('❌ [RESTORE] Ошибка восстановления:', err.message);
    process.exit(1);
  }
}
