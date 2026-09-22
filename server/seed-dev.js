import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import db, { seed } from './db.js';

if (process.env.NODE_ENV === 'production') {
  console.error('ОШИБКА: Запуск seed-dev категорически запрещён в режиме production!');
  process.exit(1);
}

// Ensure base schema exists
seed();

function generatePassword() {
  return 'MC_' + crypto.randomBytes(4).toString('hex') + '!';
}

const adminPass = generatePassword();
const staffPass = generatePassword();
const studentPass = generatePassword();

const adminHash = bcrypt.hashSync(adminPass, 10);
const staffHash = bcrypt.hashSync(staffPass, 10);
const studentHash = bcrypt.hashSync(studentPass, 10);

// Update or ensure users
const updatePass = db.prepare(`
  UPDATE users
  SET password_hash = ?, status = 'ACTIVE', must_change_password = 0
  WHERE login = ?
`);

updatePass.run(adminHash, 'admin');
updatePass.run(staffHash, 'staff');
updatePass.run(studentHash, 'student');

console.log('\n======================================================');
console.log('  МедиаКод — Локальные учётные записи для разработки');
console.log('======================================================');
console.log(`  Администратор:  admin    /  ${adminPass}`);
console.log(`  Сотрудник:      staff    /  ${staffPass}`);
console.log(`  Media волонтёр: student  /  ${studentPass}`);
console.log('======================================================');
console.log('  ВНИМАНИЕ: Пароли сгенерированы локально и не хранятся в репозитории!\n');
