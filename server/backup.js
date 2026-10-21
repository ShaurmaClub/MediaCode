/**
 * Резервное копирование SQLite-базы, пользовательских загрузок и метаданных релиза.
 *
 * Запуск вручную:        npm run backup
 * Перед деплоем:         node server/backup.js --with-uploads --reason=pre-deploy
 * Автоматически в фоне:  AUTO_BACKUP=1 в .env (раз в BACKUP_INTERVAL_HOURS, по умолчанию 24 ч)
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const pad = (n) => String(n).padStart(2, '0');

export function backupFileName(date = new Date()) {
  const d = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const t = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `media-${d}-${t}.db`;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function checkFreeDiskSpace(dir, minFreeMb = Number(process.env.BACKUP_MIN_FREE_MB || 100)) {
  if (typeof fs.statfsSync !== 'function') return { ok: true, freeMb: null };
  try {
    const stat = fs.statfsSync(dir);
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    const freeMb = Math.round(freeBytes / (1024 * 1024));
    return { ok: freeMb >= minFreeMb, freeMb, minFreeMb };
  } catch {
    return { ok: true, freeMb: null };
  }
}

function copyDirRecursive(srcDir, destDir) {
  const copiedFiles = [];
  if (!fs.existsSync(srcDir)) return copiedFiles;
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.gitkeep') continue;
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      const sub = copyDirRecursive(srcPath, destPath);
      copiedFiles.push(...sub.map((f) => path.join(entry.name, f)));
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      copiedFiles.push(entry.name);
    }
  }
  return copiedFiles;
}

export function rotateBackups(dir, keep) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^media-\d{8}-\d{6}\.db$/.test(f))
    .sort(); // имя содержит дату, поэтому лексикографический порядок = хронологический
  const toDelete = files.slice(0, Math.max(0, files.length - keep));
  for (const f of toDelete) {
    const base = f.replace(/\.db$/, '');
    const stamp = base.replace(/^media-/, '');
    const dbFile = path.join(dir, f);
    for (const extra of [
      dbFile,
      path.join(dir, `manifest-${stamp}.json`),
      path.join(dir, `${base}.manifest.json`),
      path.join(dir, `${base}.uploads.tar.gz`),
    ]) {
      if (fs.existsSync(extra)) fs.unlinkSync(extra);
    }
    for (const extraDir of [path.join(dir, `uploads-${stamp}`), path.join(dir, `${base}.uploads`)]) {
      if (fs.existsSync(extraDir)) fs.rmSync(extraDir, { recursive: true, force: true });
    }
  }
  return toDelete;
}

function syncOffsiteRestic(targetPaths, log = console) {
  const repo = process.env.RESTIC_REPOSITORY;
  if (!repo) {
    log.warn(
      '⚠️ [BACKUP] Внешнее хранилище (RESTIC_REPOSITORY) не настроено: локальные резервные копии НЕ защищают от полной потери сервера.'
    );
    return { configured: false, synced: false };
  }
  try {
    execFileSync('restic', ['backup', '--tag', 'mediacode', ...targetPaths], {
      stdio: 'pipe',
      timeout: 120_000
    });
    log.log(`✅ [BACKUP] Резервная копия отправлена во внешнее шифрованное хранилище restic (${repo})`);
    return { configured: true, synced: true };
  } catch (err) {
    throw new Error(`Ошибка отправки резервной копии во внешнее хранилище restic: ${err.message}`, {
      cause: err,
    });
  }
}

export async function runBackup(db, options = {}) {
  const dir = path.resolve(options.dir || process.env.BACKUP_DIR || './data/backups');
  const keep = Number(options.keep || process.env.BACKUP_KEEP || 14);
  const includeUploads = Boolean(options.includeUploads ?? (process.env.BACKUP_INCLUDE_UPLOADS !== '0'));
  const reason = options.reason || 'scheduled';
  const date = options.date || new Date();

  fs.mkdirSync(dir, { recursive: true });

  const space = checkFreeDiskSpace(dir);
  if (!space.ok) {
    throw new Error(
      `Недостаточно свободного места на диске для резервной копии: доступно ${space.freeMb} МБ, требуется минимум ${space.minFreeMb} МБ`
    );
  }

  const dbFileName = backupFileName(date);
  const baseName = dbFileName.replace(/\.db$/, '');
  const stamp = baseName.replace(/^media-/, '');
  const target = path.join(dir, dbFileName);

  // 1. Онлайн-бэкап SQLite (безопасен в режиме WAL при работающем сервере)
  await db.backup(target);

  // 2. Проверка целостности созданной копии БД и перевод снимка в однофайловый режим (без -wal/-shm)
  const verifyDb = new Database(target);
  let schemaVersion = 0;
  try {
    verifyDb.pragma('journal_mode = DELETE');
    const check = verifyDb.pragma('integrity_check', { simple: true });
    if (check !== 'ok') {
      throw new Error(`Проверка целостности резервной копии БД не пройдена: ${check}`);
    }
    schemaVersion = Number(verifyDb.pragma('user_version', { simple: true }) || 0);
  } finally {
    verifyDb.close();
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(`${target}${suffix}`)) {
        fs.unlinkSync(`${target}${suffix}`);
      }
    }
  }

  const dbStat = fs.statSync(target);
  const dbSha256 = sha256File(target);

  // 3. Копирование пользовательских файлов (если включено)
  const uploadSrcDir = path.resolve(
    options.uploadsDir ||
      options.uploadDir ||
      process.env.UPLOADS_DIR ||
      process.env.UPLOAD_DIR ||
      path.join(rootDir, 'uploads', 'recruitment')
  );
  let uploadsBundle = null;
  let uploadsBackupPath = null;
  let uploadsCount = 0;
  const targetPathsForOffsite = [target];

  if (includeUploads && fs.existsSync(uploadSrcDir)) {
    uploadsBackupPath = path.join(dir, `uploads-${stamp}`);
    const copied = copyDirRecursive(uploadSrcDir, uploadsBackupPath);
    uploadsCount = copied.length;
    uploadsBundle = `uploads-${stamp}`;
    targetPathsForOffsite.push(uploadsBackupPath);
  }

  // 4. Чтение метаданных текущего релиза
  let releaseMeta = {};
  try {
    const metaPath = path.join(rootDir, '.release-meta.json');
    if (fs.existsSync(metaPath)) {
      releaseMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    }
  } catch {
    // ignore
  }

  // 5. Опциональная синхронизация во внешнее хранилище (restic)
  const offsite = options.skipOffsite ? { configured: false, synced: false } : syncOffsiteRestic(targetPathsForOffsite, options.log || console);

  // 6. Сохранение манифеста метаданных для верифицируемого восстановления
  const manifestPath = path.join(dir, `manifest-${stamp}.json`);
  const manifest = {
    backupId: baseName,
    createdAt: date.toISOString(),
    reason: options.label || reason,
    environment: process.env.DEPLOY_ENV || process.env.APP_ENV || releaseMeta.env || process.env.NODE_ENV || 'development',
    releaseSha: process.env.APP_COMMIT_SHA || process.env.GIT_SHA || releaseMeta.sha || 'local',
    schemaVersion,
    dbFile: dbFileName,
    dbSize: dbStat.size,
    sha256: dbSha256,
    dbSha256,
    uploadsBundle,
    uploadsCount,
    offsiteProtected: offsite.synced
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  // 7. Ротация старых копий
  const removed = rotateBackups(dir, keep);
  return {
    ok: true,
    target,
    path: target,
    manifestPath,
    uploadsBackupPath,
    sha256: dbSha256,
    manifest,
    removed
  };
}

function notifyBackupFailure(errorMessage) {
  const notifyScript = path.join(rootDir, 'scripts', 'ci-notify.mjs');
  if (!fs.existsSync(notifyScript)) return;
  try {
    spawnSync(process.execPath, [notifyScript], {
      env: {
        ...process.env,
        CI_STATUS: 'failure',
        CI_STAGE: 'Backup & Disaster Recovery',
        CI_FAILED_STEPS: `Ошибка резервного копирования: ${errorMessage}`
      },
      stdio: 'inherit',
      timeout: 15_000
    });
  } catch {
    // Ошибка уведомления не должна скрывать ошибку бэкапа
  }
}

export function startAutoBackup(db, log = console) {
  if (process.env.AUTO_BACKUP !== '1') return null;
  const hours = Number(process.env.BACKUP_INTERVAL_HOURS || 24);
  const run = () =>
    runBackup(db, { reason: 'auto-timer', log })
      .then(({ target }) => log.log(`[backup] создана проверенная копия ${target}`))
      .catch((err) => {
        log.error('[backup] ошибка резервного копирования:', err.message);
        notifyBackupFailure(err.message);
      });
  const timer = setInterval(run, hours * 3600 * 1000);
  timer.unref();
  setTimeout(run, 30_000).unref();
  return timer;
}

// Запуск как CLI: node server/backup.js [--with-uploads] [--reason=pre-deploy]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { default: db } = await import('./db.js');
  const reasonArg = process.argv.find((a) => a.startsWith('--reason='))?.split('=')[1] || 'manual';
  const includeUploads = process.argv.includes('--with-uploads') || process.env.BACKUP_INCLUDE_UPLOADS !== '0';

  try {
    const { target, manifest, removed } = await runBackup(db, { reason: reasonArg, includeUploads });
    console.log(`✅ [BACKUP] Резервная копия создана и проверена: ${target}`);
    console.log(`   Схема БД: v${manifest.schemaVersion} | Релиз: ${manifest.releaseSha} | Файлов загрузок: ${manifest.uploadsCount} | SHA256: ${manifest.dbSha256.slice(0, 12)}...`);
    if (removed.length) console.log(`   Удалено старых копий по ротации: ${removed.length}`);
    process.exit(0);
  } catch (err) {
    console.error('❌ [BACKUP] Не удалось создать резервную копию:', err.message);
    notifyBackupFailure(err.message);
    process.exit(1);
  }
}
