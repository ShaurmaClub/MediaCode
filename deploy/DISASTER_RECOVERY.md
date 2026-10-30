# Аварийное восстановление (DISASTER_RECOVERY.md)

Документ регламентирует процедуры восстановления базы данных SQLite, загруженных пользовательских файлов (`uploads/recruitment`) и полного восстановления сервера после сбоя.

---

## 1. Устройство системы резервного копирования

Каждый бэкап (предрелизный `pre-deploy` или ежедневный `daily-timer` по таймеру `mediacode-backup.timer`) сохраняется в `/var/lib/mediacode/<env>/backups/` (права `0750`, владелец `mediacode-<env>`) и включает:
1. **`media-<YYYYMMDD-HHMMSS>.db`** — консистентный онлайн-снимок SQLite, снятый через `db.backup()`, переведённый в однофайловый режим (`journal_mode = DELETE`) и проверенный `PRAGMA integrity_check`.
2. **`uploads-<YYYYMMDD-HHMMSS>/`** — полная копия пользовательских файлов из `/var/lib/mediacode/<env>/uploads/recruitment/`.
3. **`manifest-<YYYYMMDD-HHMMSS>.json`** — метаданные резервной копии (формируются до отправки во внешнее хранилище):
   - контрольная сумма `sha256` файла БД;
   - версия схемы БД (`schemaVersion`);
   - SHA активного релиза (`releaseSha`);
   - количество скопированных файлов `uploadsCount`.

Модуль `server/restore.js` использует чистый модуль констант `server/config/schema.js` и **не открывает рабочую БД при импорте**, исключая побочные миграции или блокировки при проверке резервных копий.

---

## 2. Безопасная проверка бэкапа без остановки Production (`--test-restore`)

Перед любым аварийным восстановлением (или для регулярной проверки бэкапов) выполните **тестовое восстановление в изолированный временный каталог**:

```bash
sudo bash /opt/mediacode/production/current/deploy/restore.sh \
  --env=production \
  --backup=latest \
  --test-restore
```

Эта команда:
- **не останавливает** `mediacode-prod.service` и не открывает рабочую БД;
- запускается от имени `mediacode-prod`;
- сверяет контрольную сумму `SHA-256` с `manifest-<stamp>.json`;
- выполняет `PRAGMA integrity_check` и проверяет совместимость версии схемы;
- разворачивает БД и файлы во временный каталог `/tmp/mediacode-test-restore-*`, проверяет таблицы и удаляет временный каталог.

---

## 3. Боевое восстановление БД и файлов на работающем сервере (`--confirm`)

Если требуется откатить базу данных и пользовательские файлы к состоянию из резервной копии:

### Шаг 1. Просмотрите доступные резервные копии
```bash
sudo bash /opt/mediacode/production/current/deploy/restore.sh --env=production --list
```

### Шаг 2. Запустите процедуру восстановления
Для восстановления из самой свежей копии:
```bash
sudo bash /opt/mediacode/production/current/deploy/restore.sh \
  --env=production \
  --backup=latest \
  --confirm
```

Для восстановления из конкретной копии:
```bash
sudo bash /opt/mediacode/production/current/deploy/restore.sh \
  --env=production \
  --backup=media-20261021-120000 \
  --confirm
```

### Что делает `deploy/restore.sh --confirm`:
1. Проверяет контрольную сумму `SHA-256`, `PRAGMA integrity_check` и совместимость версии схемы выбранного бэкапа до остановки сервиса.
2. Создаёт страховочный снимок текущего состояния (`reason=pre-restore`).
3. Останавливает `mediacode-prod.service` и убеждается через `systemctl is-active`, что процесс гарантированно завершён и соединения с SQLite закрыты.
4. Заменяет `/var/lib/mediacode/production/data/media.db` (удаляя старые `-wal` и `-shm`) и восстанавливает `/var/lib/mediacode/production/uploads/recruitment`.
5. Выставляет владельца `mediacode-prod:mediacode-prod`, проверяет схему через `server/migrate.js --verify` и запускает `mediacode-prod.service`.
6. Проверяет готовность приложения через `http://127.0.0.1:4000/api/health/ready`.

---

## 4. Полное восстановление при потере сервера (Full Server Rebuild)

Если сервер полностью утрачен и создаётся новая виртуальная машина Ubuntu Server 24.04 LTS:

1. **Разверните базовую инфраструктуру одной командой:**
   ```bash
   git clone -b ci/cd-ubuntu24 https://github.com/ShaurmaClub/MediaCode.git /tmp/mc
   sudo bash /tmp/mc/deploy/install.sh
   ```
2. **Получите архив бэкапов:**
   - Из внешнего хранилища `restic`:
     ```bash
     export RESTIC_REPOSITORY="s3:..."
     export RESTIC_PASSWORD="..."
     sudo -E restic restore latest --target /tmp/restored-backups
     sudo cp -a /tmp/restored-backups/var/lib/mediacode/production/backups/* /var/lib/mediacode/production/backups/
     sudo chown -R mediacode-prod:mediacode-prod /var/lib/mediacode/production/backups
     ```
   - Либо скопируйте сохранённые файлы `media-*.db`, `manifest-*.json` и `uploads-*` по `scp` в `/var/lib/mediacode/production/backups/` и выполните `sudo chown -R mediacode-prod:mediacode-prod /var/lib/mediacode/production/backups`.
3. **Запустите восстановление данных:**
   ```bash
   sudo bash /opt/mediacode/production/current/deploy/restore.sh --env=production --backup=latest --confirm
   ```
4. **Обновите привязку GitHub Actions к новому серверу:**
   ```bash
   bash /opt/mediacode/production/current/deploy/setup-github.sh --host <НОВЫЙ_IP>
   ```
