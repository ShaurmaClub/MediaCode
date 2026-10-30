#!/usr/bin/env bash
# Run as root ONLY in the disposable guest booted by boot.sh.
set -euo pipefail
[[ "$(hostname)" = mediacode-vm-lab && "$(systemd-detect-virt)" = kvm ]] || exit 90
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git sqlite3 build-essential python3 rsync sudo shellcheck xz-utils acl
cd /tmp
curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o node-shasums
node_archive=$(awk '$2 ~ /^node-v22\..*-linux-x64.tar.xz$/ {print $2}' node-shasums)
[[ -n "$node_archive" ]] || exit 10
curl -fsSL "https://nodejs.org/dist/latest-v22.x/$node_archive" -o "$node_archive"
grep -F " $node_archive" node-shasums | sha256sum -c -
tar -xJf "$node_archive" --strip-components=1 -C /usr/local
ln -sf /usr/local/bin/node /usr/bin/node
install -d -m 755 /srv/review
tar -xzf /tmp/review.tar.gz -C /srv/review
cd /srv/review
git init -q
git config user.email lab@example.invalid
git config user.name 'MediaCode VM lab'
git add .
git commit -qm 'Isolated review snapshot'
git -c core.autocrlf=false checkout-index -af
npm ci --include=optional
npm run lint
npm run build
NODE_ENV=test SESSION_SECRET=vm-lab-only-secret-minimum-32-characters npm test
touch /etc/mediacode-lab-vm
node deploy/vm/scenarios.mjs
