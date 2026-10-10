import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('Reliability: health, backup, shared tracks', () => {
  let server;
  let tmpDir;

  before(async () => {
    fs.rmSync('./data/test_reliability.db', { force: true });
    process.env.NODE_ENV = 'test';
    process.env.DB_PATH = './data/test_reliability.db';
    process.env.PORT = '4011';
    process.env.SESSION_SECRET = 'test-secret';
    ({ server } = await import('../server/index.js'));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-backup-'));
  });

  after(() => {
    server?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('GET /api/health проверяет БД и отвечает ok', async () => {
    const res = await fetch('http://localhost:4011/api/health');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.db, 'ok');
  });

  test('runBackup создаёт валидную копию БД и ротирует старые', async () => {
    const { runBackup } = await import('../server/backup.js');
    const db = (await import('../server/db.js')).default;

    // заранее кладём «старые» копии, чтобы проверить ротацию
    for (const d of ['20200101-000001', '20200101-000002', '20200101-000003']) {
      fs.writeFileSync(path.join(tmpDir, `media-${d}.db`), 'old');
    }
    const { target, removed } = await runBackup(db, { dir: tmpDir, keep: 2 });

    assert.ok(fs.existsSync(target));
    assert.ok(fs.statSync(target).size > 0);
    assert.equal(removed.length, 2);
    assert.equal(fs.readdirSync(tmpDir).filter((f) => f.startsWith('media-')).length, 2);

    // копия действительно открывается и содержит пользователей
    const { default: Database } = await import('better-sqlite3');
    const copy = new Database(target, { readonly: true });
    const { c } = copy.prepare('SELECT COUNT(*) AS c FROM users').get();
    copy.close();
    assert.ok(c > 0);
  });

  test('серверный и клиентский конфиг направлений — один источник', async () => {
    const shared = await import('../shared/recruitmentTracks.js');
    const server_ = await import('../server/config/recruitmentTracks.js');
    assert.equal(server_.RECRUITMENT_TRACKS, shared.RECRUITMENT_TRACKS);
    assert.ok(shared.RECRUITMENT_TRACKS.length >= 6);
    for (const t of shared.RECRUITMENT_TRACKS) {
      assert.ok(t.slug && t.name && t.type, `у направления ${t.slug} не хватает полей`);
    }
  });
});
