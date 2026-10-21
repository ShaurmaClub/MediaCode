#!/usr/bin/env bash
# ==============================================================================
# MediaCode — One-Command Production & Staging Installer for Ubuntu 24.04 LTS
# Идемпотентный установщик:
#   - Проверяет совместимость ОС, свободное место и конфликты портов
#   - Разделяет привилегии: пользователь `mediacode` (runtime) и `deploy` (CD)
#   - Создаёт изолированные контуры production (4000) и staging (4001)
#   - Сохраняет существующие .env, БД, uploads, Nginx и UFW без перезаписи
#   - Безопасно определяет фактический SSH-порт перед настройкой UFW
#   - Проверяет DNS-записи перед запросом сертификатов Let's Encrypt
#
# Запуск:
#   sudo bash deploy/install.sh
#   или неинтерактивно:
#   sudo PROD_DOMAIN=kaiton.ru STAGE_DOMAIN=stage.kaiton.ru CERTBOT_EMAIL=admin@kaiton.ru bash deploy/install.sh --non-interactive
# ==============================================================================

set -u
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

NON_INTERACTIVE=0
SKIP_CERTBOT=0
SKIP_UFW=0
FORCE_NGINX=0

for arg in "$@"; do
  case "${arg}" in
    --non-interactive|-y)
      NON_INTERACTIVE=1
      ;;
    --skip-certbot)
      SKIP_CERTBOT=1
      ;;
    --skip-ufw)
      SKIP_UFW=1
      ;;
    --force-nginx)
      FORCE_NGINX=1
      ;;
    --help|-h)
      cat <<'EOF'
Использование:
  sudo bash deploy/install.sh [опции]

Опции:
  --non-interactive, -y   Не запрашивать ввод интерактивно (использовать переменные окружения/значения по умолчанию)
  --skip-certbot          Пропустить выпуск TLS-сертификатов Let's Encrypt
  --skip-ufw              Не изменять настройки межсетевого экрана UFW
  --force-nginx           Перезаписать существующий конфиг /etc/nginx/sites-available/mediacode-kaiton.conf

