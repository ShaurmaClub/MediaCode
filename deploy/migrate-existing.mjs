#!/usr/bin/env node
// Preparation only: never stops services, changes the proxy, or opens production for writing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import Database from 'better-sqlite3';

const codeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flags = new Set(['--dry-run', '--apply', '--help']);
const names = new Set(['--legacy-dir', '--db', '--env', '--uploads', '--output', '--service', '--port']);
const options = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (flags.has(key)) options[key] = true;
  else if (names.has(key) && args[i + 1] && !args[i + 1].startsWith('--')) options[key] = args[++i];
  else { console.error(`Unknown or incomplete argument: ${key}`); process.exit(10); }
}
if (options['--help']) {
  console.log('node deploy/migrate-existing.mjs --dry-run|--apply --legacy-dir /old --db /old/data/media.db --env /old/.env --uploads /old/uploads --output /private/new-bundle --service mediacode --port 4000');
  process.exit(0);
}
function fail(message) { throw new Error(message); }
function abs(key) {
  const value = options[key];
  if (!value || !path.isAbsolute(value)) fail(`Explicit absolute path required: ${key}`);
  return path.resolve(value);
}
function digest(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function sizeTree(dir) {
  let size = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) fail(`Symlinks must be reviewed before migration: ${p}`);
    size += entry.isDirectory() ? sizeTree(p) : fs.statSync(p).size;
  }
  return size;
}
function databaseCheck(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') fail('SQLite integrity_check failed');
    const counts = {};
    for (const table of ['users', 'tasks', 'applications', 'points']) {
      counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    }
    return { version: db.pragma('user_version', { simple: true }), counts };
  } finally { db.close(); }
}
function manifestTree(dir, prefix = '') {
  const files = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(files, manifestTree(path.join(dir, entry.name), rel));
    else if (entry.isFile()) files[rel] = digest(path.join(dir, entry.name));
    else fail('Unsupported upload entry');
  }
  return files;
}
try {
  if (Boolean(options['--apply']) === Boolean(options['--dry-run'])) fail('Select exactly one of --dry-run or --apply');
  const legacy = fs.realpathSync(abs('--legacy-dir'));
  const dbPath = fs.realpathSync(abs('--db'));
  const envPath = fs.realpathSync(abs('--env'));
  const uploads = fs.realpathSync(abs('--uploads'));
  const output = abs('--output');
  if (!options['--service']?.match(/^[a-zA-Z0-9_.@-]+$/)) fail('Explicit --service required');
  const port = Number(options['--port']);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('Explicit valid --port required');
  if (!fs.statSync(legacy).isDirectory() || !fs.statSync(uploads).isDirectory()) fail('Missing installation/uploads directory');
  const original = fs.readFileSync(envPath);
  const env = dotenv.parse(original);
  if (!env.SESSION_SECRET) fail('SESSION_SECRET missing; do not generate a replacement during migration');
  if (!env.DB_PATH || path.resolve(legacy, env.DB_PATH) !== dbPath) fail('Explicit DB path disagrees with existing .env (review systemd overrides)');
  for (const key of ['UPLOAD_DIR', 'UPLOADS_DIR']) {
    if (env[key] && ![uploads, path.join(uploads, 'recruitment')].includes(path.resolve(legacy, env[key]))) fail(`${key} disagrees with explicit uploads root`);
  }
  if (fs.existsSync(output)) fail('Output already exists; every attempt needs a new bundle');
  let parent = path.dirname(output);
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  const resolvedOutput = path.join(fs.realpathSync(parent), path.relative(parent, output));
  for (const source of [legacy, uploads, path.dirname(dbPath)]) {
    if (resolvedOutput === source || resolvedOutput.startsWith(source + path.sep)) fail('Bundle must be outside legacy data/code');
  }
  if (/^\/(opt|var\/lib)\/mediacode\/(production|staging)(\/|$)/.test(resolvedOutput)) fail('Use a private scratch bundle, not a live contour');
  const size = sizeTree(uploads) + fs.statSync(dbPath).size + (fs.existsSync(dbPath + '-wal') ? fs.statSync(dbPath + '-wal').size : 0);
  const disk = fs.statfsSync(parent);
  if (disk.bavail * disk.bsize < size * 4 + 512 * 1024 ** 2) fail('Insufficient space for backup, trial restore and migration');
  const before = databaseCheck(dbPath);
  console.log(JSON.stringify({ mode: options['--apply'] ? 'prepare-only' : 'dry-run', legacy, db: dbPath,
    uploads, envFile: envPath, output, service: options['--service'], port,
    owners: { dbUid: fs.statSync(dbPath).uid, envMode: (fs.statSync(envPath).mode & 0o777).toString(8) },
    schema: before.version, counts: before.counts, wal: fs.existsSync(dbPath + '-wal'),
    warning: 'Online preparation is not a final coordinated snapshot. Re-snapshot after stopping writes at approved cutover.' }, null, 2));
  if (options['--dry-run']) process.exit(0);
  process.umask(0o077);
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const backup = path.join(output, 'backup');
  const trial = path.join(output, 'trial');
  fs.mkdirSync(backup, { mode: 0o700 });
  fs.mkdirSync(trial, { mode: 0o700 });
  const source = new Database(dbPath, { readonly: true, fileMustExist: true });
  try { await source.backup(path.join(backup, 'media.db')); } finally { source.close(); }
  const snapshot = databaseCheck(path.join(backup, 'media.db'));
  fs.copyFileSync(envPath, path.join(backup, '.env'), fs.constants.COPYFILE_EXCL);
  fs.cpSync(uploads, path.join(backup, 'uploads'), { recursive: true, errorOnExist: true });
  fs.copyFileSync(path.join(backup, 'media.db'), path.join(trial, 'media.db'));
  fs.cpSync(path.join(backup, 'uploads'), path.join(trial, 'uploads'), { recursive: true });
  const trialEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'production',
    ENV_FILE: path.join(trial, '.env'), DB_PATH: path.join(trial, 'media.db'),
    UPLOAD_DIR: path.join(trial, 'uploads', 'recruitment'), UPLOADS_DIR: path.join(trial, 'uploads', 'recruitment'),
    BACKUP_DIR: path.join(trial, 'backups'), SESSION_SECRET: env.SESSION_SECRET,
    HOST: '127.0.0.1', PORT: '0', AUTO_BACKUP: '0', DEPLOY_ENV: 'migration-trial' };
  // No integration tokens or original environment file are loaded by the trial.
  fs.writeFileSync(trialEnv.ENV_FILE, '', { mode: 0o600 });
  const run = spawnSync(process.execPath, [path.join(codeRoot, 'server/migrate.js'), '--verify'], {
    cwd: trial, env: trialEnv, encoding: 'utf8', timeout: 120000,
  });
  if (run.status !== 0) fail(`Trial migration failed (status ${run.status}); bundle retained for private investigation`);
  const migrated = databaseCheck(path.join(trial, 'media.db'));
  for (const [table, count] of Object.entries(snapshot.counts)) {
    if (migrated.counts[table] !== count) fail(`Trial changed ${table} count; manual review required`);
  }
  if (!fs.readFileSync(envPath).equals(original)) fail('Source config changed during preparation; repeat from new snapshot');
  const manifest = { createdAt: new Date().toISOString(), legacy, db: dbPath, uploads,
    service: options['--service'], port, snapshot, migrated, dbSha256: digest(path.join(backup, 'media.db')),
    uploadsSha256: manifestTree(path.join(backup, 'uploads')),
    configSha256: digest(path.join(backup, '.env')), hostname: os.hostname(),
    productionChanged: false, offServerCopyVerified: false, cutoverApproved: false };
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('Backup, isolated restore and trial schema migration verified. Production was not switched. Copy bundle off server before requesting cutover.');
} catch (err) {
  // Never emit child process output or configuration values here.
  console.error(`Migration blocked: ${err.message}`);
  process.exitCode = 10;
}
