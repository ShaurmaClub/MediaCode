# Инструкция по первичной установке MediaCode (Ubuntu Server 24.04 LTS)

Для **существующего** сайта, включая Vavilon, начать с [MIGRATE_EXISTING.md](MIGRATE_EXISTING.md) и [DEVOPS_QUICKSTART.md](DEVOPS_QUICKSTART.md). Этот clean installer нельзя запускать поверх действующих Caddy/MediaCode. CD отключён по умолчанию; подключение SSH само по себе не разрешает production-деплой.

Данное руководство описывает полное развёртывание контуров **Production** (`kaiton.ru`) и **Staging** (`stage.kaiton.ru`) на чистом сервере **Ubuntu Server 24.04 LTS** и подключение автоматического CI/CD из GitHub Actions.

---

## 1. Предварительные требования

1. **Сервер:** Ubuntu Server 24.04 LTS (минимум 1 vCPU, 2 ГБ RAM, 10 ГБ свободного места на диске).
2. **DNS-записи** (рекомендуется настроить заранее у регистратора домена):
   - `A` запись `@` (`kaiton.ru`) $\rightarrow$ `<IP_ВАШЕГО_СЕРВЕРА>`
   - `A` запись `www` (`www.kaiton.ru`) $\rightarrow$ `<IP_ВАШЕГО_СЕРВЕРА>`
   - `A` запись `stage` (`stage.kaiton.ru`) $\rightarrow$ `<IP_ВАШЕГО_СЕРВЕРА>`
3. **Доступ по SSH** с правами `sudo`.

---

## 2. Установка сервера одной командой (`deploy/install.sh`)

Подключитесь к серверу по SSH и выполните:

```bash
git clone -b ci/cd-ubuntu24 https://github.com/ShaurmaClub/MediaCode.git /tmp/mediacode-installer
cd /tmp/mediacode-installer
sudo bash deploy/install.sh
```
*(После слияния ветки `ci/cd-ubuntu24` в `main` флаг `-b ci/cd-ubuntu24` можно опустить).*

Для полностью неинтерактивного запуска:

```bash
sudo PROD_DOMAIN=kaiton.ru \
     STAGE_DOMAIN=stage.kaiton.ru \
     CERTBOT_EMAIL=admin@kaiton.ru \
     bash deploy/install.sh --non-interactive
```

### Что автоматически делает `deploy/install.sh`:
1. Проверяет версию ОС (Ubuntu 24.04), свободное место на диске и отсутствие конфликтов портов `4000` и `4001`.
2. Устанавливает системные пакеты (`nginx`, `sqlite3`, `certbot`, `ufw`, `rsync`, `restic`, `jq`) и **Node.js 22 LTS** с проверкой GPG-ключа.
3. Создаёт 4 изолированных системных пользователя (полное разделение привилегий между `production` и `staging`):
   - `mediacode-prod` и `mediacode-stage` (runtime-пользователи без shell-доступа, владеют только своим каталогом данных `/var/lib/mediacode/<env>` с правами `0700` и `.env` `0600`);
   - `deploy-prod` и `deploy-stage` (пользователи доставки релизов, владеют только своим `/opt/mediacode/<env>`, имеют строго разделённый `sudoers` только на свой контур).
4. Формирует release-based структуру `/opt/mediacode/{production,staging}/releases/<sha>` и каталоги постоянных данных `/var/lib/mediacode/{production,staging}/{data,uploads/recruitment,backups}`.
5. Генерирует `/var/lib/mediacode/{production,staging}/.env` с криптостойким `SESSION_SECRET` (права `0600`, секреты в лог не выводятся; при повторном запуске существующие `.env` не перезаписываются).
6. Выполняет сборку, применяет миграции SQLite и запускает `mediacode-prod.service` (`127.0.0.1:4000`) и `mediacode-stage.service` (`127.0.0.1:4001`), а также таймеры `mediacode-backup.timer` и `mediacode-monitor.timer`.
7. Настраивает Nginx reverse proxy (с лимитом `client_max_body_size 55M` и запретом прямого доступа к `/uploads/` в обход авторизации backend) и безопасно включает UFW (предварительно определив фактический SSH-порт из `sshd -T`).
8. Проверяет DNS-записи и выпускает сертификаты Let's Encrypt через Certbot.
9. Выполняет финальную проверку готовности `/api/health/ready` для обоих контуров.

---

## 3. Привязка GitHub Actions (`deploy/setup-github.sh`)

Для того чтобы пуши в `dev` и `main` автоматически доставлялись на сервер, выполните:

```bash
bash deploy/setup-github.sh --host <IP_ИЛИ_ДОМЕН_СЕРВЕРА> --repo ShaurmaClub/MediaCode
```

Скрипт:
- сгенерирует **отдельные** Ed25519 SSH-ключи для `production` (`deploy-prod`) и `staging` (`deploy-stage`);
- добавит публичные ключи в `/home/deploy-prod/.ssh/authorized_keys` и `/home/deploy-stage/.ssh/authorized_keys`;
- снимет и проверит отпечатки `SSH_KNOWN_HOSTS` сервера (для строгой проверки `StrictHostKeyChecking=yes`);
- загрузит секреты в GitHub Environments `production` и `staging`;
- удалит временные приватные ключи с диска.

> **Важно:** Если вы запускали `setup-github.sh` непосредственно на сервере, после завершения выполните `gh auth logout`, чтобы не оставлять токен GitHub на production-машине.

---

## 4. Создание учётной записи первого администратора

После установки создайте администратора в контуре `production`:

```bash
sudo -u mediacode-prod env \
  ENV_FILE=/var/lib/mediacode/production/.env \
  DB_PATH=/var/lib/mediacode/production/data/media.db \
  node /opt/mediacode/production/current/server/create-admin.js
```

---

## Краткая памятка для DevOps (Quickstart в 4 команды)

1. **Настройте DNS:** направьте `A`-записи `kaiton.ru`, `www.kaiton.ru` и `stage.kaiton.ru` на IP сервера.
2. **Разверните сервер (Ubuntu 24.04):**
   ```bash
   git clone -b ci/cd-ubuntu24 https://github.com/ShaurmaClub/MediaCode.git /tmp/mc && sudo bash /tmp/mc/deploy/install.sh
   ```
3. **Привяжите GitHub Environments (`production` и `staging`):**
   ```bash
   gh auth login
   bash /tmp/mc/deploy/setup-github.sh --host kaiton.ru --repo ShaurmaClub/MediaCode
   gh auth logout
   ```
4. **Проверьте готовность:**
   ```bash
   curl -fsS http://127.0.0.1:4000/api/health/ready && curl -fsS http://127.0.0.1:4001/api/health/ready
   ```
