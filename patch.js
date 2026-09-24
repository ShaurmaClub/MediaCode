import fs from 'fs';
let lines = fs.readFileSync('src/pages/Login.jsx', 'utf8').split('\n');
for(let i=345; i<360; i++) { if (lines[i]) console.log(i+1, lines[i]); }
