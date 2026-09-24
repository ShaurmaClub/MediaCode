import fs from 'fs';
let c = fs.readFileSync('src/pages/Login.jsx', 'utf8');

c = c.replace(/className="login-card" style=\{\{ width: '450px' \}\}/, 'className="login-card"');

fs.writeFileSync('src/pages/Login.jsx', c);
