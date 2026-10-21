# Аварийное восстановление (DISASTER_RECOVERY.md)

Документ регламентирует процедуры восстановления базы данных SQLite, загруженных пользовательских файлов (`uploads`) и полного восстановления сервера после сбоя.

---

## 1. Устройство системы резервного копирования

Каждый бэкап (предрелизный `predeploy` или ежедневный `scheduled` по таймеру `mediacode-backup.timer`) сохраняется в `/var/lib/mediacode/<env>/backups/` и включает:
1. **`media-<label>-<timestamp>.db`** — консистентный онлайн-снимок SQLite, снятый через `db.backup()` и проверенный `PRAGMA integrity_check`.
2. **`media-<label>-<timestamp>.uploads/`** — полная копия пользовательских файлов из `/var/lib/mediacode/<env>/uploads/`.
3. **`media-<label>-<timestamp>.manifest.json`** — метаданные резервной копии:
   - контрольная сумма `sha256` файла БД;
   - версия схемы БД (`schemaVersion`, `minCompatibleVersion`);
   - SHA активного релиза (`releaseSha`);
   - количество скопированных файлов `uploadsCount`.

Если в `/var/lib/mediacode/<env>/.env` настроены `RESTIC_REPOSITORY` и `RESTIC_PASSWORD`, копия дополнительно отправляется во внешнее зашифрованное хранилище (`restic`). Если внешнее хранилище не настроено, система работает локально и выводит явное предупреждение в лог.

---

## 2. Безопасная проверка бэкапа без остановки Production (`--test-restore`)

Перед любым аварийным восстановлением (или для регулярной проверки бэкапов) выполните **тестовое восстановление в изолированный временный каталог**:

```bash
sudo bash /opt/mediacode/production/current/deploy/restore.sh \
  --env production \
  --test-restore
```

Эта команда:
- **не останавливает** `mediacode-prod.service` и не затрагивает рабочую БД;
- находит самый свежий бэкап (или указанный через `--backup <путь>`);
- сверяет контрольную сумму `SHA-256` с `.manifest.json`;
- выполняет `PRAGMA integrity_check` и проверяет совместимость версии схемы;
- разворачивает БД и файлы во временный каталог `/tmp/mediacode-restore-test-*`, проверяет таблицы и удаляет временный каталог.

---

## 3. Боевое восстановление БД и файлов на работающем сервере (`--confirm`)

Если требуется откатить базу данных и пользовательские файлы к состоянию из резервной копии:

### Шаг 1. Просмотрите доступные резервные копии
```bash
ls -lt /var/lib/mediacode/production/backups/*.db
```

### Шаг 2. Запустите процедуру восстановления
Для восстановления из самой свежей копии:
```bash
sudo bash /opt/mediacode/production/current/deploy/restore.sh \
  --env production \
  --confirm
```

Для восстановления из конкретной копии:
```bash
sudo bash /opt/mediacode/production/current/deploy/restore.sh \
  --env production \
  --backup /var/lib/mediacode/production/backups/media-predeploy-2026-10-21T12-00-00-000Z.db \
  --confirm
```

### Что делает `deploy/restore.sh --confirm`:
1. Проверяет контрольную сумму `SHA-256`, `PRAGMA integrity_check` и совместимость версии схемы выбранного бэкапа до остановки сервиса.
2. Останавливает `mediacode-prod.service` (чтобы исключить конкурирующую запись в WAL).
3. Создаёт страховочную копию текущего состояния БД (`media.db.pre-restore-<timestamp>.bak`) и загрузок (`uploads.pre-restore-<timestamp>`).
4. Заменяет `/var/lib/mediacode/production/data/media.db` (удаляя старые `-wal` и `-shm`) и восстанавливает `/var/lib/mediacode/production/uploads`.
5. Выставляет владельца `mediacode:mediacode` и запускает `mediacode-prod.service`.
6. Проверяет готовность приложения через `http://127.0.0.1:4000/api/health/ready`.

---

## 4. Полное восстановление при потере сервера (Full Server Rebuild)

Если сервер полностью утрачен и создаётся новая виртуальная машина Ubuntu Server 24.04 LTS:

1. **Разверните базовую инфраструктуру одной командой:**
   ```bash
   git clone https://github.com/ShaurmaClub/MediaCode.git /tmp/mc
   sudo bash /tmp/mc/deploy/install.sh
   ```
2. **Получите архив бэкапов:**
   - Из внешнего хранилища `restic`:
     ```bash
     export RESTIC_REPOSITORY="s3:..."
     export RESTIC_PASSWORD="..."
     sudo -E restic restore latest --target /tmp/restored-backups
     sudo cp -a /tmp/restored-backups/var/lib/mediacode/production/backups/* /var/lib/mediacode/production/backups/
     sudo chown -R mediacode:mediacode /var/lib/mediacode/production/backups
     ```
   - Либо скопируйте сохранённые файлы `media-*.db`, `*.manifest.json` и `*.uploads` по `scp` в `/var/lib/mediacode/production/backups/`.
3. **Запустите восстановление данных:**
   ```bash
   sudo bash /opt/mediacode/production/current/deploy/restore.sh --env production --confirm
   ```
4. **Обновите привязку GitHub Actions к новому серверу:**
   ```bash
   bash /opt/mediacode/production/current/deploy/setup-github.sh --host <НОВЫЙ_IP>
   ```
