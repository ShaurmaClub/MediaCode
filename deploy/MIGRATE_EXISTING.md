# Миграция существующего MediaCode

Это не чистая установка. Начинать с `LEGACY_AUDIT.md`. На Vavilon запрещено выполнять `install.sh`: там Ubuntu 22.04, Caddy и действующий `mediacode.service`. Ни ОС, ни proxy, ни firewall скрипт подготовки не меняет.

Решение 29.10: **оставляем Ubuntu 22.04 и Caddy**. Provisioning только после отдельного разрешения, через `provision-vavilon.sh`; правила доступа и Tailscale OIDC — в `VAVILON_OIDC.md`.

## 1. Read-only проверка

Из отдельного checkout review-ветки на сервере:

```bash
umask 077
bash deploy/inspect-legacy.sh --legacy-dir /srv/services/MediaCode > LEGACY_AUDIT.current.md
npm ci
bash deploy/migrate-existing.sh --dry-run \
  --legacy-dir /srv/services/MediaCode \
  --db /srv/services/MediaCode/data/media.db \
  --env /srv/services/MediaCode/.env \
  --uploads /srv/services/MediaCode/uploads \
  --output /home/no1se/mediacode-migration-private/TRIAL_ID \
  --service mediacode --port 4000
```

`npm ci` — только в отдельном checkout, не в работающем сайте. Явные пути сверяются с `.env`. При overrides в systemd сначала согласовать эффективные пути, а не обходить проверку. `--dry-run` не создаёт каталоги/копии, открывает SQLite read-only с учётом WAL. SQLite может обслуживать свой существующий SHM при read-only соединении; скрипт не выполняет checkpoint и не изменяет записи.

## 2. Подготовка на копиях

Повторить ту же команду с `--apply` и новым уникальным TRIAL_ID. Это **подготовка**, не разрешение на переключение. Выходной путь обязан быть вне legacy и вне активных production/staging-каталогов. Уже существующий bundle не перезаписывается.

Результат с правами 0700:

```text
TRIAL_ID/
  backup/media.db             online SQLite backup, включая WAL
  backup/.env                 исходный файл без изменения SESSION_SECRET
  backup/uploads/             весь явно указанный uploads root
  trial/media.db              отдельная восстановленная и мигрированная БД
  trial/uploads/              отдельные файлы
  manifest.json               integrity/schema/counts/SHA-256; никаких секретов
```

Проверяются свободное место, доступность файлов, владельцы, согласованность путей, integrity_check исходной БД/снимка/пробной БД, сохранность числа пользователей/задач/заявок/баллов, хеши uploads и неизменность исходной конфигурации. Symlink uploads требуют ручного разбора и блокируют подготовку. Миграция запускается с отдельными DB_PATH/UPLOAD_DIR, без токенов интеграций. Пробная база **не является staging** и не публикуется. Нельзя копировать production-персональные данные в общедоступный staging.

Далее на приватной пробной БД проверить логин существующего тестового пользователя/формат sessions, роли, скачивание файлов только после авторизации, карточки и числа записей. Скрипт не объявляет успешную миграцию схемы доказательством совместимости всех пользовательских сценариев.

`node deploy/probe-prepared.mjs /absolute/TRIAL_ID` проверяет запуск приложения, readiness, `/auth/me` на синтетической сессии существующего пользователя **в trial-копии** с сохранённым SESSION_SECRET и запрет прямого `/uploads/`. Запускать в контейнере без внешней сети, с готовым `dist`; production не монтировать для этой проверки. Персональные поля не выводятся. Вход с настоящим паролем и пользовательская приёмка остаются отдельными пунктами.

## 3. Копия вне сервера

Выбрать зашифрованное внешнее хранилище. Например, настроенный отдельно restic repository:

```bash
restic backup --tag mediacode-pre-migration /home/no1se/mediacode-migration-private/TRIAL_ID
restic check
restic snapshots --tag mediacode-pre-migration
restic restore SNAPSHOT_ID --target /private/offsite-restore-test
sha256sum /private/offsite-restore-test/home/no1se/mediacode-migration-private/TRIAL_ID/backup/media.db
```

Сверить dbSha256/файлы из manifest и integrity_check восстановленной БД. Предпочтительно выполнить restore на другом защищённом хосте. Не хранить пароль restic в GitHub log или shell history. Без проверенной внешней копии переключение не разрешать.

## 4. Provisioning — только после отдельного разрешения

Для первой миграции согласованы Ubuntu 22.04 и Caddy. Не обновлять ОС, не заменять proxy и не запускать чистый installer поверх legacy. Сначала выполнить `provision-vavilon.sh --check`; обнаруженные legacy permissions исправляются только отдельным разрешённым действием. `--apply` на Vavilon сейчас не разрешён.

