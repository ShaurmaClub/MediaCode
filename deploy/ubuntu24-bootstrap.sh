#!/usr/bin/env bash
# ==============================================================================
# МедиаКод — Первичная подготовка сервера Ubuntu 24.04 LTS
# Запускать от root или через sudo:
#   sudo bash deploy/ubuntu24-bootstrap.sh
# ==============================================================================

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/ShaurmaClub/MediaCode.git}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
PROD_DIR="/var/www/mediacode"
STAGE_DIR="/var/www/mediacode-stage"
INSTALL_DOCKER="${INSTALL_DOCKER:-0}"

echo "=== 1. Обновление пакетов Ubuntu 24.04 и установка утилит сборки ==="
apt-get update
apt-get install -y curl git build-essential python3 nginx certbot python3-certbot-nginx ufw ca-certificates gnupg

echo "=== 2. Установка Node.js 22 LTS ==="
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q "^v22"; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

if [ "$INSTALL_DOCKER" = "1" ]; then
  echo "=== 2b. Установка Docker Engine и Docker Compose Plugin ==="
  if ! command -v docker >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh
  fi
fi

echo "=== 3. Создание сервисного пользователя ${DEPLOY_USER} ==="
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$DEPLOY_USER"
fi
mkdir -p "/home/${DEPLOY_USER}/.ssh"
chmod 700 "/home/${DEPLOY_USER}/.ssh"
touch "/home/${DEPLOY_USER}/.ssh/authorized_keys"
chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"

if [ "$INSTALL_DOCKER" = "1" ]; then
  usermod -aG docker "$DEPLOY_USER" || true
fi

echo "=== 4. Клонирование репозитория в ${PROD_DIR} (main) и ${STAGE_DIR} (dev) ==="
mkdir -p "$PROD_DIR" "$STAGE_DIR"
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "$PROD_DIR" "$STAGE_DIR"

if [ ! -d "$PROD_DIR/.git" ]; then
  sudo -u "$DEPLOY_USER" git clone -b main "$REPO_URL" "$PROD_DIR"
fi

if [ ! -d "$STAGE_DIR/.git" ]; then
  sudo -u "$DEPLOY_USER" git clone -b dev "$REPO_URL" "$STAGE_DIR" || sudo -u "$DEPLOY_USER" git clone -b main "$REPO_URL" "$STAGE_DIR"
fi

echo "=== 5. Генерация безопасных .env файлов (если ещё не созданы) ==="
setup_env() {
  local dir="$1"
  local port="$2"
  if [ ! -f "${dir}/.env" ]; then
    local secret
    secret="$(openssl rand -hex 32)"
    cat > "${dir}/.env" <<EOF
PORT=${port}
NODE_ENV=production
DB_PATH=./data/media.db
SESSION_SECRET=${secret}
AUTO_BACKUP=1
BACKUP_INTERVAL_HOURS=24
BACKUP_KEEP=14
BACKUP_DIR=./data/backups
EOF
    chown "${DEPLOY_USER}:${DEPLOY_USER}" "${dir}/.env"
    chmod 600 "${dir}/.env"
    echo "✅ Создан ${dir}/.env (PORT=${port})"
  fi
}

setup_env "$PROD_DIR" 4000
setup_env "$STAGE_DIR" 4001

echo "=== 6. Настройка прав sudoers для перезапуска сервисов без пароля ==="
cat > "/etc/sudoers.d/mediacode-${DEPLOY_USER}" <<EOF
${DEPLOY_USER} ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart mediacode, /usr/bin/systemctl restart mediacode-stage, /usr/bin/systemctl status mediacode, /usr/bin/systemctl status mediacode-stage
EOF
chmod 440 "/etc/sudoers.d/mediacode-${DEPLOY_USER}"

echo "=== 7. Установка systemd-юнитов ==="
cp "${PROD_DIR}/deploy/mediacode.service" /etc/systemd/system/mediacode.service
cp "${PROD_DIR}/deploy/mediacode-stage.service" /etc/systemd/system/mediacode-stage.service
systemctl daemon-reload
systemctl enable mediacode mediacode-stage

echo "=== 8. Первичная сборка и запуск ==="
sudo -u "$DEPLOY_USER" bash -c "cd '$PROD_DIR' && npm ci && npm run build"
systemctl restart mediacode

sudo -u "$DEPLOY_USER" bash -c "cd '$STAGE_DIR' && npm ci && npm run build"
systemctl restart mediacode-stage

echo "=== 9. Настройка файрвола UFW ==="
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "=================================================================="
echo "✅ Сервер Ubuntu 24.04 готов к работе!"
echo "Добавьте публичный SSH-ключ GitHub Actions в:"
echo "  /home/${DEPLOY_USER}/.ssh/authorized_keys"
echo "=================================================================="
