import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.PORT = '0';
let db, server, base, admin, staff, student;
async function request(cookie, url, method = 'GET', body) {
  return fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie || '' }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function login(name) {
  const response = await request('', '/auth/login', 'POST', { login: name, password: 'Demo123!' });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}
before(async () => {
  ({ server } = await import('../server/index.js'));
  ({ default: db } = await import('../server/db.js'));
  base = `http://localhost:${server.address().port}/api`;
  admin = await login('admin'); staff = await login('staff'); student = await login('student');
});
after(() => { server.close(); db.close(); });
function task(owner, status = 'OPEN', deadline = null) {
  return Number(db.prepare('INSERT INTO tasks(title,creator_id,status,event_date,required_volunteers,deadline) VALUES(?,?,?,?,1,?)').run('Review regression', owner, status, '2099-01-01', deadline).lastInsertRowid);
}
const userId = name => db.prepare('SELECT id FROM users WHERE login=?').get(name).id;

test('Staff can collaborate: edit tasks and manage applicants created by other staff or admin', async () => {
  const id = task(userId('admin'));
  const application = Number(db.prepare("INSERT INTO applications(task_id,user_id,status) VALUES(?,?,'APPLIED')").run(id,userId('student')).lastInsertRowid);
  assert.equal((await request(staff, `/tasks/${id}`, 'PATCH', {title:'Changed'})).status,200);
  assert.equal((await request(staff, `/applications/${application}`, 'PATCH', {status:'SELECTED'})).status,200);
  assert.equal((await request(staff, `/tasks/${id}/complete`, 'POST', {user_id:userId('student')})).status,200);
  assert.equal((await request(staff, `/tasks/${id}`, 'DELETE')).status,200);
});
test('Capacity and completion workflow cannot be bypassed through status PATCH', async () => {
  const id = task(userId('staff'));
  const insert = db.prepare("INSERT INTO applications(task_id,user_id,status) VALUES(?,?,'APPLIED')");
  const first = Number(insert.run(id,userId('student')).lastInsertRowid);
  const second = Number(insert.run(id,userId('anna')).lastInsertRowid);
  assert.equal((await request(staff, `/applications/${first}`, 'PATCH', {status:'COMPLETED'})).status,400);
  assert.equal((await request(staff, `/applications/${first}`, 'PATCH', {status:'SELECTED'})).status,200);
  assert.equal((await request(staff, `/applications/${second}`, 'PATCH', {status:'SELECTED'})).status,409);
  assert.equal((await request(staff, `/applications/${first}`, 'PATCH', {status:'IN_PROGRESS'})).status,200);
  assert.equal((await request(staff, `/applications/${second}`, 'PATCH', {status:'SELECTED'})).status,409);
});
test('Expired applications and cancelled-task completion are rejected', async () => {
  const id = task(userId('staff'), 'OPEN', '2000-01-01');
  assert.equal((await request(student, `/tasks/${id}/apply`, 'POST', {})).status,400);
  db.prepare("UPDATE tasks SET status='CANCELLED' WHERE id=?").run(id);
  db.prepare("INSERT INTO applications(task_id,user_id,status) VALUES(?,?,'SELECTED')").run(id,userId('student'));
  assert.equal((await request(staff, `/tasks/${id}/complete`, 'POST', {user_id:userId('student')})).status,400);
});
test('Manual awards cannot counterfeit completion, accept fractions or reward staff', async () => {
  for (const body of [
    {user_id:userId('student'),amount:5,category:'COMPLETION'},
    {user_id:userId('student'),amount:1.5},
    {user_id:userId('staff'),amount:5},
    {user_id:userId('student'),amount:5,reason:{}},
  ]) assert.equal((await request(staff, '/points/award','POST',{reason:'Review',...body})).status,400);
});
test('Disabled accounts cannot mutate profile; reset invalidates previous sessions', async () => {
  const id = userId('student');
  db.prepare("UPDATE users SET status='DISABLED' WHERE id=?").run(id);
  assert.equal((await request(student,'/auth/profile','PATCH',{bio:'Forbidden'})).status,403);
  db.prepare("UPDATE users SET status='ACTIVE' WHERE id=?").run(id);
  assert.equal((await request(admin,`/users/${id}/reset-password`,'POST',{newPassword:'Replacement123!'})).status,200);
  assert.equal((await request(student,'/auth/first-login-password-change','POST',{newPassword:'Attacker123!'})).status,401);
});
test('Storage rejects sibling directories with matching prefix', async () => {
  const {default: storage} = await import('../server/storage.js');
  const {default: path} = await import('node:path');
  assert.throws(() => storage.getSafeFilePath(`../${path.basename(storage.getUploadDir())}-other/file.txt`));
  assert.doesNotThrow(() => storage.getSafeFilePath('material.pdf'));
});
test('Database rejects duplicate completion rewards while preserving ledger', () => {
  const id = task(userId('staff'));
  const insert = db.prepare("INSERT INTO points(user_id,task_id,amount,reason,category) VALUES(?,?,10,'Review','COMPLETION')");
  insert.run(userId('student'),id);
  assert.throws(() => insert.run(userId('student'),id), /Completion reward already exists/);
  assert.equal(db.prepare('SELECT SUM(amount) total FROM points WHERE task_id=?').get(id).total,10);
});

