import fs from 'fs';
let c = fs.readFileSync('src/pages/Login.jsx', 'utf8');
c = c.replace("toast.success(С возвращением, !);", "toast.success(`С возвращением, ${data.user.first_name}!`);");
fs.writeFileSync('src/pages/Login.jsx', c);
