import fs from 'fs';
let c = fs.readFileSync('tests/e2e/smoke.spec.js', 'utf8');

c = c.replace(/await page\.fill\('#login-input'/g, "await page.click('button:has-text(\"По логину\")');\n    await page.fill('#login-input'");

fs.writeFileSync('tests/e2e/smoke.spec.js', c);
