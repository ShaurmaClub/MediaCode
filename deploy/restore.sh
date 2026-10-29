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

# Destructive restore is an administrator operation, not a deploy capability.
[[ "$EUID" = 0 ]] || { echo 'Administrator-only restore: deploy sudo does not grant data restore.' >&2; exit 10; }

RESTORE_ENV="production"
BACKUP_SPEC="latest"
MODE=""
ALLOW_NO_SAFETY_BACKUP=0
BASE_OPT_DIR="${BASE_OPT_DIR:-/opt/mediacode}"
BASE_DATA_DIR="${BASE_DATA_DIR:-/var/lib/mediacode}"

while [ $# -gt 0 ]; do
  case "$1" in
    --env=*) RESTORE_ENV="${1#*=}"; shift ;;
    --env) RESTORE_ENV="${2:-}"; shift 2 ;;
    --backup=*) BACKUP_SPEC="${1#*=}"; shift ;;
    --backup) BACKUP_SPEC="${2:-}"; shift 2 ;;
    --list) MODE="list"; shift ;;
    --test-restore|--dry-run) MODE="test"; shift ;;
    --confirm) MODE="confirm"; shift ;;
    --allow-no-safety-backup) ALLOW_NO_SAFETY_BACKUP=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 10 ;;
  esac
done

if [ "$RESTORE_ENV" != "production" ] && [ "$RESTORE_ENV" != "staging" ]; then
  echo "❌ Укажите --env=production или --env=staging"
  exit 1
fi

if [ "$RESTORE_ENV" = "production" ]; then
  SERVICE_NAME="mediacode-prod"
  RUNTIME_USER="${RUNTIME_USER:-mediacode-prod}"
  APP_PORT="4000"
else
  SERVICE_NAME="mediacode-stage"
  RUNTIME_USER="${RUNTIME_USER:-mediacode-stage}"
  APP_PORT="4001"
fi

CURRENT_DIR="${BASE_OPT_DIR}/${RESTORE_ENV}/current"
STATE_DIR="${BASE_DATA_DIR}/${RESTORE_ENV}"
ENV_FILE="${STATE_DIR}/.env"

if [ ! -d "$CURRENT_DIR" ]; then
  CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

DB_PATH="${DB_PATH:-${STATE_DIR}/data/media.db}"
BACKUP_DIR="${BACKUP_DIR:-${STATE_DIR}/backups}"
UPLOAD_DIR="${UPLOAD_DIR:-${STATE_DIR}/uploads/recruitment}"

run_as_runtime() {
  if [ "${RUN_AS_CURRENT_USER:-0}" = "1" ] || [ "$(id -un)" = "$RUNTIME_USER" ]; then
    /usr/bin/env \
      ENV_FILE="$ENV_FILE" \
      DB_PATH="$DB_PATH" \
      BACKUP_DIR="$BACKUP_DIR" \
      UPLOAD_DIR="$UPLOAD_DIR" \
      UPLOADS_DIR="$UPLOAD_DIR" \
      "$@"
  else
    /usr/sbin/runuser -u "$RUNTIME_USER" -- /usr/bin/env \
      ENV_FILE="$ENV_FILE" \
      DB_PATH="$DB_PATH" \
      BACKUP_DIR="$BACKUP_DIR" \
      UPLOAD_DIR="$UPLOAD_DIR" \
      UPLOADS_DIR="$UPLOAD_DIR" \
      "$@"
  fi
}

if [ "$MODE" = "list" ]; then
  (cd "$CURRENT_DIR" && run_as_runtime /usr/bin/node server/restore.js --list)
  exit $?
fi

if [ "$MODE" = "test" ]; then
  echo "🧪 Запуск изолированного тестового восстановления (${RESTORE_ENV}, копия: ${BACKUP_SPEC})..."
  (cd "$CURRENT_DIR" && run_as_runtime /usr/bin/node server/restore.js "--backup=${BACKUP_SPEC}" --test-restore)
  exit $?
fi

