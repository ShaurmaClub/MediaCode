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
  for (let i = 0; i < 12; i++) last = await request(annaSession, '/auth/change-password', 'POST', { currentPassword: 'wrong-password', newPassword: 'Whatever123!' });
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

