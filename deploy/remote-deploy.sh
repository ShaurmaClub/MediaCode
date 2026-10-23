#!/usr/bin/env bash
# ==============================================================================
# МедиаКод — Release-Based CD Script для Ubuntu Server 24.04 LTS
#
# Коды возврата (для точной диагностики в GitHub Actions и уведомлениях):
#   0  — Успешное обновление и прохождение всех 7 проверок работоспособности
#   10 — Ошибка входных параметров или блокировки параллельного деплоя
#   20 — Ошибка обязательного pre-deploy бэкапа (деплой заблокирован до изменений)
#   21 — Ошибка подготовки релиза / зависимостей / миграции (активный релиз не затронут)
#   30 — Сбой новой версии -> АВТОМАТИЧЕСКИЙ ROLLBACK ВЫПОЛНЕН УСПЕШНО
#   31 — КРИТИЧЕСКИЙ ИНЦИДЕНТ: Сбой новой версии И сбой автоматического Rollback
# ==============================================================================

set -u
set -o pipefail

DEPLOY_ENV="${DEPLOY_ENV:-}"
TARGET_SHA="${TARGET_SHA:-}"
REPO_URL="${REPO_URL:-https://github.com/ShaurmaClub/MediaCode.git}"
BASE_OPT_DIR="${BASE_OPT_DIR:-/opt/mediacode}"
BASE_DATA_DIR="${BASE_DATA_DIR:-/var/lib/mediacode}"
DIST_ARCHIVE="${DIST_ARCHIVE:-}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

if [ "$DEPLOY_ENV" != "production" ] && [ "$DEPLOY_ENV" != "staging" ]; then
  echo "❌ [DEPLOY] DEPLOY_ENV должен быть 'production' или 'staging' (получено: '${DEPLOY_ENV}')"
  exit 10
fi

if ! echo "$TARGET_SHA" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "❌ [DEPLOY] TARGET_SHA должен быть полным 40-символьным SHA коммита, прошедшего CI (получено: '${TARGET_SHA}')"
  exit 10
fi

if [ "$DEPLOY_ENV" = "production" ]; then
  SERVICE_NAME="${SERVICE_NAME:-mediacode-prod}"
  RUNTIME_USER="${RUNTIME_USER:-mediacode-prod}"
  APP_PORT="${APP_PORT:-4000}"
else
  SERVICE_NAME="${SERVICE_NAME:-mediacode-stage}"
  RUNTIME_USER="${RUNTIME_USER:-mediacode-stage}"
  APP_PORT="${APP_PORT:-4001}"
fi

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${APP_PORT}/api/health/ready}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${APP_PORT}}"
ENV_ROOT="${DEPLOY_PATH:-${BASE_OPT_DIR}/${DEPLOY_ENV}}"
RELEASES_DIR="${ENV_ROOT}/releases"
REPO_CACHE_DIR="${ENV_ROOT}/repo"
CURRENT_LINK="${ENV_ROOT}/current"
PREVIOUS_LINK="${ENV_ROOT}/previous"
STATE_DIR="${DATA_ROOT:-${BASE_DATA_DIR}/${DEPLOY_ENV}}"
ENV_FILE="${STATE_DIR}/.env"
LOCK_FILE="/tmp/mediacode-deploy-${DEPLOY_ENV}.lock"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "❌ [DEPLOY] Другой процесс деплоя для '${DEPLOY_ENV}' уже выполняется (${LOCK_FILE})."
  exit 10
fi

