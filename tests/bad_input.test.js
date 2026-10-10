import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

describe('Bad Input & Error Handling tests', () => {
  let serverInstance;
  const baseUrl = 'http://localhost:4024/api';

  before(async () => {
    try { fs.rmSync('./data/test_bi.db', { force: true }); } catch {}
    process.env.NODE_ENV = 'test';
    process.env.DB_PATH = './data/test_bi.db';
    process.env.PORT = '4024';
    process.env.SESSION_SECRET = 'test-secret-bi';

    const { server } = await import('../server/index.js');
    serverInstance = server;
  });

  after(() => {
    serverInstance?.close();
    try { fs.rmSync('./data/test_bi.db', { force: true }); } catch {}
  });

  test('POST /api/auth/login with malformed JSON body returns 400', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"login": "admin", "password": ' // intentionally broken JSON
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error);
  });

  test('POST /api/auth/login with empty body returns 400', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error);
  });

  test('GET nonexistent /api/nope endpoint returns 404 with JSON error', async () => {
    const res = await fetch(`${baseUrl}/nope`);
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.ok(data.error);
  });
});