test('changing the password revokes the account\'s other sessions but keeps the current one', async () => {
  const current = await login('anna');
  const other = await login('anna');
  assert.equal((await request(other, '/auth/me')).status, 200);
  const change = await request(current, '/auth/change-password', 'POST', { currentPassword: 'Demo123!', newPassword: 'Changed123!' });
  assert.equal(change.status, 200);
  assert.equal((await request(other, '/auth/me')).status, 401);
  assert.equal((await request(current, '/auth/me')).status, 200);
  const revert = await request(current, '/auth/change-password', 'POST', { currentPassword: 'Changed123!', newPassword: 'Demo123!' });
  assert.equal(revert.status, 200);
});

test('password-change rate limit is per account, not one global bucket', async () => {
  const annaSession = await login('anna');
  let last;
  for (let i = 0; i < 13; i++) last = await request(annaSession, '/auth/change-password', 'POST', { currentPassword: 'wrong-password', newPassword: 'Whatever123!' });
  assert.equal(last.status, 429);
  const staffAttempt = await request(staff, '/auth/change-password', 'POST', { currentPassword: 'wrong-password', newPassword: 'Whatever123!' });
  assert.equal(staffAttempt.status, 400);
});

test('upload signature check rejects disguised files', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { hasValidSignature } = await import('../server/storage.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-'));
  const fake = path.join(dir, 'fake.jpg');
  const real = path.join(dir, 'real.jpg');
  fs.writeFileSync(fake, 'MZ this is an executable');
  fs.writeFileSync(real, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0]));
  assert.equal(hasValidSignature(fake, 'photo.jpg'), false);
  assert.equal(hasValidSignature(real, 'photo.jpg'), true);
  assert.equal(hasValidSignature(fake, 'notes.txt'), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('reversed completion reward allows re-confirming task completion while preserving ledger history', async () => {
  const taskId = task(userId('staff'));
  const studentId = userId('student');
  db.prepare("INSERT INTO applications(task_id, user_id, status) VALUES(?, ?, 'SELECTED')").run(taskId, studentId);

  const firstComplete = await request(staff, `/tasks/${taskId}/complete`, 'POST', { user_id: studentId, points: 15 });
  assert.equal(firstComplete.status, 200);

  const duplicateComplete = await request(staff, `/tasks/${taskId}/complete`, 'POST', { user_id: studentId, points: 15 });
  assert.equal(duplicateComplete.status, 409);

  const pointRow = db.prepare("SELECT id FROM points WHERE task_id = ? AND user_id = ? AND category = 'COMPLETION' AND COALESCE(is_reversed, 0) = 0").get(taskId, studentId);
  assert.ok(pointRow?.id);

  const reverseRes = await request(admin, `/points/${pointRow.id}/reverse`, 'POST', { reason: 'Ошибочная сумма баллов' });
  assert.equal(reverseRes.status, 200);

  const secondComplete = await request(staff, `/tasks/${taskId}/complete`, 'POST', { user_id: studentId, points: 25 });
  assert.equal(secondComplete.status, 200);

  const netTaskPoints = db.prepare('SELECT SUM(amount) as total, COUNT(*) as cnt FROM points WHERE task_id = ? AND user_id = ?').get(taskId, studentId);
  assert.equal(netTaskPoints.total, 25);
  assert.equal(netTaskPoints.cnt, 3);
});

test('approve-and-create-user parses 2-word FIO consistently, sets MEDIACODE_CONSENT_VERSION, and rejects duplicate phone with 409', async () => {
  const { MEDIACODE_CONSENT_VERSION } = await import('../server/lib/shared.js');
  const track = db.prepare('SELECT id FROM recruitment_tracks LIMIT 1').get();
  const phone = '+79998887766';

  const app1Id = Number(db.prepare(`
    INSERT INTO recruitment_applications (public_id, track_id, full_name, department, group_name, phone, max_contact, status, consent_accepted_at)
    VALUES ('MC-T-9001', ?, 'Иванов Иван', 'Учебное отделение «Техно»', 'ИС-21', ?, ?, 'SUBMITTED', CURRENT_TIMESTAMP)
  `).run(track.id, phone, phone).lastInsertRowid);

  const res1 = await request(staff, `/recruitment/applications/${app1Id}/approve-and-create-user`, 'POST', {});
  assert.equal(res1.status, 201);
  const body1 = await res1.json();
  assert.equal(body1.user.last_name, 'Иванов');
  assert.equal(body1.user.first_name, 'Иван');
  assert.equal(body1.user.privacy_policy_version, MEDIACODE_CONSENT_VERSION);

  // Second application with the same phone number must return 409 and not create another user
  const app2Id = Number(db.prepare(`
    INSERT INTO recruitment_applications (public_id, track_id, full_name, department, group_name, phone, max_contact, status, consent_accepted_at)
    VALUES ('MC-T-9002', ?, 'Иванов Иван Иванович', 'Учебное отделение «Техно»', 'ИС-21', ?, ?, 'SUBMITTED', CURRENT_TIMESTAMP)
  `).run(track.id, phone, phone).lastInsertRowid);

  const res2 = await request(staff, `/recruitment/applications/${app2Id}/approve-and-create-user`, 'POST', {});
  assert.equal(res2.status, 409);
  const usersWithPhone = db.prepare('SELECT COUNT(*) as c FROM users WHERE phone = ?').get(phone).c;
  assert.equal(usersWithPhone, 1);
});

test('safeUser uses precomputed stats without issuing extra N+1 SQL queries', async () => {
  const { safeUser, safeStudentView } = await import('../server/lib/shared.js');
  const row = db.prepare('SELECT * FROM users WHERE login = ?').get('student');

  let prepareCalls = 0;
  const origPrepare = db.prepare.bind(db);
  db.prepare = (...args) => {
    prepareCalls++;
    return origPrepare(...args);
  };
  try {
    const u1 = safeUser(row, { totalPoints: 42, completedTasksCount: 7 });
    const u2 = safeStudentView(row, { totalPoints: 42, completedTasksCount: 7 });
    assert.equal(u1.totalPoints, 42);
    assert.equal(u1.completedTasksCount, 7);
    assert.equal(u2.totalPoints, 42);
    assert.equal(u2.completedTasksCount, 7);
    assert.equal(prepareCalls, 0);
  } finally {
    db.prepare = origPrepare;
  }
});

test('task auto-transitions to ASSIGNMENT_IN_PROGRESS when occupied count (including IN_PROGRESS/COMPLETED) reaches required_volunteers', async () => {
  const taskId = Number(db.prepare("INSERT INTO tasks(title, creator_id, status, event_date, required_volunteers) VALUES('Multi-slot task', ?, 'OPEN', '2099-01-01', 2)").run(userId('staff')).lastInsertRowid);
  const insertApp = db.prepare("INSERT INTO applications(task_id, user_id, status) VALUES(?, ?, ?)");
  insertApp.run(taskId, userId('student'), 'IN_PROGRESS');
  const secondAppId = Number(insertApp.run(taskId, userId('anna'), 'APPLIED').lastInsertRowid);

  const selectRes = await request(staff, `/applications/${secondAppId}`, 'PATCH', { status: 'SELECTED' });
  assert.equal(selectRes.status, 200);

  const updatedTask = db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId);
  assert.equal(updatedTask.status, 'ASSIGNMENT_IN_PROGRESS');
});

