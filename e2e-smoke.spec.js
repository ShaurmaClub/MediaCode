import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test('End-to-End Petya Recruitment Flow', async ({ page }) => {
  // 1. Check Privacy Policy rendering
  await page.goto('http://localhost:5173/privacy-policy');
  await expect(page.locator('text=Обработка персональных данных')).toBeVisible();

  // Create dummy files for testing
  fs.writeFileSync('test-photo.jpg', 'fake-image-content');
  fs.writeFileSync('test-video.mp4', 'fake-video-content');

  // 2. Submit SMM application
  await page.goto('http://localhost:5173/join/smm');
  await page.fill('input[placeholder="Имя"]', 'Петя');
  await page.fill('input[placeholder="Фамилия"]', 'Тестовый');
  await page.fill('input[placeholder="+7 (900) 000-00-00"]', '+79991234567');
  // Handle Max Checkbox
  await page.click('label:has-text("Этот номер телефона используется в Макс")');
  await page.fill('input[type="tel"]:not([placeholder="+7 (900) 000-00-00"])', '+79997654321');
  
  // Consent
  await page.check('input[type="checkbox"][required]');

  // Task Submission (Text)
  await page.fill('textarea', 'Мой тестовый текст\nс переносами');

  // Submit
  await page.click('button:has-text("Отправить заявку")');
  await expect(page.locator('text=Заявка принята')).toBeVisible();

  console.log('Smoke test passed successfully!');
});
