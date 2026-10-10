import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

describe('Leaderboard & Notifications tests', () => {
  let serverInstance;
  const baseUrl = 'http://localhost:4022/api';

  before(async () => {
    try { fs.rmSync('./data/test_ln.db', { force: true }); } catch {}
    process.env.NODE_ENV = 'test';
    process.env.DB_PATH = './data/test_ln.db';
    process.env.PORT = '4022';
    process.env.SESSION_SECRET = 'test-secret-ln';

    const { server } = await import('../server/index.js');
    serverInstance = server;
  });

  after(() => {
    serverInstance?.close();
    try { fs.rmSync('./data/test_ln.db', { force: true }); } catch {}
  });

  async function loginStudent() {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'student', password: 'Demo123!' })
    });
    return res.headers.get('set-cookie');
  }

  test('GET /api/leaderboard under authenticated student returns 200 and an array', async () => {
    const cookie = await loginStudent();
    assert.ok(cookie);

    const res = await fetch(`${baseUrl}/leaderboard`, {
      headers: { Cookie: cookie }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data));
  });

  test('GET /api/notifications under authenticated student returns 200 and notifications array', async () => {
    const cookie = await loginStudent();
    assert.ok(cookie);

    const res = await fetch(`${baseUrl}/notifications`, {
      headers: { Cookie: cookie }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    // фактическое поведение: сервер возвращает объект { notifications: rows, unreadCount }
    assert.ok(Array.isArray(data.notifications));
    assert.equal(typeof data.unreadCount, 'number');
  });
});
