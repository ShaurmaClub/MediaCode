import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve('./data/media.db');
const db = new Database(dbPath);

const np = '+79990000000';
let user = db.prepare('SELECT id FROM users WHERE phone = ?').get(np);
if (!user) {
  db.prepare(`
    INSERT INTO users (login, password_hash, role, first_name, last_name, phone, status, must_change_password)
    VALUES ('temp_test', '', 'STUDENT', 'Новый', 'Кандидат', ?, 'PENDING_ACTIVATION', 0)
  `).run(np);
  console.log('Inserted candidate: ' + np);
} else {
  db.prepare(`UPDATE users SET status = 'PENDING_ACTIVATION', password_hash = '' WHERE phone = ?`).run(np);
  console.log('Updated candidate: ' + np);
}
