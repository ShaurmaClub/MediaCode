import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
test('CD gate matrix: absent, false, malformed flags, PRs and feature branches never deploy', () => {
  for (const [job, branch, variable] of [['staging', 'dev', 'CD_STAGING_ENABLED'], ['production', 'main', 'CD_PRODUCTION_ENABLED']]) {
    const block = workflow.split(`  deploy-${job}:`)[1].split('\n  #')[0];
    const expression = block.match(/^ {4}if: (.+)$/m)[1];
    assert.ok(expression.includes(`vars.${variable} == 'true'`));
    // Evaluate the actual small expression from YAML across events/refs/variables.
    const evaluate = new Function('github', 'vars', `return (${expression})`);
    for (const event of ['push', 'pull_request', 'workflow_dispatch']) {
      for (const ref of ['main', 'dev', 'fix/test']) {
        for (const flag of [undefined, '', 'false', 'TRUE', '1', 'true']) {
          assert.equal(evaluate({ event_name: event, ref: `refs/heads/${ref}` }, { [variable]: flag }),
            event === 'push' && ref === branch && flag === 'true');
        }
      }
    }
    assert.ok(block.includes(`name: ${job}`));
  }
  for (const job of ['security-and-packages', 'lint-and-build', 'tests']) {
    const block = workflow.split(`\n  ${job}:`)[1].split('\n  #')[0];
    assert.equal(block.includes('vars.CD_'), false);
  }
});

test('Rollback schema inspection is read-only, including incompatible future schemas', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-schema-test-'));
  try {
    const file = path.join(tmp, 'future.db');
    const db = new Database(file);
    db.exec('CREATE TABLE marker (n INTEGER); INSERT INTO marker VALUES (42); PRAGMA user_version=99;');
    db.close();
    const before = fs.readFileSync(file);
    const run = spawnSync(process.execPath, ['server/migrate.js', '--verify-rollback'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, DB_PATH: file, ENV_FILE: path.join(tmp, 'none') },
    });
    assert.equal(run.status, 2, run.stderr);
    assert.deepEqual(fs.readFileSync(file), before);
    assert.equal(fs.existsSync(file + '-wal'), false);
    const backup = spawnSync(process.execPath, ['server/backup.js'], {
      cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, DB_PATH: file,
        BACKUP_DIR: path.join(tmp, 'backups'), UPLOAD_DIR: path.join(tmp, 'uploads') },
    });
    assert.equal(backup.status, 0, backup.stderr);
    assert.deepEqual(fs.readFileSync(file), before, 'Backup CLI must not apply migrations to its source');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('Migration requires explicit mode and paths; never creates a guessed database', () => {
  const run = spawnSync(process.execPath, ['deploy/migrate-existing.mjs', '--apply'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 10);
  assert.match(run.stderr, /Explicit absolute path/);
  const bad = spawnSync(process.execPath, ['deploy/migrate-existing.mjs', '--apply', '--dry-run'], { cwd: root, encoding: 'utf8' });
  assert.equal(bad.status, 10);
});

test('Missing SSH deployment secrets fail with a named configuration error and no values', { skip: process.platform === 'win32' }, () => {
  const run = spawnSync('bash', ['deploy/validate-secrets.sh'], {
    cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH },
  });
  assert.equal(run.status, 10);
  assert.match(run.stderr, /missing SSH_HOST/);
});
