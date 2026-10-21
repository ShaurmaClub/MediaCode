#!/usr/bin/env bash
# ==============================================================================
# MediaCode — Помощник первичной настройки GitHub Actions & Environments
# Автоматизирует:
#   1. Генерацию отдельных SSH-ключей (Ed25519) для окружений production и staging
#   2. Добавление публичных ключей в /home/deploy/.ssh/authorized_keys
#   3. Фиксацию SSH host keys (SSH_KNOWN_HOSTS) для строгой проверки подлинности сервера
#   4. Проверку тестового SSH-подключения с StrictHostKeyChecking=yes
#   5. Загрузку секретов в GitHub Environments (production и staging) через GitHub CLI (gh)
#   6. Гарантированное удаление временных приватных ключей с диска
# ==============================================================================

set -u
set -o pipefail

REPO="${GITHUB_REPO:-ShaurmaClub/MediaCode}"
SSH_HOST="${SSH_HOST:-}"
SSH_PORT="${SSH_PORT:-22}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
PROD_URL="${PROD_URL:-https://kaiton.ru/api/health/ready}"
STAGE_URL="${STAGE_URL:-https://stage.kaiton.ru/api/health/ready}"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO="$2"
      shift 2
      ;;
    --host)
      SSH_HOST="$2"
      shift 2
      ;;
    --port)
      SSH_PORT="$2"
      shift 2
      ;;
    --user)
      DEPLOY_USER="$2"
      shift 2
      ;;
    --prod-url)
      PROD_URL="$2"
      shift 2
      ;;
    --stage-url)
      STAGE_URL="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --help|-h)
      cat <<'EOF'
Использование:
  bash deploy/setup-github.sh --host <IP_ИЛИ_ДОМЕН_СЕРВЕРА> [опции]

