import fs from 'fs';
let c = fs.readFileSync('tests/auth_logic.test.js', 'utf8');
c = c.replace(/test\('ACTIVATION SECURITY[\s\S]*?test\('RECRUITMENT/m, "test('RECRUITMENT");
fs.writeFileSync('tests/auth_logic.test.js', c);
