import fs from 'fs';
let c = fs.readFileSync('src/pages/Login.jsx', 'utf8');

const replacement = `<datalist id="departments">
                    <option value="Учебное отделение «Моссовет»" />
                    <option value="Учебное отделение «Техно»" />
                    <option value="Учебное отделение «Датахаб»" />
                    <option value="Учебное отделение «АртТех»" />
                    <option value="Учебное отделение «Кибер»" />
                    <option value="Учебное отделение «Диджитал»" />
                  </datalist>`;

c = c.replace(/<datalist id="departments">[\s\S]*?<\/datalist>/, replacement);

fs.writeFileSync('src/pages/Login.jsx', c);
