#!/usr/bin/env bash
# ==============================================================================
# МедиаКод — Release-Based CD Script для Ubuntu Server 22.04/24.04 LTS
#
# Коды возврата (для точной диагностики в GitHub Actions и уведомлениях):
#   0  — Успешное обновление и прохождение всех 7 проверок работоспособности
#   10 — Ошибка входных параметров или блокировки параллельного деплоя
#   20 — Ошибка обязательного backup (старый сервис не остановлен или восстановлен)
#   21 — Ошибка подготовки/переключения/миграции (старый сервис сохранён/восстановлен)
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
# Unit names must match the narrowly scoped sudoers entries exactly.
SERVICE_NAME="${SERVICE_NAME%.service}.service"
if [ "$DEPLOY_ENV" = production ]; then EXPECTED_SERVICE=mediacode-prod.service;
else EXPECTED_SERVICE=mediacode-stage.service; fi
[ "$SERVICE_NAME" = "$EXPECTED_SERVICE" ] || { echo 'Service/contour mismatch' >&2; exit 10; }
for root in "$ENV_ROOT" "$STATE_DIR"; do
  [[ "$root" = /* && "$root" != / && "$root" != *..* && "$root" != *' '* ]] || exit 10
done
LOCK_FILE="${ENV_ROOT}/.deploy.lock"
[[ "$ENV_ROOT" = "/opt/mediacode/$DEPLOY_ENV" && "$STATE_DIR" = "/var/lib/mediacode/$DEPLOY_ENV" ]] || { echo 'Noncanonical deployment roots rejected' >&2; exit 10; }
[[ "$KEEP_RELEASES" =~ ^[1-9][0-9]*$ ]] || exit 10
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "❌ [DEPLOY] Другой процесс деплоя для '${DEPLOY_ENV}' уже выполняется (${LOCK_FILE})."
  exit 10
fi

# Runtime operations execute only admin-owned code, never the release's scripts.
# No interpreter, arbitrary command, custom data root or runtime sudo is granted.
runtime_op() { sudo -n /usr/local/sbin/mediacode-ops "$DEPLOY_ENV" "$@"; }
restart_contour_service() { runtime_op restart; }
stop_contour_service() { runtime_op stop; }
is_contour_service_active() { runtime_op is-active; }

echo "=================================================================="
echo "🚀 Старт Release-Based деплоя МедиаКод"
echo "   Окружение:    ${DEPLOY_ENV} (runtime user: ${RUNTIME_USER})"
echo "   Целевой SHA:  ${TARGET_SHA}"
echo "   Сервис:       ${SERVICE_NAME} (порт ${APP_PORT})"
echo "   Каталог:      ${ENV_ROOT}"
echo "   Данные:       ${STATE_DIR}"
echo "=================================================================="

if ! runtime_op exists-env; then
  echo 'Environment/broker unavailable: administrator provisioning required; no changes made.'
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
  [[ "$PREV_SHA" =~ ^[0-9a-f]{40}$ && "$PREV_RELEASE_DIR" = "$RELEASES_DIR/$PREV_SHA" && ! -L "$PREV_RELEASE_DIR" ]] || { echo 'Unsafe current target; manual intervention required' >&2; exit 10; }
  echo "📌 Текущий активный релиз: ${PREV_SHA} (${PREV_RELEASE_DIR})"
else
  [[ ! -e "$CURRENT_LINK" && ! -L "$CURRENT_LINK" ]] || { echo 'Broken current: preserved for administrator recovery' >&2; exit 21; }
  echo "ℹ️ Активный релиз ещё не установлен (первичное развёртывание)."
fi

# ==============================================================================
# ШАГ 1. ОБЯЗАТЕЛЬНЫЙ PRE-DEPLOY BACKUP (ОТ ИМЕНИ RUNTIME-ПОЛЬЗОВАТЕЛЯ)
# ==============================================================================
NEW_RELEASE_DIR="${RELEASES_DIR}/${TARGET_SHA}"
# Repeating the active SHA never touches its files, metadata, links or dependencies.
if [ -n "$PREV_RELEASE_DIR" ] && [ "$NEW_RELEASE_DIR" = "$PREV_RELEASE_DIR" ]; then
  if node "$SCRIPT_DIR/release-integrity.mjs" --verify "$NEW_RELEASE_DIR" && runtime_op policy "$TARGET_SHA" && is_contour_service_active && curl -fsS --max-time 5 "$HEALTH_URL" | EXPECTED_SHA="$TARGET_SHA" node -e '
    let body=""; process.stdin.on("data", c => body += c);
    process.stdin.on("end", () => { try { const d=JSON.parse(body);
      process.exit(d.ok && d.db === "ok" && d.schemaCompatible && d.frontendReady && d.commit === process.env.EXPECTED_SHA ? 0 : 1);
    } catch { process.exit(1); } });'; then
    echo 'Active SHA already healthy; immutable release unchanged.'
    exit 0
  fi
  echo 'Active SHA unhealthy; investigate or roll back. Release left unchanged.' >&2
  exit 21
fi

if [ -n "$PREV_RELEASE_DIR" ]; then
  echo "💾 Шаг 1/6: Создание предрелизной резервной копии БД и загрузок..."
  runtime_op backup-predeploy "$PREV_SHA"
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
STAGE_CREATED=0

cleanup_tmp() {
  rm -f "${CURRENT_LINK}.next.$$" "${CURRENT_LINK}.recovery.$$" "${PREVIOUS_LINK}.next.$$"
  if [ "$STAGE_CREATED" = 1 ] && [ -d "$STAGE_BUILD_DIR" ] && [ ! -L "$STAGE_BUILD_DIR" ] && [[ "$(readlink -f "$STAGE_BUILD_DIR")" = "$RELEASES_DIR/.${TARGET_SHA}.tmp.$$" ]]; then
    rm -rf "$STAGE_BUILD_DIR"
  fi
  # The caller owns the uploaded archive. Never delete an arbitrary caller path.
}
trap cleanup_tmp EXIT

prepare_isolated_release() {
  # A previously prepared release is immutable too. Never repair it in place.
  if [ -e "$NEW_RELEASE_DIR" ] || [ -L "$NEW_RELEASE_DIR" ]; then
    [ ! -L "$NEW_RELEASE_DIR" ] && [ -d "$NEW_RELEASE_DIR" ] &&
      [ -f "$NEW_RELEASE_DIR/.release-sha" ] &&
      [ "$(cat "$NEW_RELEASE_DIR/.release-sha")" = "$TARGET_SHA" ] &&
      [ -f "$NEW_RELEASE_DIR/dist/index.html" ] && [ -d "$NEW_RELEASE_DIR/node_modules" ] || return 1
    node "$SCRIPT_DIR/release-integrity.mjs" --verify "$NEW_RELEASE_DIR" && runtime_op policy "$TARGET_SHA"
    return $?
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

  # Do not delete a pre-existing recovery candidate, even after a previous failure.
  mkdir "$STAGE_BUILD_DIR" || return 1
  STAGE_CREATED=1
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
  node "$SCRIPT_DIR/release-integrity.mjs" --record "$STAGE_BUILD_DIR" || return 1
  chgrp -R "$RUNTIME_USER" "$STAGE_BUILD_DIR" || return 1
  chmod -R u=rwX,g=rX,o= "$STAGE_BUILD_DIR" || return 1

  mv "$STAGE_BUILD_DIR" "$NEW_RELEASE_DIR" || return 1
  runtime_op policy "$TARGET_SHA"
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
            # A fresh production DB has no demo tracks; a correct JSON 404 is healthy too.
            if curl -sS --max-time 4 -w '\n%{http_code}' "${BASE_URL}/api/public/recruitment/track/photo" | node -e '
              let s=""; process.stdin.on("data", c=>s+=c); process.stdin.on("end",()=>{
                try { const i=s.lastIndexOf("\n"), status=s.slice(i+1), d=JSON.parse(s.slice(0,i));
                  process.exit((status==="200" && d.slug==="photo") || (status==="404" && typeof d.error==="string") ? 0 : 1);
                } catch { process.exit(1); }
              });'; then
              if [ -n "${EXTERNAL_HEALTH_URL:-}" ]; then
                curl -fsS --max-time 8 "$EXTERNAL_HEALTH_URL" | EXPECTED_SHA="$expected_sha" node -e '
                  let s=""; process.stdin.on("data", c=>s+=c); process.stdin.on("end",()=>{
                    try { const d=JSON.parse(s); process.exit(d.ok && d.commit===process.env.EXPECTED_SHA ? 0 : 1); }
                    catch { process.exit(1); }
                  });' || continue
              fi
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


SERVICE_MAY_BE_STOPPED=0
recover_previous() {
  local intended_code="$1" reason="$2"
  echo "RECOVERY: $reason; checking previous SHA $PREV_SHA (database is not restored)." >&2
  if [ -z "$PREV_RELEASE_DIR" ] || [ ! -d "$PREV_RELEASE_DIR" ] || ! node "$SCRIPT_DIR/release-integrity.mjs" --verify "$PREV_RELEASE_DIR"; then
    echo 'EMERGENCY 31: no previous release; manual intervention required.' >&2
    return 31
  fi
  if ! runtime_op verify-rollback "$PREV_SHA"; then
    stop_contour_service || true
    echo 'EMERGENCY 31: previous schema/database cannot be verified; no data overwritten.' >&2
    return 31
  fi
  if [ "$(readlink -f "$CURRENT_LINK" || true)" = "$PREV_RELEASE_DIR" ] && is_contour_service_active && verify_release "$PREV_SHA"; then
    echo 'Previous service remained healthy.' >&2
    return "$intended_code"
  fi
  if ! stop_contour_service; then
    echo 'EMERGENCY 31: unable to stop service during recovery.' >&2
    return 31
  fi
  if [ "$(readlink -f "$CURRENT_LINK" || true)" != "$PREV_RELEASE_DIR" ]; then
    if ! ln -s "$PREV_RELEASE_DIR" "${CURRENT_LINK}.recovery.$$" || ! mv -Tf "${CURRENT_LINK}.recovery.$$" "$CURRENT_LINK"; then
      echo 'EMERGENCY 31: unable to restore current link; no database changes attempted.' >&2
      return 31
    fi
  fi
  if ! restart_contour_service || ! verify_release "$PREV_SHA"; then
    echo 'EMERGENCY 31: previous service failed restart/readiness; operator recovery required.' >&2
    return 31
  fi
  echo "RECOVERED: previous SHA $PREV_SHA healthy; exit $intended_code." >&2
  return "$intended_code"
}
fail_after_stop() {
  local intended_code="$1" reason="$2" recovered
  trap - EXIT INT TERM
  recover_previous "$intended_code" "$reason"
  recovered=$?
  cleanup_tmp
  exit "$recovered"
}
exit_guard() {
  local rc="$1"
  if [ "$SERVICE_MAY_BE_STOPPED" = 1 ]; then fail_after_stop 21 "unexpected exit $rc during cutover"; fi
  cleanup_tmp
}
trap 'exit_guard $?' EXIT
trap 'fail_after_stop 21 "cutover interrupted by signal"' INT TERM

echo "🗄️ Шаг 4/6: Проверка совместимости и миграция схемы SQLite..."
# Never let the old application write while the new code changes the schema.
SERVICE_MAY_BE_STOPPED=1
stop_contour_service || fail_after_stop 21 "systemctl stop failed"
if [ -n "$PREV_RELEASE_DIR" ]; then
  if ! runtime_op backup-final "$PREV_SHA"; then
    fail_after_stop 20 "final backup failed"
  fi
fi
runtime_op migrate "$TARGET_SHA"
MIGRATE_RC=$?
if [ "$MIGRATE_RC" -ne 0 ]; then
  fail_after_stop 21 "SQLite migration failed"
fi

# ==============================================================================
# ШАГ 5. ПЕРЕКЛЮЧЕНИЕ АКТИВНОГО РЕЛИЗА И ПЕРЕЗАПУСК SYSTEMD
# ==============================================================================
echo "🔄 Шаг 5/6: Атомарное переключение current -> ${NEW_RELEASE_DIR} и перезапуск ${SERVICE_NAME}..."
if [ -n "$PREV_RELEASE_DIR" ] && [ "$PREV_RELEASE_DIR" != "$NEW_RELEASE_DIR" ]; then
  ln -s "$PREV_RELEASE_DIR" "${PREVIOUS_LINK}.next.$$" && mv -Tf "${PREVIOUS_LINK}.next.$$" "$PREVIOUS_LINK" || fail_after_stop 21 "previous link preparation failed"
fi

ln -s "$NEW_RELEASE_DIR" "${CURRENT_LINK}.next.$$" && mv -Tf "${CURRENT_LINK}.next.$$" "$CURRENT_LINK" || fail_after_stop 21 "current link switch failed"

restart_contour_service
RESTART_RC=$?

# ==============================================================================
# ФУНКЦИЯ 7-СТУПЕНЧАТОЙ ПРОВЕРКИ РАБОТОСПОСОБНОСТИ РЕЛИЗА
# ==============================================================================

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
  SERVICE_MAY_BE_STOPPED=0
  echo "🧹 Шаг 6/6: Очистка устаревших релизов (храним последние ${KEEP_RELEASES})..."
  CURRENT_REAL="$(readlink -f "$CURRENT_LINK" || true)"
  PREVIOUS_REAL="$(readlink -f "$PREVIOUS_LINK" || true)"

  mapfile -t ALL_RELEASES < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' 2>/dev/null | sort -rn | awk '{print $2}')
  COUNT=0
  for rel_path in "${ALL_RELEASES[@]}"; do
    [ -z "$rel_path" ] && continue
    [[ "$(basename "$rel_path")" =~ ^[0-9a-f]{40}$ && ! -L "$rel_path" && "$(readlink -f "$rel_path")" = "$rel_path" ]] || continue
    COUNT=$((COUNT + 1))
    if [ "$COUNT" -le "$KEEP_RELEASES" ]; then
      continue
    fi
    if [ "$rel_path" = "$CURRENT_REAL" ] || [ "$rel_path" = "$PREVIOUS_REAL" ] || [ "$rel_path" = "$PREV_RELEASE_DIR" ]; then
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
fail_after_stop 30 "new release restart/readiness failed"