test('validateMaxInitData rejects expired or future auth_date and malformed hash before timingSafeEqual', async () => {
  const crypto = await import('node:crypto');
  const { validateMaxInitData } = await import('../server/max.js');
  const prevToken = process.env.MAX_BOT_TOKEN;
  process.env.MAX_BOT_TOKEN = 'test-max-bot-secret-token';

  function signMaxInitData(userObj, authDateSec) {
    const params = new URLSearchParams();
    params.set('auth_date', String(authDateSec));
    params.set('user', JSON.stringify(userObj));
    const checkKeys = [];
    for (const [k, v] of params.entries()) checkKeys.push(`${k}=${v}`);
    checkKeys.sort();
    const secretKey = crypto.createHmac('sha256', 'MAXMiniAppAuth').update(process.env.MAX_BOT_TOKEN).digest();
    const hash = crypto.createHmac('sha256', secretKey).update(checkKeys.join('\n')).digest('hex');
    params.set('hash', hash);
    return params.toString();
  }

  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const validInit = signMaxInitData({ id: 777, username: 'valid_user' }, nowSec - 60);
    assert.equal(validateMaxInitData(validInit).valid, true);

    // Older than 24 hours
    const expiredInit = signMaxInitData({ id: 777, username: 'valid_user' }, nowSec - 86401);
    assert.equal(validateMaxInitData(expiredInit).valid, false);

    // More than 5 minutes in the future
    const futureInit = signMaxInitData({ id: 777, username: 'valid_user' }, nowSec + 305);
    assert.equal(validateMaxInitData(futureInit).valid, false);

    // Non-hex or wrong length hash must not throw and must return valid: false
    const shortHashInit = `auth_date=${nowSec}&user=${encodeURIComponent(JSON.stringify({ id: 777 }))}&hash=abcd`;
    assert.equal(validateMaxInitData(shortHashInit).valid, false);

    const nonHexHashInit = `auth_date=${nowSec}&user=${encodeURIComponent(JSON.stringify({ id: 777 }))}&hash=${'z'.repeat(64)}`;
    assert.equal(validateMaxInitData(nonHexHashInit).valid, false);
  } finally {
    if (prevToken === undefined) delete process.env.MAX_BOT_TOKEN;
    else process.env.MAX_BOT_TOKEN = prevToken;
  }
});