# Выполнение команд, требующих доступа к .env / SQLite / uploads, от имени изолированного runtime-пользователя (P1 #4)
run_as_runtime_user() {
  if [ "${RUN_AS_CURRENT_USER:-0}" = "1" ] || [ "$(id -un)" = "$RUNTIME_USER" ]; then
    /usr/bin/env \
      ENV_FILE="$ENV_FILE" \
      DEPLOY_ENV="$DEPLOY_ENV" \
      APP_ENV="$DEPLOY_ENV" \
      DB_PATH="${STATE_DIR}/data/media.db" \
      UPLOAD_DIR="${STATE_DIR}/uploads/recruitment" \
      UPLOADS_DIR="${STATE_DIR}/uploads/recruitment" \
      BACKUP_DIR="${STATE_DIR}/backups" \
      "$@"
  else
    sudo -n -u "$RUNTIME_USER" /usr/bin/env \
      ENV_FILE="$ENV_FILE" \
      DEPLOY_ENV="$DEPLOY_ENV" \
      APP_ENV="$DEPLOY_ENV" \
      DB_PATH="${STATE_DIR}/data/media.db" \
      UPLOAD_DIR="${STATE_DIR}/uploads/recruitment" \
      UPLOADS_DIR="${STATE_DIR}/uploads/recruitment" \
      BACKUP_DIR="${STATE_DIR}/backups" \
      "$@"
  fi
}

restart_contour_service() {
  if [ "${SKIP_SYSTEMCTL:-0}" = "1" ]; then
    return 0
  fi
  if [ "$(id -u)" -eq 0 ]; then
    systemctl restart "$SERVICE_NAME"
  else
    sudo -n /bin/systemctl restart "$SERVICE_NAME"
  fi
}

is_contour_service_active() {
  if [ "${SKIP_SYSTEMCTL:-0}" = "1" ]; then
    return 0
  fi
  if [ "$(id -u)" -eq 0 ]; then
    systemctl is-active --quiet "$SERVICE_NAME"
  else
    sudo -n /bin/systemctl is-active --quiet "$SERVICE_NAME"
  fi
}

echo "=================================================================="
echo "🚀 Старт Release-Based деплоя МедиаКод"
echo "   Окружение:    ${DEPLOY_ENV} (runtime user: ${RUNTIME_USER})"
echo "   Целевой SHA:  ${TARGET_SHA}"
echo "   Сервис:       ${SERVICE_NAME} (порт ${APP_PORT})"
echo "   Каталог:      ${ENV_ROOT}"
echo "   Данные:       ${STATE_DIR}"
echo "=================================================================="

if ! run_as_runtime_user /bin/test -f "$ENV_FILE"; then
  echo "❌ [DEPLOY] Не найден файл окружения ${ENV_FILE}. Сначала выполните установку сервера (deploy/install.sh)."
  exit 10
fi

mkdir -p "$RELEASES_DIR" || {
  echo "❌ [DEPLOY] Не удалось подготовить каталог релизов ${RELEASES_DIR}"
  exit 10
}

PREV_RELEASE_DIR=""
PREV_SHA=""
if [ -L "$CURRENT_LINK" ] && [ -d "$CURRENT_LINK" ]; then
  PREV_RELEASE_DIR="$(readlink -f "$CURRENT_LINK")"
  PREV_SHA="$(basename "$PREV_RELEASE_DIR")"
  echo "📌 Текущий активный релиз: ${PREV_SHA} (${PREV_RELEASE_DIR})"
else
  echo "ℹ️ Активный релиз ещё не установлен (первичное развёртывание)."
fi

# ==============================================================================
# ШАГ 1. ОБЯЗАТЕЛЬНЫЙ PRE-DEPLOY BACKUP (ОТ ИМЕНИ RUNTIME-ПОЛЬЗОВАТЕЛЯ)
# ==============================================================================
if [ -n "$PREV_RELEASE_DIR" ] && run_as_runtime_user /bin/test -f "${STATE_DIR}/data/media.db"; then
  echo "💾 Шаг 1/6: Создание предрелизной резервной копии БД и загрузок..."
  run_as_runtime_user APP_COMMIT_SHA="$PREV_SHA" /usr/bin/node "${PREV_RELEASE_DIR}/server/backup.js" --with-uploads --reason=pre-deploy
  BACKUP_RC=$?
  if [ "$BACKUP_RC" -ne 0 ]; then
    echo "❌ [DEPLOY] Предрелизное резервное копирование завершилось с ошибкой (код ${BACKUP_RC})!"
    echo "🛑 Деплой в '${DEPLOY_ENV}' заблокирован. Текущий релиз (${PREV_SHA}) продолжает работу без изменений."
    exit 20
  fi
