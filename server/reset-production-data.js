import fs from 'fs';
import path from 'path';
import db from './db.js';

if (process.env.CONFIRM_PRODUCTION_RESET !== 'YES') {
  console.error('Refusing reset: set CONFIRM_PRODUCTION_RESET=YES.');
  process.exit(1);
}

const dbPath = process.env.DB_PATH || './data/media.db';
if (dbPath === ':memory:') throw new Error('A file-backed DB_PATH is required for reset.');
const absoluteDbPath = path.resolve(dbPath);
console.log(`DB_PATH: ${absoluteDbPath}`);

db.pragma('wal_checkpoint(FULL)');
const backupPath = `${absoluteDbPath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(absoluteDbPath, backupPath);
console.log(`Backup created: ${backupPath}`);

db.transaction(() => {
  for (const table of ['application_versions', 'applications', 'points', 'notifications', 'audit_logs', 'recruitment_files', 'recruitment_applications', 'sessions', 'tasks', 'users']) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
})();

console.log('User and test data cleared. Schema and migrations preserved.');
