# Ежедневная эксплуатация MediaCode (OPERATIONS.md)

Документ содержит основные команды для мониторинга, перезапуска, чтения логов, ручного отката и обслуживания контуров `production` и `staging` на Ubuntu 24.04 LTS.

---

## 1. Проверка статуса сервисов и контуров

```bash
# Статус systemd-сервисов приложения
sudo systemctl status mediacode-prod.service
sudo systemctl status mediacode-stage.service

# Статус таймеров резервного копирования и мониторинга
sudo systemctl list-timers 'mediacode-*'

# Проверка readiness-проб (включает статус SQLite, версию схемы, наличие dist/ и SHA релиза)
curl -s http://127.0.0.1:4000/api/health/ready | jq .
curl -s http://127.0.0.1:4001/api/health/ready | jq .

# Просмотр активного и предыдущего релизов
ls -l /opt/mediacode/production/current /opt/mediacode/production/previous
ls -l /opt/mediacode/staging/current /opt/mediacode/staging/previous
```

---

## 2. Управление сервисами (перезапуск, остановка)

```bash
# Перезапуск Production
sudo systemctl restart mediacode-prod.service

# Перезапуск Staging
sudo systemctl restart mediacode-stage.service

# Перезагрузка конфигурации Nginx без разрыва соединений
sudo nginx -t && sudo systemctl reload nginx
```

---

## 3. Чтение логов

Все логи приложения и сервисных задач пишутся в `systemd-journald`:

```bash
# Логи Production в реальном времени
sudo journalctl -u mediacode-prod.service -f

# Последние 100 строк логов Staging
sudo journalctl -u mediacode-stage.service -n 100 --no-pager

# Логи ежедневного резервного копирования
sudo journalctl -u mediacode-backup.service -n 50 --no-pager

# Логи локального монитора доступности
sudo journalctl -u mediacode-monitor.service -n 50 --no-pager

# Логи Nginx
sudo tail -n 100 /var/log/nginx/access.log /var/log/nginx/error.log
```

---

## 4. Ручной откат на предыдущий релиз (Manual Rollback)

Если требуется вручную вернуть предыдущий рабочий релиз (без перезаписи базы данных):

```bash
PREV_TARGET="$(readlink -f /opt/mediacode/production/previous)"
echo "Откат на: ${PREV_TARGET}"

# 1. Проверяем совместимость текущей БД с кодом предыдущего релиза от имени mediacode-prod
sudo -u mediacode-prod env \
  ENV_FILE=/var/lib/mediacode/production/.env \
  DB_PATH=/var/lib/mediacode/production/data/media.db \
  node "${PREV_TARGET}/server/migrate.js" --verify-rollback

# 2. Переключаем симлинк current и перезапускаем сервис
sudo -u deploy-prod ln -sfn "${PREV_TARGET}" /opt/mediacode/production/current
sudo systemctl restart mediacode-prod.service
curl -fsS http://127.0.0.1:4000/api/health/ready
```

Если же требуется полное восстановление **вместе с базой данных и файлами** из резервной копии — используйте процедуру из `deploy/DISASTER_RECOVERY.md`.

---

## 5. Ручной запуск резервного копирования

```bash
# Запустить внеочередной бэкап обоих контуров через systemd
sudo systemctl start mediacode-backup.service

# Проверить созданные архивы и манифесты
sudo ls -lh /var/lib/mediacode/production/backups/
```

---

## 6. Обслуживание TLS-сертификатов Let's Encrypt

Сертификаты обновляются автоматически через системный таймер `certbot.timer`.

```bash
# Проверка таймера Certbot
sudo systemctl status certbot.timer

# Тестовая проверка продления сертификатов (dry-run)
sudo certbot renew --dry-run
```
