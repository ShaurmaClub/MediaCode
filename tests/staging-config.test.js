import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateStaging, STATE } from '../deploy/staging/config.mjs';
const valid = { APP_ENV: 'staging', NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '4001',
  DB_PATH: `${STATE}/data/media.db`, UPLOAD_DIR: `${STATE}/uploads/recruitment`,
  DOTENV_CONFIG_PATH: '/dev/null', SESSION_SECRET: 'a'.repeat(64) };
test('minimal staging accepts isolated paths only', () => {
  assert.doesNotThrow(() => validateStaging(valid));
  for (const [name, value] of Object.entries({ APP_ENV:'production', NODE_ENV:'development', HOST:'0.0.0.0',
    PORT:'4000', DB_PATH:'/srv/services/MediaCode/data/media.db', UPLOAD_DIR:'/srv/services/MediaCode/uploads',
    DOTENV_CONFIG_PATH:'/srv/services/MediaCode/.env', SESSION_SECRET:'weak', MAX_BOT_TOKEN:'credential',
    TELEGRAM_BOT_TOKEN:'credential', ALERT_WEBHOOK_URL:'https://example.invalid' })) {
    assert.throws(() => validateStaging({ ...valid, [name]: value }), undefined, name);
  }
});
test('unit and proxy target staging only, with no application write access to code', () => {
  const unit = fs.readFileSync(new URL('../deploy/staging/mediacode-stage.service', import.meta.url), 'utf8');
  assert.match(unit, /User=mediacode-stage/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /InaccessiblePaths=\/srv\/services\/MediaCode/);
  assert.doesNotMatch(unit, /ReadWritePaths=.*\/opt\//);
  const proxy = fs.readFileSync(new URL('../deploy/staging/Caddyfile.fragment', import.meta.url), 'utf8');
  assert.match(proxy, /stage\.kaiton\.ru \{/);
  assert.match(proxy, /reverse_proxy 127\.0\.0\.1:4001/);
  assert.match(proxy, /basic_auth/);
  assert.doesNotMatch(proxy, /127\.0\.0\.1:4000/);
});
test('staging app binds loopback, reads its DB and uses a distinct secure session cookie', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mediacode-stage-test-'));
  try {
    const script = `
      import assert from 'node:assert/strict';
      import { once } from 'node:events';
      import bcrypt from 'bcryptjs';
      const { default: db } = await import('./server/db.js');
      db.prepare("INSERT INTO users (login,password_hash,role,status) VALUES ('admin',?,'ADMIN','ACTIVE')")
        .run(bcrypt.hashSync('Synthetic-only-test!', 10));
      const { server } = await import('./server/index.js');
      if (!server.listening) await once(server, 'listening');
      try {
        assert.equal(server.address().address, '127.0.0.1');
        const base = 'http://127.0.0.1:' + server.address().port;
        const health = await (await fetch(base + '/api/health/ready')).json();
        assert.deepEqual(health, {ok:true, db:'ok', environment:'staging', commit:'a'.repeat(40)});
        const login = await fetch(base + '/api/auth/login', {method:'POST',
          headers:{'Content-Type':'application/json','X-Forwarded-Proto':'https'},
          body:JSON.stringify({login:'admin',password:'Synthetic-only-test!'})});
        assert.equal(login.status, 200);
        const cookie = login.headers.get('set-cookie');
        assert.match(cookie, /^mediacode\\.stage\\.sid=/);
        assert.doesNotMatch(cookie, /Domain=/i);
        assert.match(cookie, /HttpOnly/i);
        assert.match(cookie, /; Secure/i);
      } finally { await new Promise(resolve => server.close(resolve)); }
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: new URL('..', import.meta.url), timeout: 30000, encoding: 'utf8',
      env: { ...process.env, NODE_ENV:'production', SESSION_SECRET:'b'.repeat(64), APP_ENV:'staging', HOST:'127.0.0.1', PORT:'0',
        DB_PATH:':memory:', UPLOAD_DIR:temporary, APP_COMMIT:'a'.repeat(40), DOTENV_CONFIG_PATH:'.env.nonexistent' },
    });
    assert.equal(result.status, 0, result.stderr);
  } finally { fs.rmSync(temporary, { recursive:true, force:true }); }
});
test('bootstrap rejects a production DB before importing application code', () => {
  const result = spawnSync(process.execPath, ['deploy/staging/start.mjs'], {
    cwd:new URL('..', import.meta.url), encoding:'utf8', timeout:10000,
    env:{...process.env,...valid,DB_PATH:'/srv/services/MediaCode/data/media.db'},
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Staging configuration rejected: DB_PATH/);
});
