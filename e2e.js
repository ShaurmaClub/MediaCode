import { chromium } from 'playwright';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Login first
  await page.goto('http://localhost:5173/login');
  await page.click('button:has-text("По логину")');
  await page.fill('input[placeholder="Например: ivan_petrov"]', 'admin');
  await page.fill('input[type="password"]', 'admin123'); // assuming default admin is there
  await page.click('button[type="submit"]');
  
  // Wait for load
  await page.waitForTimeout(2000);
  
  await page.goto('http://localhost:5173/tasks/1');
  await page.waitForTimeout(2000);
  const text = await page.innerText('body');
  if (text.includes('ReferenceError') || text.trim() === '') {
    console.error('Grey screen detected!');
  } else {
    console.log('Success! Page loaded. Text length:', text.length);
  }
  await browser.close();
})();
