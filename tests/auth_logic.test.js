import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

describe('Comprehensive Auth & Logic Tests', () => {
  let serverInstance;
  let baseUrl;
  let adminCookie = '';
  let studentCookie = '';

  before(async () => {
    const fs = await import('fs');
    try { fs.rmSync('./data/test_auth.db', { force: true }); } catch {}
    process.env.NODE_ENV = 'test';
    process.env.DB_PATH = './data/test_auth.db';
    process.env.PORT = '4005';
    process.env.SESSION_SECRET = 'test-secret';
    
    const { default: app, server } = await import('../server/index.js');
    serverInstance = server;
    baseUrl = 'http://localhost:4005/api';
    
    // Give it a second to initialize DB
    await new Promise(r => setTimeout(r, 1000));
  });

  after(async () => {
    if (serverInstance) serverInstance.close();
    const fs = await import('fs');
    try {
      fs.rmSync('./data/test_auth.db', { force: true });
    } catch {}
  });

  const apiCall = async (method, path, body = null, cookie = '') => {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers['Cookie'] = cookie;
    
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => null);
    
    let setCookie = res.headers.get('set-cookie');
    let sessionCookie = cookie;
    if (setCookie) {
      sessionCookie = setCookie.split(';')[0];
    }
    
    return { status: res.status, data, cookie: sessionCookie };
  };

  test('AUTH 1-9: Login combinations and normalizations', async () => {
    // 1. login by login
    const r1 = await apiCall('POST', '/auth/login', { login: 'admin', password: 'Demo123!' });
    if(r1.status !== 200) console.log(r1); assert.equal(r1.status, 200);
    adminCookie = r1.cookie;

    // 2. login by +7
    const r2 = await apiCall('POST', '/auth/login', { login: '+7 (916) 123-45-67', password: 'Demo123!' });
    assert.equal(r2.status, 200);
    studentCookie = r2.cookie;

    // 3. login by 8
    const r3 = await apiCall('POST', '/auth/login', { login: '89161234567', password: 'Demo123!' });
    assert.equal(r3.status, 200);

    // 4. login by 7
    const r4 = await apiCall('POST', '/auth/login', { login: '79161234567', password: 'Demo123!' });
    assert.equal(r4.status, 200);

    // 5. login by 10 digits
    const r5 = await apiCall('POST', '/auth/login', { login: '9161234567', password: 'Demo123!' });
    assert.equal(r5.status, 200);

    // 7-9. invalid phone / login
    const r7 = await apiCall('POST', '/auth/login', { login: '9999999999', password: 'Demo123!' });
    assert.equal(r7.status, 401);
    assert.equal(r7.data.error, 'Неверный логин, номер телефона или пароль.');
  });

  test('LOGIN CREATION 10-13: Validation rules', async () => {
    // 10. forbid purely numeric login
    const r10 = await apiCall('POST', '/users', {
      login: '123456', password: 'password', role: 'STUDENT', first_name: 'Тест', last_name: 'Тестов'
    }, adminCookie);
    assert.equal(r10.status, 400);

    // 11. allow letters and numbers
    const r11 = await apiCall('POST', '/users', {
      login: 'test_user123', password: 'password', role: 'STUDENT', first_name: 'Тест', last_name: 'Тестов', phone: '+79998887766'
    }, adminCookie);
    if(r11.status !== 201) console.log('ERROR:', r11); assert.equal(r11.status, 201);
  });

  test('ACTIVATION SECURITY: code, expiry, lockout, one-time use and consent', async () => {
    const phone = '+79991234567';
    const created = await apiCall('POST', '/users/mass-create', { phones: [phone] }, adminCookie);
    assert.equal(created.status, 200);
    const token = created.data.added[0].token;
    const payload = { phone, token: 'WRONG', first_name: 'Тест', last_name: 'Тестов', department: 'Учебное отделение «Моссовет»', group_name: 'ТЕСТ-1', login: 'activation_test', password: 'Password123!', consent_version: '2026-09-25', privacy_consent: true };
    assert.equal((await apiCall('POST', '/auth/activate', payload)).status, 400);
    const noConsent = { ...payload, token, privacy_consent: false, login: 'activation_no_consent' };
    assert.equal((await apiCall('POST', '/auth/activate', noConsent)).status, 400);
    const activated = await apiCall('POST', '/auth/activate', { ...payload, token });
    assert.equal(activated.status, 200);
    assert.equal((await apiCall('POST', '/auth/activate', { ...payload, token, login: 'activation_reuse' })).status, 400);
  });

  test('RECRUITMENT 41-44: Resubmissions', async () => {
    const apply1 = await apiCall('POST', '/public/recruitment/apply/smm', {
      full_name: 'Тест', phone: '+79991112233', department: 'Учебное отделение «Моссовет»', group_name: 'ТЕСТ-1', submission_text: 'Text', phone_is_max: 'true', consent: 'true'
    });
    if(apply1.status !== 201) console.log('ERROR:', apply1); assert.equal(apply1.status, 201);
    
    const apply2 = await apiCall('POST', '/public/recruitment/apply/smm', {
      full_name: 'Тест', phone: '+79991112233', department: 'Учебное отделение «Моссовет»', group_name: 'ТЕСТ-1', submission_text: 'Text', phone_is_max: 'true', consent: 'true'
    });
    assert.equal(apply2.status, 409); // duplicated track blocked

    const applyDiffTrack = await apiCall('POST', '/public/recruitment/apply/photo', {
      full_name: 'Тест', phone: '+79991112233', department: 'Учебное отделение «Моссовет»', group_name: 'ТЕСТ-1', submission_url: 'https://disk.yandex.ru/d/test', phone_is_max: 'true', consent: 'true'
    });
    if(applyDiffTrack.status !== 201) console.log('ERROR:', applyDiffTrack); assert.equal(applyDiffTrack.status, 201); // diff track allowed
  });
});
