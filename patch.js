import fs from 'fs';
let c = fs.readFileSync('server/index.js', 'utf8');

c = c.replace(/if \(user\.status === 'DISABLED'\) return res\.status\(400\)\.json\(\{error: 'Аккаунт заблокирован'\}\);/g, "if (user.status === 'DISABLED') return res.status(400).json({error: 'Аккаунт заблокирован'});\n    if (user.status === 'PENDING_APPROVAL') return res.status(400).json({error: 'Регистрация отправлена на подтверждение администратору.'});");

fs.writeFileSync('server/index.js', c);
