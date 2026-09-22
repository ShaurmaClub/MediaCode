import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import db from './db.js';

const args = process.argv.slice(2);
const login = (args[0] || 'admin').trim().toLowerCase();
const rawPassword = args[1] || ('MC_Adm_' + crypto.randomBytes(4).toString('hex') + '!');
const firstName = args[2] || 'Главный';
const lastName = args[3] || 'Администратор';

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
  console.log(`\n[МедиаКод] Администратор «${login}» успешно создан!`);
}

console.log('------------------------------------------------------');
console.log(`  Логин:   ${login}`);
console.log(`  Пароль:  ${rawPassword}`);
console.log('------------------------------------------------------\n');
