/**
 * Резервное копирование SQLite-базы.
 *
 * Запуск вручную:  npm run backup
 * Автоматически:   AUTO_BACKUP=1 в .env (раз в BACKUP_INTERVAL_HOURS, по умолчанию 24 ч)
 *
 * Используется штатный online-backup better-sqlite3: копия консистентна даже при работающем сервере (WAL).
 * Хранятся последние BACKUP_KEEP копий (по умолчанию 14), старые удаляются.
 * Каталог копий: BACKUP_DIR (по умолчанию ./data/backups). Файлы *.db игнорируются git.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const pad = (n) => String(n).padStart(2, '0');

export function backupFileName(date = new Date()) {
  const d = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const t = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `media-${d}-${t}.db`;
}

export function rotateBackups(dir, keep) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^media-\d{8}-\d{6}\.db$/.test(f))
    .sort(); // имя содержит дату, поэтому лексикографический порядок = хронологический
  const toDelete = files.slice(0, Math.max(0, files.length - keep));
  for (const f of toDelete) fs.unlinkSync(path.join(dir, f));
  return toDelete;
}

export async function runBackup(db, options = {}) {
  const dir = path.resolve(options.dir || process.env.BACKUP_DIR || './data/backups');
  const keep = Number(options.keep || process.env.BACKUP_KEEP || 14);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, backupFileName());
  await db.backup(target);
  const removed = rotateBackups(dir, keep);
  return { target, removed };
}

export function startAutoBackup(db, log = console) {
  if (process.env.AUTO_BACKUP !== '1') return null;
  const hours = Number(process.env.BACKUP_INTERVAL_HOURS || 24);
  const run = () =>
    runBackup(db)
      .then(({ target }) => log.log(`[backup] создана копия ${target}`))
      .catch((err) => log.error('[backup] ошибка резервного копирования:', err.message));
  const timer = setInterval(run, hours * 3600 * 1000);
  timer.unref(); // не мешает процессу завершиться
  setTimeout(run, 30_000).unref(); // первая копия через 30 секунд после старта
  return timer;
}

// Запуск как CLI: node server/backup.js
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { default: db } = await import('./db.js');
  try {
    const { target, removed } = await runBackup(db);
    console.log(`Резервная копия создана: ${target}`);
    if (removed.length) console.log(`Удалено старых копий: ${removed.length}`);
    process.exit(0);
  } catch (err) {
    console.error('Не удалось создать резервную копию:', err.message);
    process.exit(1);
  }
}
