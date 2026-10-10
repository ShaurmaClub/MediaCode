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

test('Staff cannot edit or delete another creator’s task or manage their applicants', async () => {
  const id = task(userId('admin'));
  const application = Number(db.prepare("INSERT INTO applications(task_id,user_id,status) VALUES(?,?,'APPLIED')").run(id,userId('student')).lastInsertRowid);
  assert.equal((await request(staff, `/tasks/${id}`, 'PATCH', {title:'Changed'})).status,403);
  assert.equal((await request(staff, `/tasks/${id}`, 'DELETE')).status,403);
  assert.equal((await request(staff, `/applications/${application}`, 'PATCH', {status:'SELECTED'})).status,403);
  assert.equal((await request(staff, `/tasks/${id}/complete`, 'POST', {user_id:userId('student')})).status,403);
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
