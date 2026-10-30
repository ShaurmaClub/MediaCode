#!/usr/bin/env bash
# Execute INSIDE disposable Ubuntu 24.04 container only. Never on the host.
set -euo pipefail
[[ -f /.dockerenv ]] || { echo 'Disposable container required' >&2; exit 90; }
[[ "${MEDIACODE_LAB_ACK:-}" = disposable ]] || exit 90
touch /tmp/mediacode-lab-authorized
cd /lab
git config --global --add safe.directory /lab
git config user.email lab@example.invalid
git config user.name 'MediaCode isolated lab'
git add .
git commit -qm 'Lab snapshot' || true
install -m 755 deploy/lab/systemctl.sh /usr/local/bin/systemctl
ln -sf /usr/local/bin/systemctl /bin/systemctl
[[ -x /usr/bin/node ]] || ln -s /usr/local/bin/node /usr/bin/node
echo 'LAB: OS/runtime'
cat /etc/os-release | head -n 3
node --version
npm ci --include=optional
npm run lint
npm run build
npm run test:security
npm run test:dist
npm run audit:prod
npm test
echo 'LAB: legacy schema from actual old release, synthetic data only'
git clone --quiet --no-checkout https://github.com/ShaurmaClub/MediaCode.git /tmp/mc-old-repo
git -C /tmp/mc-old-repo archive 94313bc15027cf0c5358399b61f82d119e587faf | tar -x -C /tmp/mc-old-repo
ln -s /lab/node_modules /tmp/mc-old-repo/node_modules
LEGACY_CODE_DIR=/tmp/mc-old-repo node --test tests/migration-preparation.test.js
echo 'LAB: clean installation (systemctl replaced by container process controller)'
PROD_DOMAIN=production.example.invalid STAGE_DOMAIN=stage.example.invalid bash deploy/install.sh --non-interactive --skip-certbot --skip-ufw
for _ in $(seq 1 30); do curl -fsS http://127.0.0.1:4000/api/health/ready >/dev/null && break; sleep 1; done
curl -fsS http://127.0.0.1:4000/api/health/ready
curl -fsS http://127.0.0.1:4001/api/health/ready
sha256sum /var/lib/mediacode/production/.env > /tmp/env-before
PROD_DOMAIN=production.example.invalid STAGE_DOMAIN=stage.example.invalid bash deploy/install.sh --non-interactive --skip-certbot --skip-ufw
sha256sum -c /tmp/env-before
runuser -u mediacode-stage -- test ! -r /var/lib/mediacode/production/.env
runuser -u deploy-stage -- test ! -r /var/lib/mediacode/production/data/media.db
runuser -u mediacode-stage -- test ! -w /opt/mediacode/production/current/server/index.js
echo 'LAB: Nginx denies private uploads'
nginx -t
nginx
status=$(curl -sS -o /tmp/private-result -w '%{http_code}' -H 'Host: production.example.invalid' http://127.0.0.1/uploads/recruitment/private.pdf)
[[ "$status" = 404 ]]
echo 'LAB: remaining deployment and SSH scenarios'
node deploy/lab/scenarios.mjs
echo 'LAB: all applicable scenarios passed; real systemd hardening and HTTPS issuance require VM/cutover validation.'
