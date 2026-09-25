import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

describe('Privacy and Phone Logic Tests', () => {
  let serverInstance;
  let baseUrl;
  let adminCookie = '';

  before(async () => {
    const fs = await import('fs');
    try { fs.rmSync('./data/test_privacy.db', { force: true }); } catch {}
    process.env.NODE_ENV = 'test';
    process.env.DB_PATH = './data/test_privacy.db';
    process.env.PORT = '4007';
    process.env.SESSION_SECRET = 'test-secret';
    
    const { default: app, server } = await import('../server/index.js');
    serverInstance = server;
    baseUrl = 'http://localhost:4007/api';

    // Seed database
    const db = (await import('../server/db.js')).default;
    db.prepare("UPDATE users SET privacy_consent_at = NULL WHERE login = 'student'").run();

    const adminLogin = await fetch(baseUrl + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'admin', password: 'Demo123!' })
    });
    adminCookie = adminLogin.headers.get('set-cookie');
  });

  after(() => {
    if (serverInstance) serverInstance.close();
  });

  const apiCall = async (method, path, body = null, cookie = null) => {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers['Cookie'] = cookie;
    const res = await fetch(baseUrl + path, { method, headers, body: body ? JSON.stringify(body) : null });
    const data = await res.json().catch(() => null);
    return { status: res.status, data, cookie: res.headers.get('set-cookie') || cookie };
  };

  test('1-3. Phone formatting variants', async () => {
    const variants = [
      '+79001111111',
      '89002222222',
      '9003333333',
    ];

    for (const p of variants) {
      const res = await apiCall('POST', '/public/recruitment/apply/photo', {
        full_name: 'Тест Телефон', department: 'Учебное отделение «Моссовет»', group_name: 'Т-11',
        phone: p, phone_is_max: true, consent: true, portfolio_url: 'https://disk.yandex.ru/d/123', submission_url: 'https://disk.yandex.ru/d/123'
      });
      if(res.status!==201) console.log(res.data); assert.equal(res.status, 201, `Failed for phone ${p}`);
      
    }
  });

  test('4-6. Invalid phones reject', async () => {
    const badPhones = [
      '123123123123123', // too long
      '123', // too short
      'abc9001234567', // letters
    ];

    for (const p of badPhones) {
      const res = await apiCall('POST', '/public/recruitment/apply/photo', {
        full_name: 'Плохой Телефон', department: 'Учебное отделение «Моссовет»', group_name: 'Т-11',
        phone: p, phone_is_max: true, consent: true, portfolio_url: 'https://disk.yandex.ru/d/123', submission_url: 'https://disk.yandex.ru/d/123'
      });
      assert.equal(res.status, 400, `Expected 400 for phone ${p}`);
    }
  });

  test('7. Login continues to work for standard logins', async () => {
    const res = await apiCall('POST', '/auth/login', { login: 'admin', password: 'Demo123!' });
    assert.equal(res.status, 200);
  });

  test('8. Missing privacy consent blocks API', async () => {
    const res = await apiCall('POST', '/auth/login', { login: 'student', password: 'Demo123!' });
    assert.equal(res.status, 200);
    const studentCookie = res.cookie;

    // Check dashboard blocked
    const dash = await apiCall('GET', '/dashboard', null, studentCookie);
    assert.equal(dash.status, 403);
    assert.equal(dash.data.code, 'REQUIRES_CONSENT');
  });

  test('9, 10, 17. Consent saves, no 500 error, next login works', async () => {
    const loginRes = await apiCall('POST', '/auth/login', { login: 'student', password: 'Demo123!' });
    const studentCookie = loginRes.cookie;

    const rejectedConsent = await apiCall('POST', '/auth/privacy-consent', { consent_version: '2026-09' }, studentCookie);
    assert.equal(rejectedConsent.status, 400);
    const consentRes = await apiCall('POST', '/auth/privacy-consent', { consent: true, consent_version: '2026-09-25' }, studentCookie);
    assert.equal(consentRes.status, 200);
    assert.equal(consentRes.data.user.privacy_policy_version, '2026-09-25');

    // Dashboard works now
    const dash2 = await apiCall('GET', '/dashboard', null, studentCookie);
    assert.equal(dash2.status, 200);

    // Re-login does not require consent
    const reLogin = await apiCall('POST', '/auth/login', { login: 'student', password: 'Demo123!' });
    const newDash = await apiCall('GET', '/dashboard', null, reLogin.cookie);
    assert.equal(newDash.status, 200);
  });

  test('11, 12, 13, 14, 15. Recruitment consent visibility & RBAC', async () => {
    const r = await apiCall('POST', '/public/recruitment/apply/video', {
      full_name: 'Согласие Тест', department: 'Учебное отделение «Моссовет»', group_name: 'В-11',
      phone: '+79998887766', phone_is_max: true, consent: true, portfolio_url: 'https://disk.yandex.ru/d/123', submission_url: 'https://disk.yandex.ru/d/123'
    });
    if(r.status!==201) console.log(r.data); assert.equal(r.status, 201);
    
    const db = (await import('../server/db.js')).default;
    const appRec = db.prepare('SELECT id FROM recruitment_applications ORDER BY id DESC LIMIT 1').get();
    const appId = appRec.id;


    // Staff can see
    const staffLogin = await apiCall('POST', '/auth/login', { login: 'staff', password: 'Demo123!' });
    const staffApp = await apiCall('GET', `/recruitment/applications/${appId}`, null, staffLogin.cookie);
    assert.equal(staffApp.status, 200);
     // old API set '1.0', we set 'draft-2026-09'. Wait, we patched it to 'draft-2026-09'! Let's check!
    assert.equal(staffApp.data.application.consent_version, 'draft-2026-09');

    // Student cannot see
    const stuLogin = await apiCall('POST', '/auth/login', { login: 'student', password: 'Demo123!' });
    const stuApp = await apiCall('GET', `/recruitment/applications/${appId}`, null, stuLogin.cookie);
    assert.equal(stuApp.status, 403);
  });
  
  test('16. User without consent can logout successfully and loses session', async () => {
    // Temporarily revert consent
    const db = (await import('../server/db.js')).default;
    db.prepare("UPDATE users SET privacy_consent_at = NULL WHERE login = 'student'").run();

    // Login
    const loginRes = await apiCall('POST', '/auth/login', { login: 'student', password: 'Demo123!' });
    const studentCookie = loginRes.cookie;
    
    // Check dashboard blocked
    const dash = await apiCall('GET', '/dashboard', null, studentCookie);
    assert.equal(dash.status, 403);

    // Logout
    const logoutRes = await apiCall('POST', '/auth/logout', null, studentCookie);
    assert.equal(logoutRes.status, 200);

    // Dashboard completely 401 now
    const dashAfter = await apiCall('GET', '/dashboard', null, studentCookie);
    assert.equal(dashAfter.status, 401);
    });
});
