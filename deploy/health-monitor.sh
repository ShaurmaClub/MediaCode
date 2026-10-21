#!/usr/bin/env bash
# ==============================================================================
# МедиаКод — Комплексный мониторинг и диагностика окружения (Ubuntu 24.04)
# Различает сбои:
#   1. systemd-сервиса (PROCESS_DOWN)
#   2. HTTP-приложения (APP_UNREACHABLE)
#   3. Базы данных и схемы SQLite (DB_ERROR / SCHEMA_MISMATCH)
#   4. Прокси Nginx (PROXY_ERROR)
#   5. SSL-сертификата Let's Encrypt (SSL_EXPIRING)
#   6. Актуальности резервных копий (BACKUP_STALE)
# ==============================================================================

set -u
set -o pipefail

CHECK_ENV="${CHECK_ENV:-production}"
DOMAIN="${DOMAIN:-kaiton.ru}"
BASE_OPT_DIR="${BASE_OPT_DIR:-/opt/mediacode}"
BASE_DATA_DIR="${BASE_DATA_DIR:-/var/lib/mediacode}"
STATE_FILE="/tmp/mediacode-monitor-${CHECK_ENV}.state"

if [ "$CHECK_ENV" = "production" ]; then
  SERVICE_NAME="${SERVICE_NAME:-mediacode-prod}"
  APP_PORT="${APP_PORT:-4000}"
else
  SERVICE_NAME="${SERVICE_NAME:-mediacode-stage}"
  APP_PORT="${APP_PORT:-4001}"
fi

CURRENT_DIR="${BASE_OPT_DIR}/${CHECK_ENV}/current"
ENV_FILE="${BASE_DATA_DIR}/${CHECK_ENV}/.env"
BACKUP_DIR="${BASE_DATA_DIR}/${CHECK_ENV}/data/backups"

FAIL_CATEGORY=""
FAIL_REASON=""

# 1. Проверка systemd-сервиса
if ! systemctl is-active --quiet "$SERVICE_NAME"; then
  FAIL_CATEGORY="PROCESS_DOWN"
  FAIL_REASON="Сервис systemd ${SERVICE_NAME} не запущен (status != active)"
fi

# 2-3. Проверка приложения, SQLite и схемы БД через /api/health/ready
if [ -z "$FAIL_CATEGORY" ]; then
  HEALTH_JSON="$(curl -fsS --max-time 5 "http://127.0.0.1:${APP_PORT}/api/health/ready" 2>/dev/null || true)"
  if [ -z "$HEALTH_JSON" ]; then
    FAIL_CATEGORY="APP_UNREACHABLE"
    FAIL_REASON="Приложение на 127.0.0.1:${APP_PORT}/api/health/ready не отвечает по HTTP"
  else
    DIAG="$(HEALTH_JSON="$HEALTH_JSON" node -e '
      try {
        const d = JSON.parse(process.env.HEALTH_JSON);
        if (d.db !== "ok") { console.log("DB_ERROR:SQLite не отвечает"); process.exit(0); }
        if (!d.schemaCompatible) { console.log("SCHEMA_MISMATCH:Несовместима схема БД"); process.exit(0); }
        if (!d.frontendReady) { console.log("FRONTEND_MISSING:Отсутствует dist/index.html"); process.exit(0); }
        if (!d.ok) { console.log("APP_DEGRADED:Статус ok=false"); process.exit(0); }
        console.log("OK");
      } catch {
        console.log("APP_INVALID_JSON:Некорректный JSON от /api/health/ready");
      }
    ')"
    if [ "$DIAG" != "OK" ]; then
      FAIL_CATEGORY="${DIAG%%:*}"
      FAIL_REASON="${DIAG#*:}"
    fi
  fi
fi

# 4. Проверка Nginx reverse proxy
if [ -z "$FAIL_CATEGORY" ]; then
  if ! systemctl is-active --quiet nginx; then
    FAIL_CATEGORY="PROXY_ERROR"
    FAIL_REASON="Сервис Nginx не запущен"
  fi
fi

# 5. Проверка срока действия SSL-сертификата (если установлен)
CERT_PATH="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
if [ -z "$FAIL_CATEGORY" ] && [ -f "$CERT_PATH" ]; then
  # Предупреждение, если сертификат истекает менее чем через 7 дней (604800 секунд)
  if ! openssl x509 -checkend 604800 -noout -in "$CERT_PATH" >/dev/null 2>&1; then
    FAIL_CATEGORY="SSL_EXPIRING"
    FAIL_REASON="SSL-сертификат для ${DOMAIN} истекает менее чем через 7 дней"
  fi
fi

# 6. Проверка свежести резервных копий (не старше 36 часов для production)
if [ -z "$FAIL_CATEGORY" ] && [ "$CHECK_ENV" = "production" ] && [ -d "$BACKUP_DIR" ]; then
  RECENT_BACKUP="$(find "$BACKUP_DIR" -maxdepth 1 -name 'media-*.db' -mmin -2160 | head -n 1)"
  if [ -z "$RECENT_BACKUP" ] && [ -f "${BASE_DATA_DIR}/${CHECK_ENV}/data/media.db" ]; then
    FAIL_CATEGORY="BACKUP_STALE"
    FAIL_REASON="В ${BACKUP_DIR} нет свежих резервных копий БД за последние 36 часов"
  fi
fi

PREV_STATE="OK"
if [ -f "$STATE_FILE" ]; then
  PREV_STATE="$(cat "$STATE_FILE" 2>/dev/null || echo "OK")"
fi

if [ -z "$FAIL_CATEGORY" ]; then
  echo "OK" > "$STATE_FILE"
  echo "✅ [MONITOR:${CHECK_ENV}] Все подсистемы (systemd, app, db, schema, nginx, ssl, backup) в норме."
  exit 0
fi

echo "❌ [MONITOR:${CHECK_ENV}] Категория: ${FAIL_CATEGORY} | Причина: ${FAIL_REASON}"

# Отправляем алерт только при смене состояния, чтобы не спамить каждые 2 минуты
if [ "$PREV_STATE" != "$FAIL_CATEGORY" ]; then
  echo "$FAIL_CATEGORY" > "$STATE_FILE"
  if [ -f "$ENV_FILE" ] && [ -f "${CURRENT_DIR}/scripts/ci-notify.mjs" ]; then
    (
      set -a
      # shellcheck disable=SC1090
      source "$ENV_FILE"
      set +a
      export DEPLOY_ENV="$CHECK_ENV"
      export CI_STATUS="failure"
      export CI_EVENT_TYPE="outage"
      export CI_STAGE="Мониторинг (${FAIL_CATEGORY})"
      export CI_REASON="${FAIL_REASON}"
      node "${CURRENT_DIR}/scripts/ci-notify.mjs"
    ) || true
  fi
fi

exit 1
