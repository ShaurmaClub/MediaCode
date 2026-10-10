import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

describe('Public Recruitment portal tests', () => {
  let serverInstance;
  const baseUrl = 'http://localhost:4023/api';

  before(async () => {
    try { fs.rmSync('./data/test_pr.db', { force: true }); } catch {}
    process.env.NODE_ENV = 'test';
    process.env.DB_PATH = './data/test_pr.db';
    process.env.PORT = '4023';
    process.env.SESSION_SECRET = 'test-secret-pr';

    const { server } = await import('../server/index.js');
    serverInstance = server;
  });

  after(() => {
    serverInstance?.close();
    try { fs.rmSync('./data/test_pr.db', { force: true }); } catch {}
  });

  test('GET /api/public/recruitment/track/photo returns track details with slug and name', async () => {
    const res = await fetch(`${baseUrl}/public/recruitment/track/photo`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.track);
    assert.equal(data.track.slug, 'photo');
    assert.ok(data.track.name);
    assert.ok(Array.isArray(data.departments));
  });

  test('GET /api/public/recruitment/track/nonexistent returns 404', async () => {
    const res = await fetch(`${baseUrl}/public/recruitment/track/nonexistent_track_slug`);
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.ok(data.error);
  });

  test('POST /api/public/recruitment/apply/photo without consent/required fields returns 4xx (not 500)', async () => {
    const res = await fetch(`${baseUrl}/public/recruitment/apply/photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: 'Иван',
        phone: '+79991234567'
        // missing consent, last_name, etc.
      })
    });
    // Server should reject invalid application with client error 4xx
    assert.ok(res.status >= 400 && res.status < 500, `Expected 4xx, got ${res.status}`);
    const data = await res.json();
    assert.ok(data.error);
  });
});
