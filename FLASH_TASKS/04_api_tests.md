# ЗАДАЧА 4. Новые API-тесты (только ДОБАВЛЕНИЕ новых файлов)

Перед началом прочитай `00_RULES.md`.

Цель: покрыть тестами разделы сервера, где их почти нет, чтобы старшая модель могла безопасно рефакторить.
**Правило: тесты только описывают ТЕКУЩЕЕ поведение. Если тест падает — это НЕ повод менять сервер. Подправь ожидание теста под фактическое поведение и оставь комментарий `// фактическое поведение`.**
Баги, которые заметишь, НЕ чини — запиши в `PROGRESS.md`.

## Образец
Смотри `tests/reliability.test.js` и `tests/privacy_phone.test.js` — как поднимать сервер:
- `process.env.NODE_ENV='test'`, уникальный `DB_PATH` (`./data/test_<имя>.db`), уникальный `PORT` (4021, 4022, … — не повторять уже занятые: 4007, 4011, и порты в других тестах: проверь `grep -r "process.env.PORT" tests`),
- `await import('../server/index.js')`, затем `fetch` на `http://localhost:<PORT>/api/...`,
- логин: `POST /api/auth/login` `{login:'admin', password:'Demo123!'}`, куки из заголовка `set-cookie`, дальше передавай `Cookie`.
- Демо-пользователи: admin, staff, student (пароль у всех `Demo123!`). Если у student/staff стоит `must_change_password` или нет согласия, посмотри как это обходят в `tests/api.test.js` (обычно UPDATE через `db.prepare`).
- В `after()` закрывай `server.close()`.

## Что покрыть (по одному новому файлу, 3–6 тестов в каждом)
1. `tests/rbac.test.js` — доступы по ролям:
   - без входа `GET /api/dashboard`, `/api/tasks`, `/api/audit` → 401;
   - student на `GET /api/audit` → 403; admin → 200 и массив;
   - student на `GET /api/recruitment/tracks` → 403.
2. `tests/leaderboard_notifications.test.js`:
   - `GET /api/leaderboard` под student → 200, массив;
   - `GET /api/notifications` под student → 200, массив.
3. `tests/public_recruitment.test.js`:
   - публичный список направлений (найди маршрут в `server/routes/recruitmentPublic.js`, не меняя его) отдаёт массив с полями slug, name;
   - заявка без согласия/обязательных полей → ответ 4xx (не 500).
4. `tests/bad_input.test.js`:
   - `POST /api/auth/login` с битым JSON (заголовок `Content-Type: application/json`, тело `{bad`) → 400;
   - `POST /api/auth/login` без полей → 400;
   - несуществующий `/api/nope` → 404 с JSON.

## Критерий готовности
- `npm test` — все тесты зелёные (старые 23 + новые), eslint 0 ошибок;
- не тронут ни один существующий файл тестов и ни один файл в `server/`.
Коммит: `test: add rbac, leaderboard, public recruitment and bad input tests`
