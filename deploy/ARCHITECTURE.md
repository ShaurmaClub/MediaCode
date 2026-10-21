# Архитектура CI/CD и инфраструктуры MediaCode (ARCHITECTURE.md)

В проекте принят единый, детерминированный production-стек без промежуточных контейнеров и неоднозначных режимов (`DEPLOY_MODE=auto` и PM2 исключены из production-контура):

- **ОС:** Ubuntu Server 24.04 LTS
- **Runtime:** Node.js 22 LTS
- **Reverse Proxy & TLS:** Nginx + Certbot (Let's Encrypt)
- **Управление процессами и задачами:** `systemd` (`mediacode-prod.service`, `mediacode-stage.service`, `mediacode-backup.timer`, `mediacode-monitor.timer`)
- **База данных:** SQLite (`better-sqlite3`, режим `WAL`, таблица версий `schema_migrations`)
- **CI/CD:** GitHub Actions (`.github/workflows/ci.yml`) + Release-based CD (`deploy/remote-deploy.sh`)

---

## 1. Схема контуров и сетевой изоляции

На одном сервере Ubuntu 24.04 работают два полностью изолированных контура:

| Параметр | Production | Staging |
|---|---|---|
| Ветка Git | `main` | `dev` |
| Домен | `https://kaiton.ru` | `https://stage.kaiton.ru` |
| Внутренний адрес | `127.0.0.1:4000` | `127.0.0.1:4001` |
| Systemd-сервис | `mediacode-prod.service` | `mediacode-stage.service` |
| Каталог релизов | `/opt/mediacode/production` | `/opt/mediacode/staging` |
| Каталог данных и `.env` | `/var/lib/mediacode/production` | `/var/lib/mediacode/staging` |
| GitHub Environment | `production` | `staging` |

Снаружи через межсетевой экран UFW открыты только SSH, `80/tcp` и `443/tcp`. Порты `4000` и `4001` слушают исключительно `127.0.0.1` и недоступны в обход Nginx.

---

## 2. Разделение привилегий на сервере

Используются две отдельные учётные записи:
1. **`mediacode` (runtime user):**
   - Системный пользователь без интерактивной оболочки (`/usr/sbin/nologin`).
   - От его имени работают Node.js-процессы `mediacode-prod` и `mediacode-stage`.
   - Имеет доступ **только на чтение** к коду в `/opt/mediacode/<env>/current` и **права на запись** только в `/var/lib/mediacode/<env>/{data,uploads,backups}`.
   - Защищён директивами `systemd`: `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=strict`, `ProtectHome=true`.
2. **`deploy` (deployment user):**
   - Используется GitHub Actions для доставки релизов по SSH.
   - Владеет каталогами `/opt/mediacode/{production,staging}`.
   - В `/etc/sudoers.d/mediacode-deploy` имеет строго ограниченные права: перезапуск/статус сервисов `mediacode-prod.service` и `mediacode-stage.service` и вызов скриптов миграции/бэкапа от имени `mediacode`.

---

## 3. Структура файловой системы (Release-Based Deployment)

```text
/opt/mediacode/
├── production/
│   ├── current -> /opt/mediacode/production/releases/<sha>
│   ├── previous -> /opt/mediacode/production/releases/<prev_sha>
│   └── releases/
│       └── <sha>/
└── staging/
    ├── current -> /opt/mediacode/staging/releases/<sha>
    ├── previous -> /opt/mediacode/staging/releases/<prev_sha>
    └── releases/
        └── <sha>/

/var/lib/mediacode/
├── production/
│   ├── .env          (0600, mediacode:mediacode)
│   ├── data/media.db (SQLite + WAL)
│   ├── uploads/      (загруженные файлы пользователей)
│   └── backups/      (.db + .manifest.json + .uploads/)
└── staging/
    ├── .env
    ├── data/media.db
    ├── uploads/
    └── backups/
```

---

## 4. Поток CI/CD и автоматического отката (Rollback)

```mermaid
flowchart TD
    Push["Push / PR в GitHub"] --> CI1["Job 1: Security, Gitleaks, Lockfile, SESSION_SECRET, npm audit"]
    Push --> CI2["Job 2: ESLint + Vite Build + Verify dist/ + dist.tar.gz"]
    CI2 --> CI3["Job 3: API, RBAC, Migrations, Backup/Restore & Playwright E2E"]
    CI1 & CI2 & CI3 -->|Ошибка на любом шаге| AlertCI["Job 4: Алерт CI Failure (Деплой заблокирован)"]
    CI1 & CI2 & CI3 -->|Успех + push в dev/main| CD["Job 5/6: SSH Deploy строго проверенного GITHUB_SHA"]
    CD --> Step1["1. Flock-блокировка + Pre-deploy Backup SQLite & uploads"]
    Step1 -->|Ошибка бэкапа (код 20)| Abort["Деплой остановлен, рабочий релиз не тронут"]
    Step1 -->|Бэкап проверен| Step2["2. Сборка релиза в releases/<SHA> + распаковка dist.tar.gz"]
    Step2 --> Step3["3. Проверка и применение миграций SQLite (server/migrate.js)"]
    Step3 --> Step4["4. Атомарное переключение current -> releases/<SHA> + рестарт systemd"]
    Step4 --> Step5["5. 7-ступенчатая проверка /api/health/ready и функционального smoke"]
    Step5 -->|Успех (код 0)| Done["Успешный релиз + очистка старых релизов + уведомление"]
    Step5 -->|Сбой проверки| Rollback["Автоматический Rollback на previous (проверка совместимости схемы)"]
    Rollback --> FailJob["GitHub Actions получает код 30/31 (статус Failure) + критический алерт"]
```
