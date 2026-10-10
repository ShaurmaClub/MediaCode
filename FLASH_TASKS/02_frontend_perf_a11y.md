# ЗАДАЧА 2. Фронт: code-splitting страниц и доступность viewport

Перед началом прочитай `00_RULES.md`.

## 2.1 Разрешить масштабирование на телефонах
В `index.html` в теге `<meta name="viewport" ...>` замени content на:
`width=device-width, initial-scale=1.0`
(убери `maximum-scale=1.0` и `user-scalable=no`). Больше в этом файле ничего не меняй (скрипт темы не трогать).

## 2.2 Ленивая загрузка страниц (React.lazy)
Сейчас весь фронт собирается в один файл ~514 КБ. Нужно разбить по страницам.
1. Открой `src/main.jsx`, найди импорты страниц из `./pages/*.jsx` и их использование в маршрутах.
2. Для страниц, которые НЕ нужны сразу на экране входа/публичной формы, замени статический импорт на ленивый:
   ```js
   import React, { lazy, Suspense } from 'react';
   const AdminUsers = lazy(() => import('./pages/AdminUsers.jsx'));
   ```
   Делай так ТОЛЬКО для: AdminUsers, AdminAudit, RecruitmentReview, Students, TaskDetail, TaskForm, RecordBook, Leaderboard, Notifications, SettingsPage (если такие есть в проекте).
   НЕ делай ленивыми: Login, PublicRecruitment, PrivacyConsent, FirstLogin, PrivacyPolicy, Shell (они нужны сразу).
3. Все страницы используют `export default`? Проверь у каждой. Если у страницы НЕТ `export default` — НЕ делай её ленивой, пропусти.
4. Оберни область с маршрутами в `<Suspense fallback={...}>`. Для fallback используй существующий компонент `Loader` из `src/components/UI.jsx` (если подходит по пропсам; иначе `<div className="loading">Загрузка…</div>`).
5. Не меняй пути маршрутов, не меняй логику авторизации и редиректов.

## Критерий готовности
- `npm run build` показывает НЕСКОЛЬКО js-чанков, главный стал заметно меньше 514 КБ (запиши цифры в PROGRESS);
- eslint 0 ошибок, `npm test` зелёный.
- Проверь вручную запуском `npm run build` — никаких ошибок `Failed to resolve import`.
Коммит: `perf(frontend): lazy-load pages, enable viewport zoom`