if [ "$MODE" != "confirm" ]; then
  echo "Использование:"
  echo "  sudo bash deploy/restore.sh --env=production --list"
  echo "  sudo bash deploy/restore.sh --env=production --backup=latest --test-restore"
  echo "  sudo bash deploy/restore.sh --env=production --backup=<backupId> --confirm"
  exit 1
fi

echo "=================================================================="
echo "⚠️ БОЕВОЕ ВОССТАНОВЛЕНИЕ ДАННЫХ (${RESTORE_ENV})"
echo "   Копия:   ${BACKUP_SPEC}"
echo "   Сервис:  ${SERVICE_NAME} (runtime user: ${RUNTIME_USER})"
echo "=================================================================="

# 1. Предварительная проверка целостности выбранного бэкапа ДО остановки сервиса
echo "🔍 Шаг 1/6: Проверка целостности и совместимости резервной копии..."
(cd "$CURRENT_DIR" && run_as_runtime /usr/bin/node server/restore.js "--backup=${BACKUP_SPEC}" --test-restore) || {
  echo "❌ Выбранная резервная копия не прошла проверку! Сервис НЕ останавливался."
  exit 1
}

# 2. Создание страховочного снимка текущего состояния (если БД существует)
if run_as_runtime /bin/test -f "$DB_PATH"; then
  echo "💾 Шаг 2/6: Создание страховочной копии текущего состояния перед перезаписью..."
  (cd "$CURRENT_DIR" && run_as_runtime /usr/bin/node server/backup.js --with-uploads --reason=pre-restore) || {
    if [ "$ALLOW_NO_SAFETY_BACKUP" != 1 ]; then
      echo 'Safety backup failed; restore blocked before stopping the service (code 20).' >&2
      echo 'Only with separate administrator approval: --allow-no-safety-backup' >&2
      exit 20
    fi
    echo 'WARNING: explicit --allow-no-safety-backup override; current data may be unrecoverable.' >&2
  }
fi

# 3. Остановка записи данных (остановка systemd-сервиса и проверка отсутствия активного процесса)
echo "🛑 Шаг 3/6: Остановка сервиса ${SERVICE_NAME}..."
command -v systemctl >/dev/null 2>&1 || { echo 'No service controller; restore blocked.' >&2; exit 10; }
systemctl cat "${SERVICE_NAME}.service" >/dev/null 2>&1 || { echo 'Expected service not installed; restore blocked.' >&2; exit 10; }
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1; then
  systemctl stop "$SERVICE_NAME" || sudo -n systemctl stop "$SERVICE_NAME" || {
    echo "❌ Не удалось остановить сервис ${SERVICE_NAME}!"
    exit 1
  }
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo "❌ Сервис ${SERVICE_NAME} всё ещё активен — замена файла БД заблокирована во избежание повреждения!"
    exit 1
  fi
fi

# 4. Восстановление базы данных и пользовательских файлов
echo "♻️ Шаг 4/6: Восстановление базы данных и загруженных файлов..."
(cd "$CURRENT_DIR" && run_as_runtime /usr/bin/node server/restore.js "--backup=${BACKUP_SPEC}" --confirm) || {
  echo "❌ Ошибка при восстановлении файлов БД/загрузок!"
  exit 1
}

if id -u "$RUNTIME_USER" >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ]; then
  chown -R "${RUNTIME_USER}:${RUNTIME_USER}" "$(dirname "$DB_PATH")" "$UPLOAD_DIR" || true
fi

# 5. Проверка совместимости схемы и запуск сервиса
echo "🚀 Шаг 5/6: Проверка схемы БД и запуск сервиса ${SERVICE_NAME}..."
(cd "$CURRENT_DIR" && run_as_runtime /usr/bin/node server/migrate.js --verify) || {
  echo "❌ Схема восстановленной БД не прошла проверку!"
  exit 1
}

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1; then
  systemctl start "$SERVICE_NAME" || sudo -n systemctl start "$SERVICE_NAME" || {
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
