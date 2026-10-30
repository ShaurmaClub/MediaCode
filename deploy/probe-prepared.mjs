#!/usr/bin/env node
// Private behavioral probe on an already migrated trial copy. Run with Docker --network none.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import Database from 'better-sqlite3';
const code = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let child;
let db;
try {
  if (!process.argv[2] || !path.isAbsolute(process.argv[2])) throw new Error('Explicit private bundle path required');
  const bundle = fs.realpathSync(process.argv[2]);
  const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json')));
  if (manifest.productionChanged !== false) throw new Error('Not a preparation bundle');
  const trial = fs.realpathSync(path.join(bundle, 'trial'));
  if (trial !== path.join(bundle, 'trial')) throw new Error('Trial must not be a symlink');
  const file = path.join(trial, 'media.db');
  if (fs.realpathSync(file) !== file) throw new Error('Trial DB must not be a symlink');
  const env = dotenv.parse(fs.readFileSync(path.join(bundle, 'backup/.env')));
  db = new Database(file, { fileMustExist: true });
  const user = db.prepare("SELECT id FROM users WHERE status='ACTIVE' ORDER BY id LIMIT 1").get();
  if (!user) throw new Error('No active account available for copied-session probe');
  const sid = 'migration-probe-' + crypto.randomBytes(20).toString('hex');
  const expires = Date.now() + 60000;
  db.prepare('INSERT INTO sessions(sid,data,expires) VALUES (?,?,?)').run(sid, JSON.stringify({
    cookie: { originalMaxAge: 60000, expires: new Date(expires).toISOString(), secure: true, httpOnly: true, sameSite: 'lax' },
    user: { id: user.id },
  }), expires);
  const childEnv = { PATH: process.env.PATH, NODE_ENV: 'production', DEPLOY_ENV: 'migration-trial', HOST: '127.0.0.1', PORT: '0',
    DB_PATH: file, ENV_FILE: path.join(trial, '.env'), SESSION_SECRET: env.SESSION_SECRET,
    UPLOAD_DIR: path.join(trial, 'uploads/recruitment'), UPLOADS_DIR: path.join(trial, 'uploads/recruitment'),
    BACKUP_DIR: path.join(trial, 'backups'), AUTO_BACKUP: '0' };
  child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { once } from 'node:events';
    const m=await import(${JSON.stringify(path.join(code, 'server/index.js'))});
    if(!m.server.listening) await once(m.server,'listening');
    process.send({port:m.server.address().port});
  `], { cwd: trial, env: childEnv, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Trial startup timeout')), 15000);
    child.once('message', (m) => { clearTimeout(timer); resolve(m.port); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Trial application exited')); });
  });
  const base = `http://127.0.0.1:${port}`;
  const readiness = await fetch(base + '/api/health/ready', { signal: AbortSignal.timeout(5000) });
  const ready = await readiness.json();
  if (!readiness.ok || !ready.ok || ready.db !== 'ok' || !ready.schemaCompatible || !ready.frontendReady) throw new Error('Trial readiness failed');
  const mac = crypto.createHmac('sha256', env.SESSION_SECRET).update(sid).digest('base64').replace(/=+$/, '');
  const me = await fetch(base + '/api/auth/me', { headers: { cookie: `connect.sid=${encodeURIComponent('s:' + sid + '.' + mac)}`, 'x-forwarded-proto': 'https' }, signal: AbortSignal.timeout(5000) });
  const body = await me.json();
  if (!me.ok || (body.id ?? body.user?.id) !== user.id) throw new Error('Copied-session format is incompatible');
  const hidden = await fetch(base + '/uploads/recruitment/private-probe', { signal: AbortSignal.timeout(5000) });
  if (hidden.status !== 404) throw new Error('Private upload path must be blocked');
  db.prepare('DELETE FROM sessions WHERE sid=?').run(sid);
  console.log('Private trial passed: readiness, SQLite sessions using preserved secret, auth/me and uploads deny. No personal fields logged. Password login remains a manual acceptance check.');
} catch (err) {
  console.error(`Private trial blocked: ${err.message}`);
  process.exitCode = 10;
} finally {
  child?.kill('SIGTERM');
  db?.close();
}