Опции:
  --host <host>       Публичный IP или домен Ubuntu-сервера (обязательно)
  --port <port>       SSH-порт сервера (по умолчанию: 22)
  --user <user>       Пользователь деплоя на сервере (по умолчанию: deploy)
  --repo <owner/repo> Репозиторий GitHub (по умолчанию: ShaurmaClub/MediaCode)
  --prod-url <url>    Внешний URL готовности production (по умолчанию: https://kaiton.ru/api/health/ready)
  --stage-url <url>   Внешний URL готовности staging (по умолчанию: https://stage.kaiton.ru/api/health/ready)
  --dry-run           Проверить генерацию ключей и known_hosts без отправки в GitHub
EOF
      exit 0
      ;;
    *)
      echo "[ERROR] Неизвестный аргумент: $1" >&2
      exit 1
      ;;
  esac
done

log()  { printf '\033[1;34m[GH-SETUP]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[   OK   ]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[  WARN  ]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[ ERROR  ]\033[0m %s\n' "$*" >&2; }

if [[ -z "${SSH_HOST}" ]]; then
  if [[ -t 0 ]]; then
    read -r -p "Введите публичный IP или домен сервера (SSH_HOST): " SSH_HOST
  fi
fi

if [[ -z "${SSH_HOST}" ]]; then
  err "Не указан адрес сервера (--host <IP_ИЛИ_ДОМЕН>)."
  exit 1
fi

TMP_KEY_DIR="$(mktemp -d -t mediacode-gh-keys.XXXXXXXXXX)"
chmod 700 "${TMP_KEY_DIR}"
cleanup() {
  if [[ -d "${TMP_KEY_DIR}" ]]; then
    rm -rf "${TMP_KEY_DIR}"
  fi
}
trap cleanup EXIT INT TERM

# 1. Генерация отдельных ключей для production и staging
log "Генерация изолированных SSH-ключей Ed25519 для окружений production и staging..."
ssh-keygen -t ed25519 -N "" -C "github-actions-production@${REPO}" -f "${TMP_KEY_DIR}/id_ed25519_prod" >/dev/null || {
  err "Не удалось сгенерировать ключ для production"
  exit 1
}
ssh-keygen -t ed25519 -N "" -C "github-actions-staging@${REPO}" -f "${TMP_KEY_DIR}/id_ed25519_stage" >/dev/null || {
  err "Не удалось сгенерировать ключ для staging"
  exit 1
}
ok "Сгенерированы 2 отдельных SSH-ключа (приватные ключи в консоль не выводятся)"

# 2. Получение и фиксация SSH_KNOWN_HOSTS
log "Сканирование SSH host keys сервера ${SSH_HOST}:${SSH_PORT}..."
KNOWN_HOSTS_FILE="${TMP_KEY_DIR}/known_hosts"
ssh-keyscan -p "${SSH_PORT}" -T 10 "${SSH_HOST}" > "${KNOWN_HOSTS_FILE}" 2>/dev/null || true

if [[ ! -s "${KNOWN_HOSTS_FILE}" ]]; then
  warn "Не удалось автоматически получить host key от ${SSH_HOST}:${SSH_PORT}."
  if [[ "${DRY_RUN}" -eq 0 ]]; then
    err "Проверьте доступность SSH на ${SSH_HOST}:${SSH_PORT} и повторите попытку."
    exit 1
  fi
else
  ok "Получены отпечатки SSH host keys сервера:"
  ssh-keygen -lf "${KNOWN_HOSTS_FILE}"
fi

# 3. Установка публичных ключей в authorized_keys пользователя deploy
install_pubkeys_locally() {
  local auth_file="/home/${DEPLOY_USER}/.ssh/authorized_keys"
  if [[ -d "/home/${DEPLOY_USER}" ]] && [[ "${EUID}" -eq 0 || "$(id -un)" == "${DEPLOY_USER}" ]]; then
    mkdir -p "/home/${DEPLOY_USER}/.ssh"
    touch "${auth_file}"
    for pub_file in "${TMP_KEY_DIR}/id_ed25519_prod.pub" "${TMP_KEY_DIR}/id_ed25519_stage.pub"; do
      local pub_content
      pub_content="$(cat "${pub_file}")"
      if ! grep -qxF "${pub_content}" "${auth_file}" 2>/dev/null; then
        printf '%s\n' "${pub_content}" >> "${auth_file}"
      fi
    done
    chmod 700 "/home/${DEPLOY_USER}/.ssh"
    chmod 600 "${auth_file}"
    if [[ "${EUID}" -eq 0 ]]; then
      chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"
    fi
    return 0
  fi
  return 1
}

if [[ "${DRY_RUN}" -eq 0 ]]; then
  if install_pubkeys_locally; then
    ok "Публичные ключи добавлены локально в /home/${DEPLOY_USER}/.ssh/authorized_keys"
  else
    log "Копирование публичных ключей на ${DEPLOY_USER}@${SSH_HOST}:${SSH_PORT}..."
    PUB_PROD="$(cat "${TMP_KEY_DIR}/id_ed25519_prod.pub")"
    PUB_STAGE="$(cat "${TMP_KEY_DIR}/id_ed25519_stage.pub")"
    ssh -p "${SSH_PORT}" -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="${KNOWN_HOSTS_FILE}" \
      "${DEPLOY_USER}@${SSH_HOST}" \
      "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && grep -qxF '${PUB_PROD}' ~/.ssh/authorized_keys || echo '${PUB_PROD}' >> ~/.ssh/authorized_keys && grep -qxF '${PUB_STAGE}' ~/.ssh/authorized_keys || echo '${PUB_STAGE}' >> ~/.ssh/authorized_keys" || {
        warn "Автоматическая установка ключей по SSH не удалась. Добавьте эти 2 публичных ключа в /home/${DEPLOY_USER}/.ssh/authorized_keys вручную:"
        echo "--- PRODUCTION PUBLIC KEY ---"
        cat "${TMP_KEY_DIR}/id_ed25519_prod.pub"
        echo "--- STAGING PUBLIC KEY ---"
        cat "${TMP_KEY_DIR}/id_ed25519_stage.pub"
      }
  fi

  # 4. Проверка безопасного подключения
  log "Проверка тестового SSH-подключения с верификацией host key..."
  if ssh -i "${TMP_KEY_DIR}/id_ed25519_prod" \
    -p "${SSH_PORT}" \
    -o BatchMode=yes \
    -o ConnectTimeout=10 \
    -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile="${KNOWN_HOSTS_FILE}" \
    "${DEPLOY_USER}@${SSH_HOST}" "echo ok" >/dev/null 2>&1; then
    ok "Тестовое SSH-соединение под пользователем ${DEPLOY_USER} успешно проверено"
  else
    warn "Не удалось выполнить тестовое подключение по новому ключу (возможно, скрипт запущен внутри самого сервера без loopback-маршрута на публичный IP)."
  fi
fi

# 5. Загрузка секретов в GitHub Environments через gh CLI
if [[ "${DRY_RUN}" -eq 1 ]]; then
  ok "Режим --dry-run завершён успешно. Временные ключи будут автоматически удалены."
  exit 0
fi

if ! command -v gh >/dev/null 2>&1; then
  warn "Утилита GitHub CLI (gh) не установлена. Установите её: sudo apt install gh && gh auth login"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  log "Требуется разовая авторизация в GitHub CLI..."
  gh auth login || {
    err "Не удалось авторизоваться в GitHub CLI"
    exit 1
  }
fi

configure_gh_environment() {
  local env_name="$1"
  local key_file="$2"
  local deploy_path="$3"
  local service_name="$4"
  local health_url="$5"

  log "Настройка GitHub Environment '${env_name}' в репозитории ${REPO}..."
  gh api --method PUT -H "Accept: application/vnd.github+json" \
    "/repos/${REPO}/environments/${env_name}" >/dev/null 2>&1 || true

  gh secret set SSH_HOST --env "${env_name}" --repo "${REPO}" --body "${SSH_HOST}"
  gh secret set SSH_PORT --env "${env_name}" --repo "${REPO}" --body "${SSH_PORT}"
  gh secret set SSH_USER --env "${env_name}" --repo "${REPO}" --body "${DEPLOY_USER}"
  gh secret set SSH_PRIVATE_KEY --env "${env_name}" --repo "${REPO}" < "${key_file}"
  gh secret set SSH_KNOWN_HOSTS --env "${env_name}" --repo "${REPO}" < "${KNOWN_HOSTS_FILE}"
  gh secret set DEPLOY_PATH --env "${env_name}" --repo "${REPO}" --body "${deploy_path}"
  gh secret set SERVICE_NAME --env "${env_name}" --repo "${REPO}" --body "${service_name}"
  gh secret set HEALTHCHECK_URL --env "${env_name}" --repo "${REPO}" --body "${health_url}"

  ok "Секреты окружения '${env_name}' успешно сохранены в GitHub (${REPO})"
}

configure_gh_environment \
  "production" \
  "${TMP_KEY_DIR}/id_ed25519_prod" \
  "/opt/mediacode/production" \
  "mediacode-prod" \
  "${PROD_URL}"

configure_gh_environment \
  "staging" \
  "${TMP_KEY_DIR}/id_ed25519_stage" \
  "/opt/mediacode/staging" \
  "mediacode-stage" \
  "${STAGE_URL}"

ok "Все временные файлы с приватными ключами удалены."
log "Рекомендация безопасности: если вы запускали этот скрипт непосредственно на production-сервере, выполните 'gh auth logout', чтобы не хранить токен GitHub на сервере."
