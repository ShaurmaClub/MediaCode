# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.js >> Smoke tests >> STUDENT flow: login, dashboard, tasks, task detail
- Location: tests\e2e\smoke.spec.js:15:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('text=Мои текущие назначения')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('text=Мои текущие назначения') with timeout 5000ms
  - waiting for locator('text=Мои текущие назначения')

```

```yaml
- complementary:
  - link "КАИТ20 МедиаКод":
    - /url: /dashboard
    - img "КАИТ20"
    - img "МедиаКод"
  - button "Свернуть меню"
  - text: ИП Иван Петров Медиаволонтёр
  - navigation:
    - link "Главная":
      - /url: /dashboard
    - link "Мероприятия":
      - /url: /tasks
    - link "Медиаволонтёры":
      - /url: /students
    - link "Моя зачётка":
      - /url: /record-book
    - link "Рейтинг медиаволонтёров":
      - /url: /leaderboard
    - link "Уведомления 2":
      - /url: /notifications
  - button "Настройки"
  - button "Выйти"
- banner:
  - textbox "Поиск по мероприятиям и навыкам… (нажмите Enter)"
  - button "Системная"
  - button "Уведомления": "2"
  - text: ИП
- main:
  - text: МЕДИАКОД
  - heading "Привет, Иван!" [level=1]
  - paragraph: "Твой персональный медиацентр: актуальные мероприятия, статус заявок и баланс баллов."
  - link "Смотреть мероприятия":
    - /url: /tasks
  - text: Твой баланс в системе
  - strong: "60"
  - text: "баллов активности · Выполнено мероприятий: 1 Ближайшее мероприятие"
  - heading "Осенний фотодень первокурсников" [level=3]
  - text: 28 сент. 2026 г. · 10:00 · Кампус, Парковая зона +20 баллов
  - link "Перейти к мероприятию":
    - /url: /tasks/3
  - heading "Возможности для участия" [level=2]
  - link "Все мероприятия (4) →":
    - /url: /tasks
  - link "Фотография +20 баллов Осенний фотодень первокурсников Портретная съёмка первокурсников в локациях кампуса для студенческих билетов и доски почёта колледжа. 28 сент. 2026 г. · 10:00 Кампус, Парковая зона Открыто 0/2 мест":
    - /url: /tasks/3
    - text: Фотография +20 баллов
    - heading "Осенний фотодень первокурсников" [level=3]
    - paragraph: Портретная съёмка первокурсников в локациях кампуса для студенческих билетов и доски почёта колледжа.
    - text: 28 сент. 2026 г. · 10:00 Кампус, Парковая зона Открыто 0/2 мест
  - link "Событие Высокий приоритет +30 баллов День открытых дверей колледжа Снять ключевые моменты церемонии, провести экспресс-интервью с абитуриентами и их родителями, подготовить фотобанк для сайта. 5 окт. 2026 г. · 11:30 Главный корпус, Актовый зал Заявка подана 0/3 мест":
    - /url: /tasks/1
    - text: Событие Высокий приоритет +30 баллов
    - heading "День открытых дверей колледжа" [level=3]
    - paragraph: Снять ключевые моменты церемонии, провести экспресс-интервью с абитуриентами и их родителями, подготовить фотобанк для сайта.
    - text: 5 окт. 2026 г. · 11:30 Главный корпус, Актовый зал Заявка подана 0/3 мест
  - link "Монтаж +25 баллов Монтаж промо-ролика студенческих клубов Собрать динамичный вертикальный ролик (9:16) для клипов из исходников, отснятых на ярмарке клубов. 12 окт. 2026 г. · 14:00 Медиалаборатория (ауд. 304) Открыто 0/1 мест":
    - /url: /tasks/2
    - text: Монтаж +25 баллов
    - heading "Монтаж промо-ролика студенческих клубов" [level=3]
    - paragraph: Собрать динамичный вертикальный ролик (9:16) для клипов из исходников, отснятых на ярмарке клубов.
    - text: 12 окт. 2026 г. · 14:00 Медиалаборатория (ауд. 304) Открыто 0/1 мест
  - heading "История начислений" [level=2]
  - link "Вся зачётная книжка →":
    - /url: /record-book
  - text: "Дизайн серии афиш для Недели Науки Категория: COMPLETION · «Дизайн серии афиш для Недели Науки»"
  - strong: "+20"
  - time: 15 сент. 2026 г.
  - text: "Съёмка приветственной недели Категория: EVENT"
  - strong: "+40"
  - time: 5 сент. 2026 г.
  - heading "Уведомления" [level=2]
  - link "Все (2) →":
    - /url: /notifications
  - text: Новая возможность
  - paragraph: Открыта запись на «День открытых дверей колледжа».
  - text: 6 дн. назад Начислены баллы
  - paragraph: +20 баллов за выполнение «Дизайн серии афиш для Недели Науки».
  - text: 15 сент. 2026 г.
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | import path from 'path';
  3   | import fs from 'fs';
  4   | import { execSync } from 'child_process';
  5   | 
  6   | // We need to run the server before tests
  7   | test.describe('Smoke tests', () => {
  8   |   test('Guest access', async ({ page }) => {
  9   |     const res = await page.goto('/');
  10  |     expect(res.ok()).toBeTruthy();
  11  |     await page.goto('/join');
  12  |     await expect(page.locator('text=Направления отбора в')).toBeVisible();
  13  |   });
  14  | 
  15  |   test('STUDENT flow: login, dashboard, tasks, task detail', async ({ page }) => {
  16  |     page.on('response', response => {
  17  |       console.log('RESPONSE:', response.url());
  18  |     });
  19  | 
  20  |     await page.goto('/login');
  21  |     await page.click('button:has-text("По логину")');
  22  |     await page.fill('#login-input', 'student');
  23  |     await page.fill('#password-input', 'Demo123!');
  24  |     await page.locator('#password-input').press('Enter');
  25  |     // removed waitForURL
> 26  |     await expect(page.locator('text=Мои текущие назначения')).toBeVisible({ timeout: 5000 });
      |                                                               ^ Error: expect(locator).toBeVisible() failed
  27  |     
  28  |     await page.click('a[href="/tasks"]');
  29  |     await page.waitForURL('/tasks');
  30  |     await expect(page.locator('text=Мероприятия')).toBeVisible({ timeout: 5000 });
  31  | 
  32  |     // Go to first task
  33  |     const taskLink = page.locator('.task-card a').first();
  34  |     if (await taskLink.count() > 0) {
  35  |       await taskLink.click();
  36  |       await expect(page.locator('.task-header')).toBeVisible();
  37  |     }
  38  |   });
  39  | 
  40  |   test('STAFF flow: recruitment and task detail', async ({ page }) => {
  41  |     await page.goto('/login');
  42  |     await page.click('button:has-text("По логину")');
  43  |     await page.fill('#login-input', 'staff');
  44  |     await page.fill('#password-input', 'Demo123!');
  45  |     await page.locator('#password-input').press('Enter');
  46  |     // removed waitForURL
  47  |     
  48  |     await page.click('a[href="/recruitment"]');
  49  |     await page.waitForURL('/recruitment');
  50  |     await expect(page.locator('text=Наборы в медиацентр')).toBeVisible();
  51  | 
  52  |     // Tasks
  53  |     await page.goto('/tasks');
  54  |     const taskLink = page.locator('.task-card a').first();
  55  |     if (await taskLink.count() > 0) {
  56  |       await taskLink.click();
  57  |       await expect(page.locator('.task-header')).toBeVisible();
  58  |     }
  59  |   });
  60  | 
  61  |   test('ADMIN flow: users and audit', async ({ page }) => {
  62  |     await page.goto('/login');
  63  |     await page.click('button:has-text("По логину")');
  64  |     await page.fill('#login-input', 'admin');
  65  |     await page.fill('#password-input', 'Demo123!');
  66  |     await page.locator('#password-input').press('Enter');
  67  |     // removed waitForURL
  68  |     
  69  |     await page.goto('/admin/users');
  70  |     await expect(page.locator('text=Управление пользователями')).toBeVisible();
  71  | 
  72  |     await page.goto('/admin/audit');
  73  |     await expect(page.locator('text=Журнал аудита')).toBeVisible();
  74  |   });
  75  | 
  76  |   test('Navigation Stability / Rapid switching (STUDENT)', async ({ page }) => {
  77  |     await page.goto('/login');
  78  |     await page.click('button:has-text("По логину")');
  79  |     await page.fill('#login-input', 'student');
  80  |     await page.fill('#password-input', 'Demo123!');
  81  |     await page.locator('#password-input').press('Enter');
  82  |     // removed waitForURL
  83  | 
  84  |     const routes = ['/tasks', '/record-book', '/leaderboard', '/notifications', '/settings', '/dashboard'];
  85  |     for (let i = 0; i < 2; i++) {
  86  |       for (const route of routes) {
  87  |         await page.goto(route);
  88  |         await expect(page.locator('#root')).toBeVisible(); // no blank screen
  89  |         // check no errors
  90  |         const content = await page.content();
  91  |         expect(content).not.toContain('Application error');
  92  |       }
  93  |     }
  94  |   });
  95  | 
  96  |   test('Navigation Stability / Rapid switching (STAFF)', async ({ page }) => {
  97  |     await page.goto('/login');
  98  |     await page.click('button:has-text("По логину")');
  99  |     await page.fill('#login-input', 'staff');
  100 |     await page.fill('#password-input', 'Demo123!');
  101 |     await page.locator('#password-input').press('Enter');
  102 |     // removed waitForURL
  103 | 
  104 |     const routes = ['/recruitment', '/tasks', '/students', '/notifications', '/settings', '/dashboard'];
  105 |     for (const route of routes) {
  106 |       await page.goto(route);
  107 |       await expect(page.locator('#root')).toBeVisible();
  108 |     }
  109 |   });
  110 | 
  111 |   test('Browser Back/Forward/Reload', async ({ page }) => {
  112 |     await page.goto('/login');
  113 |     await page.click('button:has-text("По логину")');
  114 |     await page.fill('#login-input', 'student');
  115 |     await page.fill('#password-input', 'Demo123!');
  116 |     await page.locator('#password-input').press('Enter');
  117 |     // removed waitForURL
  118 | 
  119 |     await page.goto('/tasks');
  120 |     await page.goBack();
  121 |     await expect(page).toHaveURL(/.*\/dashboard/);
  122 |     await page.goForward();
  123 |     await expect(page).toHaveURL(/.*\/tasks/);
  124 |     await page.reload();
  125 |     await expect(page.locator('#root')).toBeVisible();
  126 |   });
```