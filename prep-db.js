import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';

const dbPath = path.resolve('./data/media.db');
const db = new Database(dbPath);

console.log('Cleaning up tasks...');
db.prepare('DELETE FROM applications').run();
db.prepare('DELETE FROM tasks').run();
db.prepare('DELETE FROM recruitment_applications').run();

console.log('Cleaning up users except basics...');
// Keep admin, staff, student if they exist. We'll just reset their passwords for easy testing, or create them.
const pw = bcrypt.hashSync('Demo123!', 10);

// We ensure admin
let admin = db.prepare('SELECT id FROM users WHERE login = ?').get('admin');
if (!admin) {
  db.prepare(`
    INSERT INTO users (login, password_hash, role, first_name, last_name, email, status, privacy_consent_at)
    VALUES (?, ?, 'ADMIN', 'Мария', 'Соколова (Админ)', 'admin@test.ru', 'ACTIVE', CURRENT_TIMESTAMP)
  `).run('admin', pw);
} else {
  db.prepare('UPDATE users SET password_hash = ? WHERE login = ?').run(pw, 'admin');
}

// We ensure staff
let staff = db.prepare('SELECT id FROM users WHERE login = ?').get('staff');
if (!staff) {
  db.prepare(`
    INSERT INTO users (login, password_hash, role, first_name, last_name, email, status, privacy_consent_at)
    VALUES (?, ?, 'STAFF', 'Алексей', 'Волков (Куратор)', 'staff@test.ru', 'ACTIVE', CURRENT_TIMESTAMP)
  `).run('staff', pw);
} else {
  db.prepare('UPDATE users SET password_hash = ? WHERE login = ?').run(pw, 'staff');
}

// We ensure student
let student = db.prepare('SELECT id FROM users WHERE login = ?').get('student');
if (!student) {
  db.prepare(`
    INSERT INTO users (login, password_hash, role, first_name, last_name, email, status, privacy_consent_at, group_name)
    VALUES (?, ?, 'STUDENT', 'Иван', 'Петров (Студент)', 'student@test.ru', 'ACTIVE', CURRENT_TIMESTAMP, 'ИСП-123')
  `).run('student', pw);
} else {
  db.prepare('UPDATE users SET password_hash = ? WHERE login = ?').run(pw, 'student');
}

// Create new test tasks
console.log('Creating test tasks...');
const insertTask = db.prepare(`
  INSERT INTO tasks (title, category, description, creator_id, required_volunteers, status, points, event_date, deadline, location)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const staffId = db.prepare('SELECT id FROM users WHERE login = ?').get('staff').id;

// Task 1: Open task
insertTask.run(
  'Тестовое мероприятие (Открыто)', 
  'PHOTOGRAPHY', 
  'Сделать 10 фотографий с линейки 1 сентября. Нужно прикрепить архив с фото.', 
  staffId, 
  3, 
  'OPEN', 
  20, 
  new Date(Date.now() + 86400000 * 4).toISOString(), 
  new Date(Date.now() + 86400000 * 5).toISOString(), 
  'Актовый зал'
);

// Task 2: Open task for video
insertTask.run(
  'Съемка интервью (Срочно)', 
  'VIDEOGRAPHY', 
  'Записать короткое видео с директором. Монтаж не требуется, только исходники.', 
  staffId, 
  1, 
  'OPEN', 
  30, 
  new Date(Date.now() + 86400000 * 1).toISOString(), 
  new Date(Date.now() + 86400000 * 2).toISOString(), 
  'Кабинет 101'
);

console.log('Done! DB is ready for manual testing.');