Администратор отдельно создаёт runtime `mediacode-prod`/`mediacode-stage` и deploy `deploy-prod`/`deploy-stage`, раздельные группы. Staging/deploy-stage не должны входить в production-группы. До этого закрыть legacy-данные от будущих staging-пользователей. Код принадлежит deploy/runtime-group с 0750, данные — runtime/runtime 0700, `.env` 0600. Provisioning systemd/sudoers берётся из проверенных шаблонов и рассматривается как отдельная конфигурационная правка. В sudoers использовать точные имена `.service`; deploy-stage не получает production sudo.

Канонические пути:

| Контур | Код | БД | Uploads | Env / Backups |
| --- | --- | --- | --- | --- |
| prod | `/opt/mediacode/production/releases/SHA` | `/var/lib/mediacode/production/data/media.db` | `/var/lib/mediacode/production/uploads/recruitment` | `/var/lib/mediacode/production/.env`, `backups/` |
| stage | `/opt/mediacode/staging/releases/SHA` | `/var/lib/mediacode/staging/data/media.db` | `/var/lib/mediacode/staging/uploads/recruitment` | `/var/lib/mediacode/staging/.env`, `backups/` |

`.env` production получить из **копии исходного**: сохранить все нужные значения и SESSION_SECRET, изменить только проверенные пути, HOST=127.0.0.1, PORT, PUBLIC_ORIGIN, DEPLOY_ENV. Не выполнять `source .env` как shell. Не передавать production MAX/Telegram-токены в staging. Релиз содержит symlinks `data` и `uploads`; `.env` хранится только снаружи релиза и загружается systemd.

## 5. Момент переключения — сейчас НЕ выполнять

Чек-лист администратора:

- [ ] Review изменений, зелёные CI и лаборатория; CD variables остаются false.
- [ ] Повторный read-only аудит именно перед окном, сверены SHA, пути, права и отсутствие новых сторонних writer.
- [ ] Утверждены SHA, целевой host/ОС, proxy, runtime/deploy-права и окно обслуживания.
- [ ] Есть успешная приватная пробная миграция и отдельно пройдены пользовательские сценарии.
- [ ] Внешний зашифрованный backup восстановлен на другом защищённом хосте, сверены manifest/hashes/integrity.
- [ ] Сохранены действующие Caddyfile, старый systemd unit, конфигурация приложения и TLS-метаданные; private keys/секреты не попали в отчёт/Git.
- [ ] Проверена offsite-копия и тест восстановления; сохранены старый SHA, unit, Caddyfile и TLS-метаданные.
- [ ] Получено явное разрешение на переключение production.
- [ ] Остановить ТОЛЬКО старый MediaCode: `sudo systemctl stop mediacode.service`; убедиться, что нет другого writer/container/PM2 к этой БД.
- [ ] Сделать финальный bundle `--apply` после остановки записи и новую offsite-копию. Online-подготовка до остановки не заменяет этот снимок.
- [ ] Скопировать backup БД и uploads в пустой целевой production data root; НЕ использовать trial БД как источник финальных данных. Сохранить legacy-файлы на месте.
- [ ] Мигрировать целевую БД новой версией, проверить integrity/counts/session compatibility. Старый и новый процесс никогда не пишут в одну БД.
- [ ] Запустить проверенный новый systemd unit на `127.0.0.1:4000`; Caddy продолжает проксировать на этот порт. Старый unit оставить остановленным; отключение его автозапуска — отдельная одобренная правка.
- [ ] Проверить через существующий Caddy точный SHA/readiness, login/session, RBAC, задачи, файлы, пользователей, HTTPS обоих доменов, логи и остальные сервисы.
- [ ] До открытия записи выполнить решение go/rollback. После открытия записи откат к старому снимку теряет новые записи: сначала сохранить новый снимок, согласовать потерю/перенос данных.

## 6. Откат

Внутри новой release-структуры `remote-deploy.sh` откатывает **код** на previous без перезаписи БД/uploads, предварительно проверяя схему read-only. При несовместимости код 31, ручное решение. `migrate.js --verify-rollback` не импортирует модуль с миграциями.

При первом переносе до открытия пользовательской записи: остановить новый unit, проверить целостность untouched legacy, вернуть старый unit/проверенный proxy. Не запускать два unit на одном порту. После открытия записи сначала согласовать обработку изменений, появившихся в новом контуре: возвращение к legacy-снимку их не содержит.

Восстановление снимка новой структуры:

```bash
sudo bash /opt/mediacode/production/current/deploy/restore.sh --env=production --backup=BACKUP_ID --test-restore
sudo bash /opt/mediacode/production/current/deploy/restore.sh --env=production --backup=BACKUP_ID --confirm
```

При неудачном страховочном бэкапе restore завершится кодом 20 до остановки сервиса. `--allow-no-safety-backup` разрешён только после отдельного решения администратора о риске потери текущих данных. Не добавлять его в CI/alias.

Коды remote-deploy: 0 успех/тот же здоровый SHA, 10 неверные параметры/lock, 20 backup блокирует, 21 подготовка/миграция не прошла, 30 откат восстановил previous, 31 автоматическое восстановление не завершено. При 31 проверить логи и состояние сервиса вручную, не выполнять автоматическое восстановление БД.