test('max-mini-app rejects non-ACTIVE accounts, refuses unverified max_contact auto-link, and regenerates session', async () => {
  const dmitryId = userId('dmitry');
  // 1. Unverified max_contact cannot be auto-linked
  db.prepare('UPDATE users SET max_user_id = NULL, max_contact = ?, max_contact_verified = 0 WHERE id = ?').run('@unverified_dmitry', dmitryId);
  const unverifiedInit = `user=${encodeURIComponent(JSON.stringify({ id: 555001, username: 'unverified_dmitry' }))}&auth_date=1720000000&hash=mockhash`;
  const unverifiedRes = await request('', '/auth/max-mini-app', 'POST', { initData: unverifiedInit });
  assert.equal(unverifiedRes.status, 404);

  // 2. Disabled account with verified max_user_id gets 403
  db.prepare("UPDATE users SET max_user_id = '555001', max_contact_verified = 1, status = 'DISABLED' WHERE id = ?").run(dmitryId);
  const disabledRes = await request('', '/auth/max-mini-app', 'POST', { initData: unverifiedInit });
  assert.equal(disabledRes.status, 403);

  // 3. Active account succeeds and regenerates session cookie
  db.prepare("UPDATE users SET status = 'ACTIVE' WHERE id = ?").run(dmitryId);
  const activeRes = await request(student, '/auth/max-mini-app', 'POST', { initData: unverifiedInit });
  assert.equal(activeRes.status, 200);
  const newCookie = activeRes.headers.get('set-cookie')?.split(';')[0];
  assert.ok(newCookie);
  assert.notEqual(newCookie, student);
});

test('submit-completion rejects missing or unknown submission_method and accepts valid link submission atomically', async () => {
  const sofiaSession = await login('sofia');
  const taskId = task(userId('staff'));
  const stuId = userId('sofia');
  const appId = Number(db.prepare("INSERT INTO applications(task_id, user_id, status) VALUES(?, ?, 'SELECTED')").run(taskId, stuId).lastInsertRowid);

  // Missing submission_method must return 400 and not change status
  const emptyRes = await request(sofiaSession, `/tasks/${taskId}/submit-completion`, 'POST', { comment: 'No method' });
  assert.equal(emptyRes.status, 400);
  assert.equal(db.prepare('SELECT status FROM applications WHERE id = ?').get(appId).status, 'SELECTED');

  // Unknown submission_method with attached file must return 400 and delete the uploaded file
  const fs = await import('node:fs');
  const { default: storage } = await import('../server/storage.js');
  const beforeFiles = new Set(fs.readdirSync(storage.getUploadDir()));
  const form = new FormData();
  form.append('submission_method', 'invalid_method');
  form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'orphan.txt');
  const badFormRes = await fetch(`${base}/tasks/${taskId}/submit-completion`, {
    method: 'POST',
    headers: { Cookie: sofiaSession },
    body: form
  });
  assert.equal(badFormRes.status, 400);
  const afterFiles = fs.readdirSync(storage.getUploadDir()).filter(f => !beforeFiles.has(f));
  assert.equal(afterFiles.length, 0);

  // Valid link submission succeeds
  const validLinkRes = await request(sofiaSession, `/tasks/${taskId}/submit-completion`, 'POST', {
    submission_method: 'link',
    materials_url: 'https://disk.yandex.ru/d/valid_report',
    comment: 'Done'
  });
  assert.equal(validLinkRes.status, 200);
  assert.equal(db.prepare('SELECT status FROM applications WHERE id = ?').get(appId).status, 'COMPLETION_SUBMITTED');
});








test('failed logins from a stranger IP cannot lock the real admin out; limit message is in Russian', async () => {
  const attempt = (ip, password) => fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ login: 'admin', password })
  });
  let last;
  for (let i = 0; i < 13; i++) last = await attempt('203.0.113.10', 'wrong-password');
  assert.equal(last.status, 429);
  assert.match((await last.json()).error, /Слишком много попыток/);
  // Real owner from another IP is not affected
  assert.equal((await attempt('198.51.100.7', 'Demo123!')).status, 200);
});

