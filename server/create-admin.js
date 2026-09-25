import bcrypt from 'bcryptjs';
import db from './db.js';

const login = String(process.env.ADMIN_LOGIN || '').trim().toLowerCase();
const rawPassword = String(process.env.ADMIN_PASSWORD || '');
const firstName = String(process.env.ADMIN_FIRST_NAME || 'Главный');
const lastName = String(process.env.ADMIN_LAST_NAME || 'Администратор');
if (!login || !rawPassword) throw new Error('ADMIN_LOGIN and ADMIN_PASSWORD are required.');
if (['admin', 'admin123', 'test', 'root'].includes(login) || rawPassword === 'Demo123!') throw new Error('Unsafe administrator credentials are not allowed.');
if (rawPassword.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters.');

const passwordHash = bcrypt.hashSync(rawPassword, 10);

const existing = db.prepare('SELECT id FROM users WHERE login = ?').get(login);

if (existing) {
  db.prepare(`
    UPDATE users
    SET password_hash = ?, role = 'ADMIN', status = 'ACTIVE', must_change_password = 0
    WHERE id = ?
  `).run(passwordHash, existing.id);
  console.log(`\n[МедиаКод] Администратор «${login}» успешно обновлён!`);
} else {
  db.prepare(`
    INSERT INTO users (login, password_hash, role, first_name, last_name, email, status, must_change_password)
    VALUES (?, ?, 'ADMIN', ?, ?, ?, 'ACTIVE', 0)
  `).run(login, passwordHash, firstName, lastName, `${login}@college.local`);
  console.log(`\n[МедиаКод] Администратор «${login}» успешно создан.`);
}

console.log(`Administrator login: ${login}`);
