# Справочник переменных окружения и секретов (ENV.md)

Документ содержит полный перечень переменных окружения серверного приложения (`/var/lib/mediacode/<env>/.env`) и секретов GitHub Actions Environments (`production` и `staging`).

---

## 1. Переменные окружения на сервере (`/var/lib/mediacode/<env>/.env`)

Файлы `/var/lib/mediacode/production/.env` и `/var/lib/mediacode/staging/.env` создаются автоматически установщиком `deploy/install.sh` с правами `0600` (владелец `mediacode:mediacode`).

| Переменная | Обязательна в prod | Пример значения | Назначение |
|---|---|---|---|
| `NODE_ENV` | Да | `production` | Режим работы Node.js/Express (`production`, `development`, `test`). |
| `DEPLOY_ENV` | Да | `production` или `staging` | Имя текущего контура (возвращается в `/api/health/ready` и используется в алертах). |
| `HOST` | Да | `127.0.0.1` | Интерфейс прослушивания HTTP-сервера. В `production` по умолчанию `127.0.0.1` (доступ снаружи только через Nginx). |
| `PORT` | Да | `4000` (prod) / `4001` (stage) | Локальный TCP-порт приложения. |
| `SESSION_SECRET` | **Да (строго)** | `<64 hex-символа>` | Ключ подписи сессионных cookie. В `production` при отсутствии, длине `< 32` символов или дефолтном значении сервер аварийно завершает старт с текстом `CRITICAL ERROR: В режиме production переменная окружения SESSION_SECRET обязательна...`. |
| `PUBLIC_ORIGIN` | Рекомендуется | `https://kaiton.ru` | Разрешённый внешний Origin для защиты мутирующих запросов (`POST/PUT/PATCH/DELETE`). |
| `DB_PATH` | Да | `/var/lib/mediacode/production/data/media.db` | Абсолютный путь к файлу базы данных SQLite. |
| `UPLOADS_DIR` | Да | `/var/lib/mediacode/production/uploads` | Каталог хранения загруженных файлов (аватары, вложения). |
| `BACKUP_DIR` | Да | `/var/lib/mediacode/production/backups` | Каталог хранения локальных резервных копий БД, манифестов и загрузок. |
| `BACKUP_KEEP` | Нет | `14` | Количество хранимых локальных точек восстановления при ротации. |
| `TRUST_PROXY` | Нет | `1` | Доверие заголовкам `X-Forwarded-For` / `X-Forwarded-Proto` от локального Nginx. |
| `RATE_LIMIT_MAX` | Нет | `250` | Общий лимит запросов к `/api` за 15 минут с одного IP. |
| `AUTH_RATE_LIMIT_MAX` | Нет | `30` | Лимит попыток входа `/api/auth/login` за 15 минут с одного IP. |
| `PUBLIC_RECRUIT_RATE_LIMIT_MAX` | Нет | `20` | Лимит отправки публичных заявок на рекрутинг за 15 минут. |
| `RESTIC_REPOSITORY` | Опционально | `s3:https://s3.example.com/bucket` | Репозиторий `restic` для автоматической отправки зашифрованных копий во внешнее хранилище. |
| `RESTIC_PASSWORD` | Опционально | `<ключ шифрования restic>` | Пароль шифрования репозитория `restic`. |
| `TELEGRAM_BOT_TOKEN` | Опционально | `123456:ABC-...` | Токен Telegram-бота для отправки серверных алертов мониторинга и бэкапов. |
| `TELEGRAM_CHAT_ID` | Опционально | `-1001234567890` | ID чата/группы Telegram для серверных уведомлений. |
| `TELEGRAM_THREAD_ID` | Опционально | `42` | ID темы (топика) в супергруппе Telegram (опционально). |
| `ALERT_WEBHOOK_URL` | Опционально | `https://hooks.slack.com/...` | Webhook URL (Discord/Slack/Mattermost) для дублирования алертов. |
| `PRIVACY_POLICY_URL` | Опционально | `https://kaiton.ru/privacy.pdf` | Внешняя ссылка на политику обработки ПДн (если пусто — открывается встроенное модальное окно). |

---

## 2. Секреты GitHub Environments (`production` и `staging`)

Заполняются автоматически скриптом `deploy/setup-github.sh` отдельно для каждого окружения (`Settings -> Environments -> production / staging`):

| Секрет | Обязателен | Пример (`production`) | Пример (`staging`) | Описание |
|---|---|---|---|---|
| `SSH_HOST` | **Да** | `kaiton.ru` или IP | `stage.kaiton.ru` или IP | Адрес сервера для подключения по SSH. |
| `SSH_PORT` | Нет (по умолч. `22`) | `22` | `22` | SSH-порт сервера. |
| `SSH_USER` | Нет (по умолч. `deploy`) | `deploy` | `deploy` | Имя непривилегированного пользователя доставки релизов. |
| `SSH_PRIVATE_KEY` | **Да** | `-----BEGIN OPENSSH PRIVATE KEY-----...` | *(отдельный ключ для staging)* | Приватный ключ Ed25519 соответствующего окружения. |
| `SSH_KNOWN_HOSTS` | **Да** | `kaiton.ru ssh-ed25519 AAAA...` | `stage.kaiton.ru ssh-ed25519 AAAA...` | Зафиксированный публичный host key сервера для строгой проверки `StrictHostKeyChecking=yes`. |
| `DEPLOY_PATH` | Нет | `/opt/mediacode/production` | `/opt/mediacode/staging` | Корневой каталог релизов окружения. |
| `SERVICE_NAME` | Нет | `mediacode-prod` | `mediacode-stage` | Имя systemd-сервиса окружения. |
| `HEALTHCHECK_URL` | Опционально | `https://kaiton.ru/api/health/ready` | `https://stage.kaiton.ru/api/health/ready` | Внешний HTTPS URL для финальной проверки после переключения релиза. |

---

## 3. Общие секреты репозитория (Repository Secrets для уведомлений CI/CD)

Настраиваются в `Settings -> Secrets and variables -> Actions -> Repository secrets`:
- `TELEGRAM_BOT_TOKEN` — токен Telegram-бота для уведомлений GitHub Actions.
- `TELEGRAM_CHAT_ID` — ID чата для уведомлений о результатах CI, деплоя и отката.
- `TELEGRAM_THREAD_ID` — (опционально) ID ветки форума в Telegram.
- `ALERT_WEBHOOK_URL` — (опционально) URL вебхука для уведомлений.
