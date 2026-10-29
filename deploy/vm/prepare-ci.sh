#!/usr/bin/env bash
# Only a disposable GitHub-HOSTED Ubuntu VM. Never a self-hosted/Vavilon runner.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" = true && "${RUNNER_ENVIRONMENT:-}" = github-hosted && "$EUID" = 0 ]] || exit 90
[[ "$(cat /proc/1/comm)" = systemd ]] || exit 90
source /etc/os-release
[[ "$ID" = ubuntu && "$VERSION_ID" = 22.04 ]] || exit 90
hostnamectl set-hostname mediacode-vm-lab
touch /etc/mediacode-lab-vm
ln -sf /usr/local/libexec/mediacode-node /usr/bin/node
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq sqlite3 openssh-server sudo
systemctl start ssh
cd /srv/review
echo "Real VM: Ubuntu $VERSION_ID; $(systemctl --version | head -n 1); PID1=$(cat /proc/1/comm)"
/usr/local/libexec/mediacode-node --version
/usr/local/libexec/mediacode-node deploy/vm/scenarios.mjs