else
  echo "ℹ️ Шаг 1/6: База данных ещё не создана, предрелизный бэкап пропущен."
fi

# ==============================================================================
# ШАГ 2. ПОДГОТОВКА ИЗОЛИРОВАННОГО РЕЛИЗА releases/<TARGET_SHA> (ИДЕМПОТЕНТНО, P1 #6)
# ==============================================================================
NEW_RELEASE_DIR="${RELEASES_DIR}/${TARGET_SHA}"
STAGE_BUILD_DIR="${RELEASES_DIR}/.${TARGET_SHA}.tmp.$$"

cleanup_tmp() {
  if [ -d "$STAGE_BUILD_DIR" ]; then
    rm -rf "$STAGE_BUILD_DIR"
  fi
  if [ -n "$DIST_ARCHIVE" ] && [ -f "$DIST_ARCHIVE" ]; then
    rm -f "$DIST_ARCHIVE"
  fi
}
trap cleanup_tmp EXIT

prepare_isolated_release() {
  # Защита от удаления активного релиза при повторном деплое того же самого SHA (P1 #6)
  if [ -n "$PREV_RELEASE_DIR" ] && [ "$NEW_RELEASE_DIR" = "$PREV_RELEASE_DIR" ] && [ -d "$NEW_RELEASE_DIR" ]; then
    echo "ℹ️ Повторный деплой уже активного релиза ${TARGET_SHA}: сохраняем рабочий каталог без удаления."
    if [ -n "$DIST_ARCHIVE" ] && [ -f "$DIST_ARCHIVE" ]; then
      mkdir -p "${STAGE_BUILD_DIR}/dist" || return 1
      tar -xzf "$DIST_ARCHIVE" -C "${STAGE_BUILD_DIR}/dist" || return 1
      if [ ! -f "${STAGE_BUILD_DIR}/dist/index.html" ]; then
        echo "❌ [DEPLOY] В архиве dist отсутствует dist/index.html!"
        return 1
      fi
      rsync -a --delete "${STAGE_BUILD_DIR}/dist/" "${NEW_RELEASE_DIR}/dist/" || return 1
      rm -rf "$STAGE_BUILD_DIR"
    fi
    ln -sfn "${STATE_DIR}/data" "${NEW_RELEASE_DIR}/data" || return 1
    ln -sfn "${STATE_DIR}/uploads" "${NEW_RELEASE_DIR}/uploads" || return 1
    cat > "${NEW_RELEASE_DIR}/.release-meta.json" <<EOF
{
  "sha": "${TARGET_SHA}",
  "env": "${DEPLOY_ENV}",
  "deployedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
    printf '%s\n' "${TARGET_SHA}" > "${NEW_RELEASE_DIR}/.release-sha"
    chmod -R u=rwX,g=rX,o= "$NEW_RELEASE_DIR" || return 1
    return 0
  fi

  echo "📥 Шаг 2/6: Получение точного коммита ${TARGET_SHA}..."
  if [ ! -d "${REPO_CACHE_DIR}/.git" ]; then
    git clone --no-checkout "$REPO_URL" "$REPO_CACHE_DIR" || return 1
  fi

  git -C "$REPO_CACHE_DIR" remote set-url origin "$REPO_URL" || return 1
  git -C "$REPO_CACHE_DIR" fetch --prune origin "+refs/heads/*:refs/remotes/origin/*" || return 1
  git -C "$REPO_CACHE_DIR" fetch origin "$TARGET_SHA" || true

  if ! git -C "$REPO_CACHE_DIR" cat-file -e "${TARGET_SHA}^{commit}" 2>/dev/null; then
    echo "❌ [DEPLOY] Коммит ${TARGET_SHA} не найден в репозитории!"
    return 1
  fi

  rm -rf "$STAGE_BUILD_DIR" || return 1
  mkdir -p "$STAGE_BUILD_DIR" || return 1
  git -C "$REPO_CACHE_DIR" archive "$TARGET_SHA" | tar -x -C "$STAGE_BUILD_DIR" || return 1

  echo "📦 Шаг 3/6: Установка зависимостей по package-lock.json и подготовка бандла..."
  if [ -n "$DIST_ARCHIVE" ] && [ -f "$DIST_ARCHIVE" ]; then
    echo "   Используется проверенный в CI артефакт фронтенда: ${DIST_ARCHIVE}"
    mkdir -p "${STAGE_BUILD_DIR}/dist" || return 1
    tar -xzf "$DIST_ARCHIVE" -C "${STAGE_BUILD_DIR}/dist" || return 1
    (cd "$STAGE_BUILD_DIR" && npm ci --omit=dev --no-audit --no-fund) || return 1
  else
    echo "   Локальная сборка фронтенда и продакшн-зависимостей..."
    (cd "$STAGE_BUILD_DIR" && npm ci --no-audit --no-fund) || return 1
    (cd "$STAGE_BUILD_DIR" && npm run build) || return 1
    (cd "$STAGE_BUILD_DIR" && npm prune --omit=dev --no-audit --no-fund) || return 1
  fi

  if [ ! -f "${STAGE_BUILD_DIR}/dist/index.html" ]; then
    echo "❌ [DEPLOY] В собранном релизе отсутствует dist/index.html!"
    return 1
  fi

  # Единая схема симлинков на персистентные каталоги данных и загрузок (P1 #5)
  rm -rf "${STAGE_BUILD_DIR}/data" "${STAGE_BUILD_DIR}/uploads" || return 1
  ln -sfn "${STATE_DIR}/data" "${STAGE_BUILD_DIR}/data" || return 1
  ln -sfn "${STATE_DIR}/uploads" "${STAGE_BUILD_DIR}/uploads" || return 1

  cat > "${STAGE_BUILD_DIR}/.release-meta.json" <<EOF
{
  "sha": "${TARGET_SHA}",
  "env": "${DEPLOY_ENV}",
  "deployedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
  printf '%s\n' "${TARGET_SHA}" > "${STAGE_BUILD_DIR}/.release-sha"
  chmod -R u=rwX,g=rX,o= "$STAGE_BUILD_DIR" || return 1

  rm -rf "$NEW_RELEASE_DIR" || return 1
  mv "$STAGE_BUILD_DIR" "$NEW_RELEASE_DIR" || return 1
  return 0
}

prepare_isolated_release
PREP_RC=$?
if [ "$PREP_RC" -ne 0 ]; then
  echo "❌ [DEPLOY] Ошибка подготовки изолированного релиза ${TARGET_SHA}. Текущая версия продолжает работать."
  exit 21
fi

# ==============================================================================
# ШАГ 4. ПРОВЕРКА И ПРИМЕНЕНИЕ МИГРАЦИЙ БД ДО ПЕРЕКЛЮЧЕНИЯ ТРАФИКА
# ==============================================================================
echo "🗄️ Шаг 4/6: Проверка совместимости и миграция схемы SQLite..."
run_as_runtime_user APP_COMMIT_SHA="$TARGET_SHA" /usr/bin/node "${NEW_RELEASE_DIR}/server/migrate.js" --verify
MIGRATE_RC=$?
if [ "$MIGRATE_RC" -ne 0 ]; then
  echo "❌ [DEPLOY] Ошибка миграции или несовместимость схемы БД! Переключение релиза отменено."
  if [ "$NEW_RELEASE_DIR" != "$PREV_RELEASE_DIR" ]; then
    rm -rf "$NEW_RELEASE_DIR"
  fi
  exit 21
fi

# ==============================================================================
# ШАГ 5. ПЕРЕКЛЮЧЕНИЕ АКТИВНОГО РЕЛИЗА И ПЕРЕЗАПУСК SYSTEMD
# ==============================================================================
echo "🔄 Шаг 5/6: Атомарное переключение current -> ${NEW_RELEASE_DIR} и перезапуск ${SERVICE_NAME}..."
if [ -n "$PREV_RELEASE_DIR" ] && [ "$PREV_RELEASE_DIR" != "$NEW_RELEASE_DIR" ]; then
  ln -sfn "$PREV_RELEASE_DIR" "$PREVIOUS_LINK" || {
    echo "❌ [DEPLOY] Не удалось обновить ссылку previous"
    exit 21
  }
fi

ln -sfn "$NEW_RELEASE_DIR" "$CURRENT_LINK" || {
  echo "❌ [DEPLOY] Не удалось обновить ссылку current"
  exit 21
}

restart_contour_service
RESTART_RC=$?

# ==============================================================================
# ФУНКЦИЯ 7-СТУПЕНЧАТОЙ ПРОВЕРКИ РАБОТОСПОСОБНОСТИ РЕЛИЗА
# ==============================================================================
verify_release() {
  local expected_sha="$1"
  local retries="${VERIFY_RETRIES:-15}"
  local wait_sec="${VERIFY_WAIT_SEC:-2}"

  echo "🩺 Проверка работоспособности релиза (ожидается SHA: ${expected_sha})..."

  for i in $(seq 1 "$retries"); do
    # 1. Запущен ли systemd-сервис
    if is_contour_service_active; then
      # 2-6. Проверка /api/health/ready (HTTP 200, db=ok, schemaCompatible=true, frontendReady=true, commit=expected_sha)
      local health_json=""
      if health_json="$(curl -fsS --max-time 4 "$HEALTH_URL" 2>/dev/null)"; then
        local check_result=""
        check_result="$(HEALTH_JSON="$health_json" EXPECTED_SHA="$expected_sha" node -e '
          try {
            const d = JSON.parse(process.env.HEALTH_JSON);
            if (!d.ok) process.exit(1);
            if (d.db !== "ok") process.exit(2);
            if (!d.schemaCompatible) process.exit(3);
            if (!d.frontendReady) process.exit(4);
            if (d.commit !== process.env.EXPECTED_SHA) process.exit(5);
            process.stdout.write("OK");
          } catch {
            process.exit(6);
          }
        ' 2>/dev/null || true)"

        if [ "$check_result" = "OK" ]; then
          # 5b. Проверка отдачи фронтенда (/)
          if curl -fsS --max-time 4 "${BASE_URL}/" >/dev/null 2>&1; then
            # 7. Функциональная smoke-проверка публичного API
            if curl -fsS --max-time 4 "${BASE_URL}/api/public/recruitment/track/photo" | grep -q '"slug":"photo"'; then
              echo "✅ Все 7 проверок работоспособности пройдены (попытка ${i}/${retries}):"
              echo "   ${health_json}"
              return 0
            fi
          fi
        fi
      fi
    fi

    echo "⏳ Попытка ${i}/${retries}: ждём готовности сервиса (${wait_sec} сек)..."
    sleep "$wait_sec"
  done

  echo "❌ Не пройдена комплексная проверка работоспособности для SHA ${expected_sha}!"
  return 1
}

if [ "$RESTART_RC" -eq 0 ]; then
  verify_release "$TARGET_SHA"
  VERIFY_RC=$?
else
  echo "❌ [DEPLOY] Команда systemctl restart ${SERVICE_NAME} завершилась с ошибкой (${RESTART_RC})!"
  VERIFY_RC=1
fi

# ==============================================================================
# ШАГ 6. УСПЕШНОЕ ЗАВЕРШЕНИЕ И ОЧИСТКА УСТАРЕВШИХ РЕЛИЗОВ
# ==============================================================================
if [ "$VERIFY_RC" -eq 0 ]; then
  echo "🧹 Шаг 6/6: Очистка устаревших релизов (храним последние ${KEEP_RELEASES})..."
  CURRENT_REAL="$(readlink -f "$CURRENT_LINK" || true)"
  PREVIOUS_REAL="$(readlink -f "$PREVIOUS_LINK" || true)"

  mapfile -t ALL_RELEASES < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' 2>/dev/null | sort -rn | awk '{print $2}')
  COUNT=0
  for rel_path in "${ALL_RELEASES[@]}"; do
    [ -z "$rel_path" ] && continue
    COUNT=$((COUNT + 1))
    if [ "$COUNT" -le "$KEEP_RELEASES" ]; then
      continue
    fi
    if [ "$rel_path" = "$CURRENT_REAL" ] || [ "$rel_path" = "$PREVIOUS_REAL" ]; then
      continue
    fi
    echo "   Удаление старого релиза: $(basename "$rel_path")"
    rm -rf "$rel_path"
  done

  echo "🎉 Деплой релиза ${TARGET_SHA} в окружение '${DEPLOY_ENV}' успешно завершён!"
  exit 0
fi

# ==============================================================================
# АВАРИЙНЫЙ ROLLBACK (БЕЗ ПЕРЕЗАПИСИ ПОЛЬЗОВАТЕЛЬСКИХ ДАННЫХ В БД)
# ==============================================================================
echo "🚨 СБОЙ ДЕПЛОЯ: Новая версия (${TARGET_SHA}) не прошла проверки работоспособности!"

if [ -z "$PREV_RELEASE_DIR" ] || [ ! -d "$PREV_RELEASE_DIR" ] || [ "$PREV_RELEASE_DIR" = "$NEW_RELEASE_DIR" ]; then
  echo "❌ Предыдущий отличный релиз отсутствует — автоматический откат невозможен!"
  exit 31
fi

echo "⏪ Запуск автоматического отката на предыдущий рабочий релиз ${PREV_SHA} (${PREV_RELEASE_DIR})..."
echo "ℹ️ База данных SQLite и пользовательские файлы сохраняются (без разрушительного перезаписывания)."

# Проверяем, совместима ли текущая схема БД с предыдущим релизом
run_as_runtime_user APP_COMMIT_SHA="$PREV_SHA" /usr/bin/node "${PREV_RELEASE_DIR}/server/migrate.js" --verify-rollback
COMPAT_RC=$?
if [ "$COMPAT_RC" -ne 0 ]; then
  echo "❌ КРИТИЧЕСКАЯ ОШИБКА: Схема БД несовместима с предыдущим релизом ${PREV_SHA}!"
  echo "   Требуется ручное восстановление по инструкции deploy/DISASTER_RECOVERY.md."
  exit 31
fi

ln -sfn "$PREV_RELEASE_DIR" "$CURRENT_LINK"
restart_contour_service
RB_RESTART_RC=$?

if [ "$RB_RESTART_RC" -eq 0 ]; then
  verify_release "$PREV_SHA"
  RB_VERIFY_RC=$?
else
  RB_VERIFY_RC=1
fi

if [ "$RB_VERIFY_RC" -eq 0 ]; then
  echo "✅ АВТОМАТИЧЕСКИЙ ROLLBACK ВЫПОЛНЕН: Работа сервиса восстановлена на релизе ${PREV_SHA}."
  exit 30
else
  echo "🔥 КРИТИЧЕСКИЙ ИНЦИДЕНТ: Автоматический Rollback на ${PREV_SHA} НЕ УДАЛСЯ!"
  exit 31
fi
