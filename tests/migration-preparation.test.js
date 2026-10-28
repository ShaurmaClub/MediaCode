import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('WAL legacy preparation preserves users, sessions, config and uploads; trials never mutate source', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-legacy-'));
  const legacy = path.join(scratch, 'legacy');
  const output = path.join(scratch, 'bundle');
  const file = path.join(legacy, 'data/media.db');
  const envFile = path.join(legacy, '.env');
  const uploads = path.join(legacy, 'uploads');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(path.join(uploads, 'recruitment'), { recursive: true });
  fs.writeFileSync(path.join(uploads, 'recruitment/private.pdf'), '%PDF-synthetic');
  const secret = crypto.randomBytes(32).toString('hex');
  const originalEnv = `SESSION_SECRET=${secret}\nDB_PATH=./data/media.db\nNODE_ENV=production\n`;
  fs.writeFileSync(envFile, originalEnv);
  const dbCode = path.join(process.env.LEGACY_CODE_DIR || root, 'server/db.js');
  const initialize = spawnSync(process.execPath, ['--input-type=module', '-e', `const m=await import(${JSON.stringify(pathToFileURL(dbCode).href)}); m.seed(); m.default.close();`], {
    encoding: 'utf8', env: { ...process.env, DB_PATH: file, NODE_ENV: 'test' }, cwd: legacy,
  });
  assert.equal(initialize.status, 0, initialize.stderr);
  const live = new Database(file);
  try {
    live.pragma('journal_mode = WAL');
    live.pragma('wal_autocheckpoint = 0');
    live.prepare('UPDATE users SET bio=? WHERE id=1').run('synthetic-WAL-only-record');
    live.exec('CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT, expires INTEGER)');
    live.prepare('INSERT OR REPLACE INTO sessions VALUES (?, ?, ?)').run('synthetic-session', '{"user":{"id":1}}', 9999999999999);
    const before = live.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    const args = ['deploy/migrate-existing.mjs', '--legacy-dir', legacy, '--db', file, '--env', envFile,
      '--uploads', uploads, '--output', output, '--service', 'mediacode', '--port', '4000'];
    const run = (mode) => spawnSync(process.execPath, [...args, mode], { cwd: root, encoding: 'utf8' });
    const dry = run('--dry-run');
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(fs.existsSync(output), false);
    assert.equal(dry.stdout.includes(secret), false);
    const prepare = run('--apply');
    assert.equal(prepare.status, 0, prepare.stderr);
    assert.equal(prepare.stdout.includes(secret), false);
    assert.equal(fs.readFileSync(envFile, 'utf8'), originalEnv);
    assert.equal(fs.readFileSync(path.join(output, 'backup/.env'), 'utf8'), originalEnv);
    assert.equal(live.prepare('SELECT COUNT(*) AS n FROM users').get().n, before);
    const backup = new Database(path.join(output, 'backup/media.db'), { readonly: true });
    assert.equal(backup.prepare('SELECT bio FROM users WHERE id=1').get().bio, 'synthetic-WAL-only-record');
    assert.equal(backup.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
    backup.close();
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json')));
    assert.deepEqual(manifest.snapshot.counts, manifest.migrated.counts);
    assert.equal(manifest.productionChanged, false);
    assert.equal(fs.readFileSync(path.join(output, 'backup/uploads/recruitment/private.pdf'), 'utf8'), '%PDF-synthetic');
    const repeat = run('--apply');
    assert.equal(repeat.status, 10);
    assert.match(repeat.stderr, /already exists/);
  } finally {
    live.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
