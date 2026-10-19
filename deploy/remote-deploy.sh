#!/usr/bin/env bash
# ==============================================================================
# МедиаКод — Безопасный транзакционный скрипт деплоя на Ubuntu 24.04 (SSH)
# Поддерживает два режима запуска (переменная DEPLOY_MODE):
#   - systemd : классический деплой (npm ci -> npm run build -> systemctl restart)
#   - docker  : контейнерный деплой (docker compose up -d --build)
#   - auto    : автоопределение (если активен systemd-юнит — systemd, иначе docker)
#
# Включает:
#   1. Защиту от параллельного запуска (flock)
#   2. Автоматический онлайн-бэкап SQLite перед обновлением
#   3. Проверку /api/health после рестарта
#   4. Автоматический откат (Rollback) на предыдущий коммит при сбое healthcheck
# ==============================================================================

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/mediacode}"
BRANCH="${BRANCH:-main}"
SERVICE_NAME="${SERVICE_NAME:-mediacode}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4000/api/health}"
DEPLOY_MODE="${DEPLOY_MODE:-auto}"
LOCK_FILE="/tmp/mediacode-deploy-${SERVICE_NAME}.lock"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "❌ [DEPLOY] Другой процесс деплоя уже выполняется (${LOCK_FILE}). Выход."
  exit 1
fi

echo "========================================================"
echo "🚀 Старт деплоя МедиаКод"
echo "   Каталог:  ${APP_DIR}"
echo "   Ветка:    ${BRANCH}"
echo "   Сервис:   ${SERVICE_NAME}"
echo "   Режим:    ${DEPLOY_MODE}"
echo "========================================================"

if [ ! -d "$APP_DIR/.git" ]; then
  echo "❌ [DEPLOY] Каталог ${APP_DIR} не содержит git-репозиторий!"
  exit 1
fi

cd "$APP_DIR"

# Определяем режим работы (systemd или docker)
if [ "$DEPLOY_MODE" = "auto" ]; then
  if systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1 && systemctl is-enabled "${SERVICE_NAME}.service" >/dev/null 2>&1; then
    DEPLOY_MODE="systemd"
  elif command -v docker >/dev/null 2>&1 && [ -f "docker-compose.yml" ] && docker compose ps -q 2>/dev/null | grep -q .; then
    DEPLOY_MODE="docker"
  else
    DEPLOY_MODE="systemd"
  fi
  echo "ℹ️ [DEPLOY] Автоопределён режим: ${DEPLOY_MODE}"
fi

PREV_COMMIT="$(git rev-parse HEAD)"
echo "📌 Текущий коммит (точка отката): ${PREV_COMMIT}"

# 1. Резервное копирование базы данных перед деплоем
echo "💾 Шаг 1/5: Создание резервной копии SQLite..."
if [ "$DEPLOY_MODE" = "docker" ]; then
  docker compose exec -T mediacode npm run backup || echo "⚠️ Контейнер ещё не запущен, пропуск pre-deploy бэкапа"
else
  if [ -f "server/backup.js" ] && [ -d "node_modules" ]; then
    npm run backup || echo "⚠️ Не удалось выполнить бэкап (возможно, БД ещё не создана)"
  fi
fi

# 2. Обновление кода из Git
echo "📥 Шаг 2/5: Получение свежего кода из origin/${BRANCH}..."
git fetch --prune origin "$BRANCH"
git reset --hard "origin/${BRANCH}"
NEW_COMMIT="$(git rev-parse HEAD)"
echo "✅ Обновлено до коммита: ${NEW_COMMIT}"

# Функция сборки и перезапуска сервиса
build_and_restart() {
  if [ "$DEPLOY_MODE" = "docker" ]; then
    echo "🐳 Сборка и перезапуск Docker Compose..."
    docker compose up -d --build --remove-orphans
  else
    echo "📦 Установка зависимостей (npm ci) и сборка фронтенда (vite build)..."
    npm ci --no-audit --no-fund
    npm run build
    echo "🔄 Перезапуск systemd-сервиса ${SERVICE_NAME}..."
    sudo -n systemctl restart "$SERVICE_NAME"
  fi
}

# Функция проверки /api/health
check_health() {
  local retries=15
  local wait_sec=2
  echo "🩺 Проверка работоспособности (${HEALTH_URL})..."
  for i in $(seq 1 "$retries"); do
    if response="$(curl -fsS --max-time 4 "$HEALTH_URL" 2>/dev/null)"; then
      if echo "$response" | grep -q '"ok":true'; then
        echo "✅ Сервер ответил 200 OK: ${response}"
        return 0
      fi
    fi
    echo "⏳ Попытка ${i}/${retries}: сервис ещё не готов, ждём ${wait_sec} сек..."
    sleep "$wait_sec"
  done
  return 1
}

# 3-4. Сборка, рестарт и проверка здоровья
echo "⚙️ Шаг 3/5: Сборка проекта и перезапуск..."
if build_and_restart && check_health; then
  echo "🎉 Шаг 5/5: Деплой коммита ${NEW_COMMIT} успешно завершён!"
  exit 0
fi

# 5. Аварийный откат (Rollback) при падении сборки или /api/health
echo "🚨 ОШИБКА: Новая версия (${NEW_COMMIT}) не прошла проверку работоспособности!"
echo "⏪ Выполняется автоматический откат на рабочий коммит ${PREV_COMMIT}..."

git reset --hard "$PREV_COMMIT"
build_and_restart || true

if check_health; then
  echo "✅ Откат на ${PREV_COMMIT} выполнен успешно, работоспособность восстановлена."
else
  echo "❌ КРИТИЧЕСКАЯ ОШИБКА: После отката на ${PREV_COMMIT} сервис всё ещё не отвечает!"
fi

exit 1
