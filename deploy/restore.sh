#!/usr/bin/env bash
# ==============================================================================
# МедиаКод — Безопасная процедура восстановления из резервной копии (Disaster Recovery)
#
# Примеры:
#   1. Список доступных резервных копий:
#      sudo bash deploy/restore.sh --env=production --list
#   2. Тестовое восстановление БЕЗ остановки и БЕЗ затрагивания production:
#      sudo bash deploy/restore.sh --env=production --backup=latest --test-restore
#   3. Полное восстановление с остановкой сервиса и последующим healthcheck:
#      sudo bash deploy/restore.sh --env=production --backup=media-20261021-030000 --confirm
# ==============================================================================

set -u
set -o pipefail

RESTORE_ENV="production"
BACKUP_SPEC="latest"
MODE=""
BASE_OPT_DIR="${BASE_OPT_DIR:-/opt/mediacode}"
BASE_DATA_DIR="${BASE_DATA_DIR:-/var/lib/mediacode}"

for arg in "$@"; do
  case "$arg" in
    --env=*) RESTORE_ENV="${arg#*=}" ;;
    --backup=*) BACKUP_SPEC="${arg#*=}" ;;
    --list) MODE="list" ;;
    --test-restore|--dry-run) MODE="test" ;;
    --confirm) MODE="confirm" ;;
  esac
done

if [ "$RESTORE_ENV" != "production" ] && [ "$RESTORE_ENV" != "staging" ]; then
  echo "❌ Укажите --env=production или --env=staging"
  exit 1
fi

if [ "$RESTORE_ENV" = "production" ]; then
  SERVICE_NAME="mediacode-prod"
  APP_PORT="4000"
else
  SERVICE_NAME="mediacode-stage"
  APP_PORT="4001"
fi

CURRENT_DIR="${BASE_OPT_DIR}/${RESTORE_ENV}/current"
STATE_DIR="${BASE_DATA_DIR}/${RESTORE_ENV}"
ENV_FILE="${STATE_DIR}/.env"

if [ ! -d "$CURRENT_DIR" ]; then
  # Fallback для локальной разработки
  CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

export DB_PATH="${DB_PATH:-${STATE_DIR}/data/media.db}"
export BACKUP_DIR="${BACKUP_DIR:-${STATE_DIR}/data/backups}"
export UPLOAD_DIR="${UPLOAD_DIR:-${STATE_DIR}/uploads/recruitment}"

if [ "$MODE" = "list" ]; then
  cd "$CURRENT_DIR" && node server/restore.js --list
  exit $?
fi

if [ "$MODE" = "test" ]; then
  echo "🧪 Запуск изолированного тестового восстановления (${RESTORE_ENV}, копия: ${BACKUP_SPEC})..."
  cd "$CURRENT_DIR" && node server/restore.js "--backup=${BACKUP_SPEC}" --test-restore
  exit $?
fi

if [ "$MODE" != "confirm" ]; then
  echo "Использование:"
  echo "  bash deploy/restore.sh --env=production --list"
  echo "  bash deploy/restore.sh --env=production --backup=latest --test-restore"
  echo "  sudo bash deploy/restore.sh --env=production --backup=<backupId> --confirm"
  exit 1
fi

echo "=================================================================="
echo "⚠️ БОЕВОЕ ВОССТАНОВЛЕНИЕ ДАННЫХ (${RESTORE_ENV})"
echo "   Копия:   ${BACKUP_SPEC}"
echo "   Сервис:  ${SERVICE_NAME}"
echo "=================================================================="

# 1. Предварительная проверка целостности выбранного бэкапа ДО остановки сервиса
echo "🔍 Шаг 1/6: Проверка целостности и совместимости резервной копии..."
(cd "$CURRENT_DIR" && node server/restore.js "--backup=${BACKUP_SPEC}" --test-restore) || {
  echo "❌ Выбранная резервная копия не прошла проверку! Сервис НЕ останавливался."
  exit 1
}

# 2. Создание страховочного снимка текущего состояния (если БД существует)
if [ -f "$DB_PATH" ]; then
  echo "💾 Шаг 2/6: Создание страховочной копии текущего состояния перед перезаписью..."
  (cd "$CURRENT_DIR" && node server/backup.js --with-uploads --reason=pre-restore) || {
    echo "⚠️ Предупреждение: не удалось создать страховочную копию текущей БД, продолжаем восстановление..."
  }
fi

# 3. Остановка записи данных (остановка systemd-сервиса)
echo "🛑 Шаг 3/6: Остановка сервиса ${SERVICE_NAME}..."
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1; then
  sudo -n systemctl stop "$SERVICE_NAME" || systemctl stop "$SERVICE_NAME" || {
    echo "❌ Не удалось остановить сервис ${SERVICE_NAME}!"
    exit 1
  }
fi

# 4. Восстановление базы данных и пользовательских файлов
echo "♻️ Шаг 4/6: Восстановление базы данных и загруженных файлов..."
(cd "$CURRENT_DIR" && node server/restore.js "--backup=${BACKUP_SPEC}" --confirm) || {
  echo "❌ Ошибка при восстановлении файлов БД/загрузок!"
  exit 1
}

if id mediacode >/dev/null 2>&1; then
  chown -R mediacode:mediacode "$(dirname "$DB_PATH")" "$UPLOAD_DIR" || true
fi

# 5. Проверка совместимости схемы и запуск сервиса
echo "🚀 Шаг 5/6: Проверка схемы БД и запуск сервиса ${SERVICE_NAME}..."
(cd "$CURRENT_DIR" && node server/migrate.js --verify) || {
  echo "❌ Схема восстановленной БД не прошла проверку!"
  exit 1
}

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1; then
  sudo -n systemctl start "$SERVICE_NAME" || systemctl start "$SERVICE_NAME" || {
    echo "❌ Не удалось запустить сервис ${SERVICE_NAME}!"
    exit 1
  }

  # 6. Healthcheck после восстановления
  echo "🩺 Шаг 6/6: Проверка /api/health/ready..."
  for i in $(seq 1 15); do
    if curl -fsS --max-time 4 "http://127.0.0.1:${APP_PORT}/api/health/ready" | grep -q '"ok":true'; then
      echo "✅ Восстановление окружения '${RESTORE_ENV}' из копии '${BACKUP_SPEC}' успешно завершено!"
      exit 0
    fi
    sleep 2
  done
  echo "❌ Сервис не ответил 200 OK на /api/health/ready после восстановления!"
  exit 1
fi

echo "✅ Файлы БД и загрузок успешно восстановлены."
exit 0
