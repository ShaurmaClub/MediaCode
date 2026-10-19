# Руководство по CI/CD и автодеплою «МедиаКод» (Ubuntu 24.04 LTS)

Пайплайн `.github/workflows/ci.yml` реализует полный цикл **CI (безопасность, аудит пакетов, тесты, сборка)** + **CD (автодеплой по SSH в `stage` и `prod` с авто-откатом)** + **Алерты (Telegram + Webhook)**.

---

## 1. Как работает пайплайн

При любом пуше или Pull Request в ветки `main` и `dev` запускаются **3 обязательных блокирующих гейта** на `ubuntu-24.04`:

1. **`security-and-packages` (Безопасность и аудит пакетов):**
   - Проверка `git ls-files` и исходников на отсутствие `.env`, `.db`, приватных ключей и захардкоженных токенов (`npm run test:security`).
   - Сканирование истории коммитов через **Gitleaks**.
   - Строгая установка по lock-файлу (`npm ci`) и проверка уязвимостей продакшн-зависимостей (`npm audit --omit=dev --audit-level=high`).
   - Проверка защиты продакшн-контура: сервер обязан блокировать старт при `NODE_ENV=production` со слабым `SESSION_SECRET`.
2. **`lint-and-build` (Линтер и продакшн-сборка):**
   - Статический анализ `npm run lint` (`eslint .`).
   - Продакшн-сборка `npm run build` (`vite build`).
   - Валидация артефактов `dist/` (`npm run test:dist`) — проверка наличия JS/CSS бандлов и отсутствия утечек `.map` (source maps).
3. **`tests` (Интеграционные, RBAC, Auth и E2E Smoke тесты):**
   - Полный прогон всех 52 интеграционных, ролевых и security-тестов (`npm test`).
   - Браузерный E2E smoke-тест (`npx playwright test`) на реальном Chromium (проверка входа и навигации под `student`, `staff`, `admin` и гостевого портала `/join`).

> **Важно:** Если падает **хотя бы один** из этих этапов — **деплой автоматически отменяется**, а джоб `notify` мгновенно отправляет алерт в Telegram и/или Webhook со ссылкой на логи упавшего шага.

---

## 2. Как работает автодеплой (CD) и авто-откат (Rollback)

- Пуш в ветку **`dev`** (после зелёных тестов) запускает джоб `deploy-staging` -> деплоит на `stage.kaiton.ru`.
- Пуш в ветку **`main`** (после зелёных тестов) запускает джоб `deploy-production` -> деплоит на `kaiton.ru`.

На сервере Ubuntu 24.04 выполняется скрипт `deploy/remote-deploy.sh`, который поддерживает **оба варианта работы** (`DEPLOY_MODE=auto`):
- **Вариант 1 (`systemd` + Nginx):** `npm run backup` -> `git fetch/reset` -> `npm ci` -> `npm run build` -> `sudo systemctl restart mediacode`.
- **Вариант 3 (`Docker Compose`):** `docker compose exec -T mediacode npm run backup` -> `git fetch/reset` -> `docker compose up -d --build`.

После рестарта скрипт до 15 раз опрашивает `http://127.0.0.1:4000/api/health`. Если сервис не поднялся или БД не ответила `"ok":true`, скрипт **автоматически откатывает код на предыдущий рабочий коммит (`PREV_COMMIT`)**, перезапускает сервер и шлёт аварийный алерт.

---

## 3. Быстрая настройка сервера Ubuntu 24.04 (за 5 минут)

### Шаг 1. Подготовка сервера
На чистом сервере Ubuntu 24.04 выполните от `root`:
```bash
git clone https://github.com/ShaurmaClub/MediaCode.git /tmp/mc-init
sudo bash /tmp/mc-init/deploy/ubuntu24-bootstrap.sh
```
*(Если хотите запускать через Docker, передайте `sudo INSTALL_DOCKER=1 bash /tmp/mc-init/deploy/ubuntu24-bootstrap.sh`).*

Скрипт сам установит Node.js 22 LTS, Nginx, создаст пользователя `deploy`, склонирует проект в `/var/www/mediacode` (порт `4000`) и `/var/www/mediacode-stage` (порт `4001`), сгенерирует криптостойкие `.env` и настроит `systemd`-сервисы.

### Шаг 2. Сгенерируйте SSH-ключ для GitHub Actions
На сервере Ubuntu 24.04 под пользователем `deploy`:
```bash
sudo -u deploy ssh-keygen -t ed25519 -C "github-actions-deploy" -f /home/deploy/.ssh/gh_actions -N ""
cat /home/deploy/.ssh/gh_actions.pub >> /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
cat /home/deploy/.ssh/gh_actions
```
Скопируйте приватный ключ (вывод последней команды) в секрет `SSH_PRIVATE_KEY` на GitHub.

---

## 4. Секреты в GitHub (`Settings -> Secrets and variables -> Actions`)

Добавьте следующие Repository Secrets в репозитории `ShaurmaClub/MediaCode`:

| Секрет | Обязательность | Описание / Пример |
| :--- | :--- | :--- |
| `SSH_HOST` | Для автодеплоя | IP или домен сервера Ubuntu 24.04 (например, `kaiton.ru`) |
| `SSH_USER` | Для автодеплоя | Пользователь на сервере (по умолчанию `deploy`) |
| `SSH_PRIVATE_KEY` | Для автодеплоя | Приватный SSH-ключ (`-----BEGIN OPENSSH PRIVATE KEY-----...`) |
| `SSH_PORT` | Опционально | Порт SSH (по умолчанию `22`) |
| `PROD_APP_DIR` | Опционально | Путь к прод-проекту (по умолчанию `/var/www/mediacode`) |
| `STAGE_APP_DIR` | Опционально | Путь к stage-проекту (по умолчанию `/var/www/mediacode-stage`) |
| `DEPLOY_MODE` | Опционально | `auto` (по умолчанию), `systemd` или `docker` |
| `TELEGRAM_BOT_TOKEN` | Для алертов в ТГ | Токен Telegram-бота (от `@BotFather`) |
| `TELEGRAM_CHAT_ID` | Для алертов в ТГ | ID чата или группы (например, `-1001234567890`) |
| `TELEGRAM_THREAD_ID` | Опционально | ID топика в супергруппе Telegram (если используется форум) |
| `ALERT_WEBHOOK_URL` | Для Webhook-алертов | URL вебхука Discord, Slack или любого кастомного приёмника |

*(Пока `SSH_HOST` и `SSH_PRIVATE_KEY` не заданы в GitHub Secrets, джобы деплоя не падают с ошибкой, а аккуратно пропускают шаг SSH с понятной подсказкой в логах).*
