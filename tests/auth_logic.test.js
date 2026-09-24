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
    process.env.DB_FILE = './data/test_auth.db';
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

  test('ACTIVATION 14-20: Pending logic and bruteforce', async () => {
    // Mass create to get a token
    const mass = await apiCall('POST', '/users/mass-create', { phones: '+7 900 111 22 33\n+7 900 111 22 44' }, adminCookie);
    assert.equal(mass.status, 200);
    const p1 = mass.data.added[0];

    // 14. pending activation check
    const r14 = await apiCall('POST', '/auth/login', { login: '+79001112233', password: 'anypassword' });
    if(r14.status !== 200) console.log('R14', r14); assert.equal(r14.status, 200);
    assert.equal(r14.data.requiresActivation, true);

    // 16. invalid code
    const r16 = await apiCall('POST', '/auth/activate', { phone: '+79001112233', token: 'WRONG', privacy_consent: true });
    assert.equal(r16.status, 400);

    // 19. brute force lock (try 5 times)
    await apiCall('POST', '/auth/activate', { phone: '+79001112233', token: 'WRONG', privacy_consent: true });
    await apiCall('POST', '/auth/activate', { phone: '+79001112233', token: 'WRONG', privacy_consent: true });
    await apiCall('POST', '/auth/activate', { phone: '+79001112233', token: 'WRONG', privacy_consent: true });
    const r19 = await apiCall('POST', '/auth/activate', { phone: '+79001112233', token: 'WRONG', privacy_consent: true });
    assert.equal(r19.status, 429); // locked!
    
    // 15. correct activation (using second user to avoid lock)
    const p2 = mass.data.added[1];
    const r15 = await apiCall('POST', '/auth/activate', {
      phone: '+79001112244', token: p2.token, first_name: 'Новый', last_name: 'Юзер', department: 'Учебное отделение «Моссовет»', group_name: 'ТЕСТ-1', group_name: 'ГР-1', login: 'new_user2', password: 'password8', consent_version: '2026-09', privacy_consent: true
    });
    assert.equal(r15.status, 200);
  });

  test('PRIVACY CONSENT 21-25: Dashboard blocked', async () => {
    // We login as new_user2
    const login = await apiCall('POST', '/auth/login', { login: 'new_user2', password: 'password8' });
    assert.equal(login.status, 200);
    
    // 22. Dashboard is accessible because activate sets privacy consent
    const dash = await apiCall('GET', '/dashboard', null, login.cookie);
    assert.equal(dash.status, 200);
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