Переменные окружения:
  PROD_DOMAIN             Production-домен (по умолчанию: kaiton.ru)
  STAGE_DOMAIN            Staging-домен (по умолчанию: stage.kaiton.ru)
  CERTBOT_EMAIL           Email администратора для Let's Encrypt (по умолчанию: пусто — без авто-выпуска TLS)
  REPO_URL                Git URL репозитория (по умолчанию: https://github.com/ShaurmaClub/MediaCode.git)
  RUNTIME_USER            Системный пользователь приложения (по умолчанию: mediacode)
  DEPLOY_USER             Системный пользователь деплоя (по умолчанию: deploy)
  PROD_PORT               Локальный порт production (по умолчанию: 4000)
  STAGE_PORT              Локальный порт staging (по умолчанию: 4001)
EOF
      exit 0
      ;;
  esac
done

log()  { printf '\033[1;34m[INSTALL]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[  OK   ]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[ WARN  ]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[ ERROR ]\033[0m %s\n' "$*" >&2; }

if [[ "${EUID}" -ne 0 ]]; then
  err "Запустите установщик с правами суперпользователя: sudo bash deploy/install.sh"
  exit 1
fi

# ------------------------------------------------------------------------------
# 1. Проверка совместимости Ubuntu 24.04 LTS и системных ресурсов
# ------------------------------------------------------------------------------
if [[ ! -f /etc/os-release ]]; then
  err "Не найден /etc/os-release. Поддерживается Ubuntu Server 24.04 LTS."
  exit 1
fi

# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  err "Обнаружена ОС '${ID:-unknown}'. Установщик рассчитан на Ubuntu Server 24.04 LTS."
  exit 1
fi

if [[ "${VERSION_ID:-}" != "24.04" ]]; then
  warn "Обнаружена Ubuntu ${VERSION_ID:-unknown} (целевая версия — 24.04 LTS). Продолжаем с осторожностью."
else
  ok "Операционная система: ${PRETTY_NAME}"
fi

FREE_DISK_MB="$(df -Pm / | awk 'NR==2 {print $4}')"
if [[ -z "${FREE_DISK_MB}" || "${FREE_DISK_MB}" -lt 2048 ]]; then
  err "Недостаточно свободного места на корневом разделе: ${FREE_DISK_MB:-0} МБ (минимум 2048 МБ)."
  exit 1
fi
ok "Свободное место на диске: ${FREE_DISK_MB} МБ"

# ------------------------------------------------------------------------------
# 2. Интерактивный мастер (если не указан --non-interactive)
# ------------------------------------------------------------------------------
PROD_DOMAIN="${PROD_DOMAIN:-kaiton.ru}"
STAGE_DOMAIN="${STAGE_DOMAIN:-stage.kaiton.ru}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
REPO_URL="${REPO_URL:-https://github.com/ShaurmaClub/MediaCode.git}"
RUNTIME_USER="${RUNTIME_USER:-mediacode}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
PROD_PORT="${PROD_PORT:-4000}"
STAGE_PORT="${STAGE_PORT:-4001}"
BASE_OPT_DIR="/opt/mediacode"
BASE_VAR_DIR="/var/lib/mediacode"

if [[ "${NON_INTERACTIVE}" -eq 0 && -t 0 ]]; then
  printf '\n=== Мастер первичной настройки MediaCode (Ubuntu 24.04 LTS) ===\n'
  read -r -p "Production-домен [${PROD_DOMAIN}]: " input_prod_domain
  PROD_DOMAIN="${input_prod_domain:-${PROD_DOMAIN}}"

  read -r -p "Staging-домен [${STAGE_DOMAIN}]: " input_stage_domain
  STAGE_DOMAIN="${input_stage_domain:-${STAGE_DOMAIN}}"

  read -r -p "Email для сертификатов Let's Encrypt (Enter чтобы пропустить HTTPS сейчас) [${CERTBOT_EMAIL}]: " input_email
  CERTBOT_EMAIL="${input_email:-${CERTBOT_EMAIL}}"
fi

log "Конфигурация:"
log "  Production: https://${PROD_DOMAIN} -> 127.0.0.1:${PROD_PORT}"
log "  Staging:    https://${STAGE_DOMAIN} -> 127.0.0.1:${STAGE_PORT}"
log "  Runtime user: ${RUNTIME_USER} | Deploy user: ${DEPLOY_USER}"

# ------------------------------------------------------------------------------
# 3. Предварительная диагностика конфликтов портов
# ------------------------------------------------------------------------------
check_port_conflict() {
  local port="$1"
  local expected_unit="$2"
  if command -v ss >/dev/null 2>&1; then
    local listener
    listener="$(ss -tulpn 2>/dev/null | grep -E ":${port}\b" || true)"
    if [[ -n "${listener}" ]]; then
      if systemctl is-active --quiet "${expected_unit}" 2>/dev/null; then
        ok "Порт ${port} уже используется активным сервисом ${expected_unit} (повторный запуск)."
      else
        err "Порт ${port} занят сторонним процессом:"
        err "${listener}"
        err "Освободите порт ${port} или задайте другой PROD_PORT / STAGE_PORT перед установкой."
        return 1
      fi
    fi
  fi
  return 0
}

check_port_conflict "${PROD_PORT}" "mediacode-prod.service" || exit 1
check_port_conflict "${STAGE_PORT}" "mediacode-stage.service" || exit 1

# ------------------------------------------------------------------------------
# 4. Установка системных пакетов и Node.js 22 LTS
# ------------------------------------------------------------------------------
log "Обновление индексов APT и установка базовых пакетов..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y || { err "Ошибка apt-get update"; exit 1; }
apt-get install -y \
  ca-certificates \
  curl \
  gnupg \
  git \
  sqlite3 \
  nginx \
  certbot \
  python3-certbot-nginx \
  ufw \
  build-essential \
  python3 \
  rsync \
  restic \
  jq \
  dnsutils \
  openssh-client || { err "Ошибка установки системных пакетов"; exit 1; }

NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  CURRENT_NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [[ "${CURRENT_NODE_MAJOR}" -ge 20 ]]; then
    ok "Node.js уже установлен: $(node -v)"
    NEED_NODE=0
  fi
fi

if [[ "${NEED_NODE}" -eq 1 ]]; then
  log "Установка Node.js 22.x LTS из официального репозитория NodeSource (с проверкой GPG-ключа)..."
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg || {
      err "Не удалось загрузить GPG-ключ NodeSource"
      exit 1
    }
  chmod a+r /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y && apt-get install -y nodejs || {
    err "Не удалось установить пакет nodejs"
    exit 1
  }
  ok "Установлен Node.js $(node -v), npm $(npm -v)"
fi

# ------------------------------------------------------------------------------
# 5. Создание изолированных непривилегированных пользователей (mediacode и deploy)
# ------------------------------------------------------------------------------
if ! id -u "${RUNTIME_USER}" >/dev/null 2>&1; then
  log "Создание непривилегированного runtime-пользователя ${RUNTIME_USER}..."
  useradd --system --create-home --home-dir "/home/${RUNTIME_USER}" --shell /usr/sbin/nologin "${RUNTIME_USER}"
  ok "Создан пользователь ${RUNTIME_USER}"
else
  ok "Пользователь ${RUNTIME_USER} уже существует"
fi

if ! id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
  log "Создание пользователя доставки релизов ${DEPLOY_USER}..."
  useradd --create-home --home-dir "/home/${DEPLOY_USER}" --shell /bin/bash -G "${RUNTIME_USER}" "${DEPLOY_USER}"
  ok "Создан пользователь ${DEPLOY_USER}"
else
  usermod -a -G "${RUNTIME_USER}" "${DEPLOY_USER}" || true
  ok "Пользователь ${DEPLOY_USER} уже существует"
fi

mkdir -p "/home/${DEPLOY_USER}/.ssh"
touch "/home/${DEPLOY_USER}/.ssh/authorized_keys"
chmod 700 "/home/${DEPLOY_USER}/.ssh"
chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"

# Ограниченный sudoers для пользователя deploy: только управление сервисами mediacode и запуск бэкапа
SUDOERS_FILE="/etc/sudoers.d/mediacode-deploy"
cat > "${SUDOERS_FILE}" <<EOF
Defaults:${DEPLOY_USER} !requiretty
${DEPLOY_USER} ALL=(root) NOPASSWD: /bin/systemctl restart mediacode-prod.service, /bin/systemctl restart mediacode-stage.service, /bin/systemctl reload mediacode-prod.service, /bin/systemctl reload mediacode-stage.service, /bin/systemctl status mediacode-prod.service, /bin/systemctl status mediacode-stage.service, /bin/systemctl is-active mediacode-prod.service, /bin/systemctl is-active mediacode-stage.service
${DEPLOY_USER} ALL=(${RUNTIME_USER}) NOPASSWD: /usr/bin/node, /usr/bin/env
EOF
chmod 440 "${SUDOERS_FILE}"
visudo -cf "${SUDOERS_FILE}" >/dev/null || {
  err "Ошибка проверки синтаксиса ${SUDOERS_FILE}"
  rm -f "${SUDOERS_FILE}"
  exit 1
}
ok "Настроены минимальные sudo-привилегии в ${SUDOERS_FILE}"

# ------------------------------------------------------------------------------
# 6. Создание структуры каталогов релизов и постоянных данных
# ------------------------------------------------------------------------------
log "Подготовка каталогов ${BASE_OPT_DIR} и ${BASE_VAR_DIR}..."
for env_name in production staging; do
  mkdir -p "${BASE_OPT_DIR}/${env_name}/releases"
  mkdir -p "${BASE_OPT_DIR}/${env_name}/shared"
  mkdir -p "${BASE_VAR_DIR}/${env_name}/data"
  mkdir -p "${BASE_VAR_DIR}/${env_name}/uploads"
  mkdir -p "${BASE_VAR_DIR}/${env_name}/backups"

  # Код принадлежит deploy:mediacode (runtime-пользователь имеет только чтение)
  chown -R "${DEPLOY_USER}:${RUNTIME_USER}" "${BASE_OPT_DIR}/${env_name}"
  chmod 750 "${BASE_OPT_DIR}/${env_name}"
  chmod 750 "${BASE_OPT_DIR}/${env_name}/releases"

  # Данные принадлежат mediacode:mediacode, права 750 (позволяет группе читать бэкапы при необходимости)
  chown -R "${RUNTIME_USER}:${RUNTIME_USER}" "${BASE_VAR_DIR}/${env_name}"
  chmod 750 "${BASE_VAR_DIR}/${env_name}"
  chmod 770 "${BASE_VAR_DIR}/${env_name}/data"
  chmod 770 "${BASE_VAR_DIR}/${env_name}/uploads"
  chmod 770 "${BASE_VAR_DIR}/${env_name}/backups"
done
chown "${DEPLOY_USER}:${RUNTIME_USER}" "${BASE_OPT_DIR}"
chmod 755 "${BASE_OPT_DIR}"
chown "${RUNTIME_USER}:${RUNTIME_USER}" "${BASE_VAR_DIR}"
chmod 755 "${BASE_VAR_DIR}"
ok "Каталоги релизов и данных готовы"

# ------------------------------------------------------------------------------
# 7. Идемпотентная генерация .env с криптостойкими секретами
# ------------------------------------------------------------------------------
create_env_if_missing() {
  local env_name="$1"
  local port="$2"
  local domain="$3"
  local env_file="${BASE_VAR_DIR}/${env_name}/.env"

  if [[ -f "${env_file}" ]]; then
    ok "Файл ${env_file} уже существует — существующие секреты сохранены без изменений"
    chmod 600 "${env_file}"
    chown "${RUNTIME_USER}:${RUNTIME_USER}" "${env_file}"
    return 0
  fi

  local session_secret
  session_secret="$(openssl rand -hex 32)"

  cat > "${env_file}" <<EOF
NODE_ENV=production
DEPLOY_ENV=${env_name}
HOST=127.0.0.1
PORT=${port}
PUBLIC_ORIGIN=https://${domain}
SESSION_SECRET=${session_secret}
DB_PATH=${BASE_VAR_DIR}/${env_name}/data/media.db
UPLOADS_DIR=${BASE_VAR_DIR}/${env_name}/uploads
BACKUP_DIR=${BASE_VAR_DIR}/${env_name}/backups
BACKUP_KEEP=14
RATE_LIMIT_MAX=250
AUTH_RATE_LIMIT_MAX=30
PUBLIC_RECRUIT_RATE_LIMIT_MAX=20
TRUST_PROXY=1
# ОПЦИОНАЛЬНО: внешнее зашифрованное хранилище бэкапов (restic)
# RESTIC_REPOSITORY=s3:https://s3.example.com/mediacode-backups
# RESTIC_PASSWORD=
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
# ОПЦИОНАЛЬНО: Telegram-алерты мониторинга и бэкапов
# TELEGRAM_BOT_TOKEN=
# TELEGRAM_CHAT_ID=
# TELEGRAM_THREAD_ID=
EOF
  chmod 600 "${env_file}"
  chown "${RUNTIME_USER}:${RUNTIME_USER}" "${env_file}"
  ok "Создан ${env_file} (права 0600, криптостойкий SESSION_SECRET сгенерирован, в лог не выводится)"
}

create_env_if_missing "production" "${PROD_PORT}" "${PROD_DOMAIN}"
create_env_if_missing "staging" "${STAGE_PORT}" "${STAGE_DOMAIN}"

# ------------------------------------------------------------------------------
# 8. Первичное развёртывание релизов production и staging
# ------------------------------------------------------------------------------
bootstrap_initial_release() {
  local env_name="$1"
  local env_root="${BASE_OPT_DIR}/${env_name}"
  local current_link="${env_root}/current"

  if [[ -L "${current_link}" && -d "${current_link}" && -f "${current_link}/server/index.js" ]]; then
    ok "Контур ${env_name} уже имеет активный релиз: $(readlink -f "${current_link}")"
    return 0
  fi

  local init_sha="initial-$(date -u +%Y%m%d%H%M%S)"
  if [[ -d "${SOURCE_REPO_DIR}/.git" ]]; then
    init_sha="$(git -C "${SOURCE_REPO_DIR}" rev-parse HEAD 2>/dev/null || echo "${init_sha}")"
  fi
  local release_dir="${env_root}/releases/${init_sha}"

  log "Подготовка первоначального релиза ${env_name} (${init_sha})..."
  mkdir -p "${release_dir}"

  if [[ -f "${SOURCE_REPO_DIR}/package.json" && -f "${SOURCE_REPO_DIR}/server/index.js" ]]; then
    rsync -a \
      --exclude='.git' \
      --exclude='node_modules' \
      --exclude='server/data' \
      --exclude='server/uploads' \
      --exclude='.env' \
      "${SOURCE_REPO_DIR}/" "${release_dir}/"
  else
    local branch="main"
    [[ "${env_name}" == "staging" ]] && branch="dev"
    git clone --depth 1 --branch "${branch}" "${REPO_URL}" "${release_dir}" || \
      git clone --depth 1 "${REPO_URL}" "${release_dir}" || {
        err "Не удалось получить исходный код для ${env_name}"
        return 1
      }
    rm -rf "${release_dir}/.git"
  fi

  printf '%s\n' "${init_sha}" > "${release_dir}/.release-sha"
  chown -R "${DEPLOY_USER}:${RUNTIME_USER}" "${release_dir}"

  log "Установка зависимостей и сборка frontend для ${env_name}..."
  su - "${DEPLOY_USER}" -c "cd '${release_dir}' && npm ci --no-audit --no-fund && npm run build && npm prune --omit=dev" || {
    err "Ошибка сборки первоначального релиза для ${env_name}"
    return 1
  }

  # Подключение персистентных каталогов данных и загрузок
  rm -rf "${release_dir}/server/data" "${release_dir}/server/uploads"
  ln -sfn "${BASE_VAR_DIR}/${env_name}/data" "${release_dir}/server/data"
  ln -sfn "${BASE_VAR_DIR}/${env_name}/uploads" "${release_dir}/server/uploads"
  ln -sfn "${BASE_VAR_DIR}/${env_name}/.env" "${release_dir}/.env"

  chown -R "${DEPLOY_USER}:${RUNTIME_USER}" "${release_dir}"
  chmod -R u=rwX,g=rX,o= "${release_dir}"

  # Проверка и применение миграций БД от имени runtime-пользователя
  sudo -u "${RUNTIME_USER}" env \
    NODE_ENV=production \
    DB_PATH="${BASE_VAR_DIR}/${env_name}/data/media.db" \
    node "${release_dir}/server/migrate.js" || {
      err "Ошибка инициализации схемы БД для ${env_name}"
      return 1
    }

  ln -sfn "${release_dir}" "${current_link}"
  chown -h "${DEPLOY_USER}:${RUNTIME_USER}" "${current_link}"
  ok "Первоначальный релиз ${env_name} установлен: ${release_dir}"
}

bootstrap_initial_release "production" || exit 1
bootstrap_initial_release "staging" || exit 1

# ------------------------------------------------------------------------------
# 9. Установка и запуск systemd unit-файлов и таймеров
# ------------------------------------------------------------------------------
log "Установка systemd сервисов и таймеров..."
TEMPLATE_DIR="${BASE_OPT_DIR}/production/current/deploy"
for unit_file in \
  mediacode-prod.service \
  mediacode-stage.service \
  mediacode-backup.service \
  mediacode-backup.timer \
  mediacode-monitor.service \
  mediacode-monitor.timer; do
  if [[ -f "${TEMPLATE_DIR}/${unit_file}" ]]; then
    cp "${TEMPLATE_DIR}/${unit_file}" "/etc/systemd/system/${unit_file}"
  elif [[ -f "${SCRIPT_DIR}/${unit_file}" ]]; then
    cp "${SCRIPT_DIR}/${unit_file}" "/etc/systemd/system/${unit_file}"
  fi
done

chmod +x "${BASE_OPT_DIR}/production/current/deploy/"*.sh 2>/dev/null || true
chmod +x "${BASE_OPT_DIR}/staging/current/deploy/"*.sh 2>/dev/null || true

systemctl daemon-reload
systemctl enable mediacode-prod.service mediacode-stage.service mediacode-backup.timer mediacode-monitor.timer
systemctl restart mediacode-prod.service
systemctl restart mediacode-stage.service
systemctl start mediacode-backup.timer mediacode-monitor.timer
ok "Сервисы mediacode-prod, mediacode-stage и таймеры backup/monitor запущены и добавлены в автозагрузку"

# ------------------------------------------------------------------------------
# 10. Настройка Nginx (без разрушения существующих сайтов)
# ------------------------------------------------------------------------------
NGINX_AVAIL="/etc/nginx/sites-available/mediacode-kaiton.conf"
NGINX_ENABLED="/etc/nginx/sites-enabled/mediacode-kaiton.conf"

if [[ -f "${NGINX_AVAIL}" && "${FORCE_NGINX}" -eq 0 ]]; then
  ok "Конфигурация Nginx ${NGINX_AVAIL} уже существует (сохранена без перезаписи; используйте --force-nginx для замены)"
else
  log "Создание конфигурации Nginx ${NGINX_AVAIL} для ${PROD_DOMAIN} и ${STAGE_DOMAIN}..."
  cat > "${NGINX_AVAIL}" <<EOF
# MediaCode Nginx Reverse Proxy (generated by deploy/install.sh)
limit_req_zone \$binary_remote_addr zone=mediacode_api_limit:10m rate=15r/s;
limit_req_zone \$binary_remote_addr zone=mediacode_auth_limit:10m rate=3r/s;

server {
    listen 80;
    listen [::]:80;
    server_name ${PROD_DOMAIN} www.${PROD_DOMAIN};

    server_tokens off;
    client_max_body_size 15M;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location /uploads/ {
        alias ${BASE_VAR_DIR}/production/uploads/;
        access_log off;
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }

    location /api/auth/ {
        limit_req zone=mediacode_auth_limit burst=10 nodelay;
        proxy_pass http://127.0.0.1:${PROD_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /api/ {
        limit_req zone=mediacode_api_limit burst=30 nodelay;
        proxy_pass http://127.0.0.1:${PROD_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:${PROD_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name ${STAGE_DOMAIN};

    server_tokens off;
    client_max_body_size 15M;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Robots-Tag "noindex, nofollow" always;

    location /uploads/ {
        alias ${BASE_VAR_DIR}/staging/uploads/;
        access_log off;
        expires 7d;
    }

    location / {
        proxy_pass http://127.0.0.1:${STAGE_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  ln -sfn "${NGINX_AVAIL}" "${NGINX_ENABLED}"
  # Удаляем дефолтный сайт только если на сервере нет других кастомных конфигов
  OTHER_SITES="$(find /etc/nginx/sites-enabled -maxdepth 1 -type l ! -name 'default' ! -name 'mediacode-kaiton.conf' | wc -l)"
  if [[ "${OTHER_SITES}" -eq 0 && -L /etc/nginx/sites-enabled/default ]]; then
    rm -f /etc/nginx/sites-enabled/default
  fi
fi

# Разрешаем Nginx читать каталог загрузок через группу mediacode
if id -u www-data >/dev/null 2>&1; then
  usermod -a -G "${RUNTIME_USER}" www-data || true
fi

if nginx -t; then
  systemctl enable nginx
  systemctl reload nginx
  ok "Конфигурация Nginx проверена и применена"
else
  err "Проверка nginx -t завершилась ошибкой. Проверьте ${NGINX_AVAIL}"
  exit 1
fi

# ------------------------------------------------------------------------------
# 11. Безопасная настройка UFW с определением фактического SSH-порта
# ------------------------------------------------------------------------------
if [[ "${SKIP_UFW}" -eq 0 ]] && command -v ufw >/dev/null 2>&1; then
  log "Проверка конфигурации SSH и межсетевого экрана UFW..."
  DETECTED_SSH_PORTS=""
  if command -v sshd >/dev/null 2>&1; then
    DETECTED_SSH_PORTS="$(sshd -T 2>/dev/null | awk '$1 == "port" {print $2}' || true)"
  fi
  if [[ -z "${DETECTED_SSH_PORTS}" ]]; then
    DETECTED_SSH_PORTS="$(grep -E '^[[:space:]]*Port[[:space:]]+[0-9]+' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null | awk '{print $NF}' || true)"
  fi
  [[ -z "${DETECTED_SSH_PORTS}" ]] && DETECTED_SSH_PORTS="22"

  for ssh_port in ${DETECTED_SSH_PORTS}; do
    ufw allow "${ssh_port}/tcp" comment "SSH port (auto-detected)" >/dev/null
    ok "Разрешён SSH-порт в UFW: ${ssh_port}/tcp"
  done

  ufw allow 'Nginx Full' >/dev/null 2>&1 || {
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
  }

  UFW_STATE="$(ufw status | head -n 1 || true)"
  if echo "${UFW_STATE}" | grep -qi "inactive"; then
    ufw default deny incoming >/dev/null
    ufw default allow outgoing >/dev/null
    ufw --force enable >/dev/null
    ok "Межсетевой экран UFW активирован (SSH и 80/443 открыты, порты ${PROD_PORT}/${STAGE_PORT} закрыты снаружи)"
  else
    ok "UFW уже активен — существующие правила сохранены, доступ к SSH и Nginx подтверждён"
  fi
fi

# ------------------------------------------------------------------------------
# 12. Выпуск TLS-сертификатов Let's Encrypt с предварительной проверкой DNS
# ------------------------------------------------------------------------------
check_domain_dns() {
  local domain="$1"
  local server_ip="$2"
  local resolved_ip
  resolved_ip="$(dig +short A "${domain}" @1.1.1.1 2>/dev/null | tail -n1 || true)"
  if [[ -z "${resolved_ip}" ]]; then
    warn "DNS A-запись для ${domain} не найдена."
    return 1
  fi
  if [[ -n "${server_ip}" && "${resolved_ip}" != "${server_ip}" ]]; then
    warn "Домен ${domain} указывает на ${resolved_ip}, а публичный IP сервера — ${server_ip}."
    return 1
  fi
  ok "DNS-проверка пройдена: ${domain} -> ${resolved_ip}"
  return 0
}

if [[ "${SKIP_CERTBOT}" -eq 0 && -n "${CERTBOT_EMAIL}" ]]; then
  PUBLIC_IP="$(curl -4 -fsSL --max-time 5 https://ifconfig.me 2>/dev/null || true)"
  CERT_DOMAINS=()

  if check_domain_dns "${PROD_DOMAIN}" "${PUBLIC_IP}"; then
    CERT_DOMAINS+=("-d" "${PROD_DOMAIN}")
    if check_domain_dns "www.${PROD_DOMAIN}" "${PUBLIC_IP}"; then
      CERT_DOMAINS+=("-d" "www.${PROD_DOMAIN}")
    fi
  else
    warn "Выпуск сертификата для ${PROD_DOMAIN} отложен до настройки DNS."
  fi

  if check_domain_dns "${STAGE_DOMAIN}" "${PUBLIC_IP}"; then
    CERT_DOMAINS+=("-d" "${STAGE_DOMAIN}")
  else
    warn "Выпуск сертификата для ${STAGE_DOMAIN} отложен до настройки DNS."
  fi

  if [[ "${#CERT_DOMAINS[@]}" -gt 0 ]]; then
    log "Запрос сертификатов Let's Encrypt через Certbot..."
    if certbot --nginx --non-interactive --agree-tos --redirect -m "${CERTBOT_EMAIL}" "${CERT_DOMAINS[@]}"; then
      systemctl enable certbot.timer 2>/dev/null || true
      systemctl start certbot.timer 2>/dev/null || true
      ok "HTTPS-сертификаты успешно выпущены, таймер автопродления certbot.timer активен"
    else
      warn "Certbot не смог выпустить сертификат автоматически. Вы можете повторить позже: sudo certbot --nginx"
    fi
  fi
else
  log "Автоматический выпуск TLS пропущен (не задан CERTBOT_EMAIL или передан --skip-certbot)."
fi

# ------------------------------------------------------------------------------
# 13. Финальная проверка работоспособности обоих контуров (Health & Readiness)
# ------------------------------------------------------------------------------
verify_local_contour() {
  local env_name="$1"
  local port="$2"
  local url="http://127.0.0.1:${port}/api/health/ready"
  local attempt=1
  while [[ "${attempt}" -le 15 ]]; do
    local resp
    resp="$(curl -fsS --max-time 5 "${url}" 2>/dev/null || true)"
    if [[ -n "${resp}" ]] && echo "${resp}" | grep -q '"ok":true' && echo "${resp}" | grep -q '"db":"ok"'; then
      ok "Контур ${env_name} (127.0.0.1:${port}) готов к работе: ${resp}"
      return 0
    fi
    sleep 2
    attempt=$((attempt + 1))
  done
  err "Контур ${env_name} не прошёл проверку готовности по адресу ${url}"
  journalctl -u "mediacode-${env_name:0:4}.service" -n 30 --no-pager >&2 || true
  return 1
}

verify_local_contour "production" "${PROD_PORT}" || exit 1
verify_local_contour "staging" "${STAGE_PORT}" || exit 1

cat <<EOF

================================================================================
MediaCode успешно установлен и проверен!
================================================================================
Production:
  - URL:       https://${PROD_DOMAIN} (upstream 127.0.0.1:${PROD_PORT})
  - Релизы:    ${BASE_OPT_DIR}/production/current
  - Данные/БД: ${BASE_VAR_DIR}/production/data/media.db
  - Конфиг:    ${BASE_VAR_DIR}/production/.env
  - Сервис:    mediacode-prod.service

Staging:
  - URL:       https://${STAGE_DOMAIN} (upstream 127.0.0.1:${STAGE_PORT})
  - Релизы:    ${BASE_OPT_DIR}/staging/current
  - Данные/БД: ${BASE_VAR_DIR}/staging/data/media.db
  - Конфиг:    ${BASE_VAR_DIR}/staging/.env
  - Сервис:    mediacode-stage.service

Следующий шаг (привязка GitHub Actions для автоматического CI/CD):
  Запустите помощник настройки GitHub Secrets:
    bash deploy/setup-github.sh --host <IP_ИЛИ_ДОМЕН_СЕРВЕРА>
================================================================================
EOF
