import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

describe('RBAC: Role-based access control tests', () => {
  let serverInstance;
  const baseUrl = 'http://localhost:4021/api';

  before(async () => {
    fs.rmSync('./data/test_rbac.db', { force: true });
    process.env.NODE_ENV = 'test';
    process.env.DB_PATH = './data/test_rbac.db';
    process.env.PORT = '4021';
    process.env.SESSION_SECRET = 'test-secret-rbac';

    const { server } = await import('../server/index.js');
    serverInstance = server;
  });

  after(() => {
    serverInstance?.close();
    try {
      fs.rmSync('./data/test_rbac.db', { force: true });
    } catch {}
  });

  async function login(username, password) {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: username, password })
    });
    const cookie = res.headers.get('set-cookie');
    return { status: res.status, cookie };
  }

  test('Guest without session: GET protected endpoints return 401', async () => {
    const endpoints = ['/dashboard', '/tasks', '/audit'];
    for (const ep of endpoints) {
      const res = await fetch(`${baseUrl}${ep}`);
      assert.equal(res.status, 401, `Expected 401 for ${ep}`);
    }
  });

  test('STUDENT cannot access /api/audit (returns 403), ADMIN gets 200 array', async () => {
    const student = await login('student', 'Demo123!');
    assert.equal(student.status, 200);

    const studentAudit = await fetch(`${baseUrl}/audit`, {
      headers: { Cookie: student.cookie }
    });
    assert.equal(studentAudit.status, 403);

    const admin = await login('admin', 'Demo123!');
    assert.equal(admin.status, 200);

    const adminAudit = await fetch(`${baseUrl}/audit`, {
      headers: { Cookie: admin.cookie }
    });
    assert.equal(adminAudit.status, 200);
    const data = await adminAudit.json();
    assert.ok(Array.isArray(data));
  });

  test('STUDENT cannot access /api/recruitment/tracks (returns 403)', async () => {
    const student = await login('student', 'Demo123!');
    assert.equal(student.status, 200);

    const res = await fetch(`${baseUrl}/recruitment/tracks`, {
      headers: { Cookie: student.cookie }
    });
    assert.equal(res.status, 403);
  });
});
