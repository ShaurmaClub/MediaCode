# Архитектура CI/CD и инфраструктуры MediaCode (ARCHITECTURE.md)

В проекте принят единый, детерминированный production-стек без промежуточных контейнеров и неоднозначных режимов (`DEPLOY_MODE=auto` и PM2 исключены из production-контура):

- **ОС первой миграции Vavilon:** Ubuntu Server 22.04 LTS (24.04 остаётся вариантом будущей отдельной миграции)
- **Runtime:** Node.js 22 LTS
- **Reverse Proxy & TLS на Vavilon:** существующий Caddy; Nginx/Certbot — только шаблон чистой установки, не применять к существующему серверу
- **Управление процессами и задачами:** `systemd` (`mediacode-prod.service`, `mediacode-stage.service`, `mediacode-backup.timer`, `mediacode-monitor.timer`)
- **База данных:** SQLite (`better-sqlite3`, режим `WAL`, таблица версий `schema_migrations`, чистый модуль констант `server/config/schema.js`)
- **CI/CD:** GitHub Actions (`.github/workflows/ci.yml`) + Release-based CD (`deploy/remote-deploy.sh`)

---

## 1. Схема контуров и строгой изоляции

Целевая release-структура на существующем Ubuntu 22.04 разделяет два контура (её provisioning/cutover требуют разрешения):

| Параметр | Production | Staging |
|---|---|---|
| Ветка Git | `main` | `dev` |
| Домен | `https://kaiton.ru` | `https://stage.kaiton.ru` |
| Внутренний адрес | `127.0.0.1:4000` | `127.0.0.1:4001` |
| Runtime-пользователь | `mediacode-prod` | `mediacode-stage` |
| Deploy-пользователь | `deploy-prod` | `deploy-stage` |
| Systemd-сервис | `mediacode-prod.service` | `mediacode-stage.service` |
| Каталог релизов | `/opt/mediacode/production` | `/opt/mediacode/staging` |
| Каталог данных и `.env` | `/var/lib/mediacode/production` (`0700`) | `/var/lib/mediacode/staging` (`0700`) |
| GitHub Environment | `production` | `staging` |

Существующие UFW/SSH не меняются. CI подключается через Tailscale OIDC к приватному IP, затем использует OpenSSH Ed25519. Новые unit слушают только 127.0.0.1:4000/4001. Backend блокирует /uploads/ независимо от proxy; файлы выдаются через авторизованный API. Текущий старый listener и его firewall зафиксированы в LEGACY_AUDIT.md; их изменения сейчас не разрешены.

---

## 2. Изоляция привилегий между контурами

Используются 4 отдельные учётные записи (по две на каждый контур):
1. **`mediacode-prod` и `mediacode-stage` (runtime users):**
   - Системные пользователи без интерактивной оболочки (`/usr/sbin/nologin`).
   - Владеют только своим каталогом `/var/lib/mediacode/<env>` с правами `0700` и файлом `.env` (`0600`). Компрометация `staging` не даёт доступа к БД, файлам или `.env` контура `production`.
   - Имеют доступ **только на чтение** к коду в `/opt/mediacode/<env>/current`.
   - Защищены директивами `systemd`: `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=strict`, `ProtectHome=true`.
2. **`deploy-prod` и `deploy-stage` (deployment users):**
   - Используются GitHub Actions для доставки релизов по SSH с отдельными ключами.
   - Владеют только своим каталогом `/opt/mediacode/<env>`.
   - В `/etc/sudoers.d/mediacode-deploy` каждый `deploy-<env>` может перезапускать только свой сервис (`mediacode-prod.service` или `mediacode-stage.service`) и вызывать `node` от имени только своего `mediacode-<env>` для выполнения миграций и предрелизного бэкапа (не читая `.env` напрямую).

---

## 3. Структура файловой системы (Release-Based Deployment)

```text
/opt/mediacode/
├── production/ (deploy-prod:mediacode-prod, 0750)
│   ├── current -> /opt/mediacode/production/releases/<sha>
│   ├── previous -> /opt/mediacode/production/releases/<prev_sha>
│   └── releases/<sha>/
│       ├── data -> /var/lib/mediacode/production/data
│       └── uploads -> /var/lib/mediacode/production/uploads
└── staging/ (deploy-stage:mediacode-stage, 0750)
    ├── current -> /opt/mediacode/staging/releases/<sha>
    ├── previous -> /opt/mediacode/staging/releases/<prev_sha>
    └── releases/<sha>/
        ├── data -> /var/lib/mediacode/staging/data
        └── uploads -> /var/lib/mediacode/staging/uploads

/var/lib/mediacode/
├── production/ (mediacode-prod:mediacode-prod, 0700)
│   ├── .env                (0600, mediacode-prod:mediacode-prod)
│   ├── data/media.db       (SQLite + WAL)
│   ├── uploads/recruitment (приватные загруженные файлы)
│   └── backups/            (media-*.db + manifest-*.json + uploads-*/)
└── staging/ (mediacode-stage:mediacode-stage, 0700)
    ├── .env                (0600, mediacode-stage:mediacode-stage)
    ├── data/media.db
    ├── uploads/recruitment
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
    CD --> Step1["1. Flock-блокировка + Pre-deploy Backup от имени mediacode-<env>"]
    Step1 -->|Ошибка бэкапа (код 20)| Abort["Деплой остановлен, рабочий релиз не тронут"]
    Step1 -->|Бэкап проверен| Step2["2. Идемпотентная сборка релиза в releases/<SHA> + распаковка dist.tar.gz"]
    Step2 --> Step3["3. Проверка и применение миграций SQLite от имени mediacode-<env>"]
    Step3 --> Step4["4. Атомарное переключение current -> releases/<SHA> + рестарт systemd"]
    Step4 --> Step5["5. 7-ступенчатая проверка /api/health/ready и функционального smoke"]
    Step5 -->|Успех (код 0)| Done["Успешный релиз + очистка старых релизов + уведомление"]
    Step5 -->|Сбой проверки| Rollback["Автоматический Rollback на previous (проверка совместимости схемы)"]
    Rollback --> FailJob["GitHub Actions получает код 30/31 (статус Failure) + критический алерт"]
```
