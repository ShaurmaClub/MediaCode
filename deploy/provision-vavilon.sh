#!/usr/bin/env bash
# Explicit preparation for EXISTING Ubuntu/Caddy hosts; no application/service cutover.
set -euo pipefail
mode='' legacy='' prod_key='' stage_key='' runtime_source=''
phase=arguments scratch='' ssh_armed=0
finish() {
  local rc=$?
  trap - EXIT
  if [[ "$rc" != 0 ]]; then
    echo "Provisioning failed at phase=$phase (code=$rc). Partial accounts/groups/directories/helpers may remain; inspect log and rerun after fixing the cause. No application unit was changed." >&2
    if [[ "$ssh_armed" = 1 ]]; then
      cp -p "$scratch/sshd_config.before" /etc/ssh/sshd_config
      if [[ -f "$scratch/sshd-users.before" ]]; then cp -p "$scratch/sshd-users.before" /etc/ssh/mediacode-deploy.conf;
      else rm -f /etc/ssh/mediacode-deploy.conf; fi
      if /usr/sbin/sshd -t; then systemctl reload ssh.service || echo 'SSH rollback reload failed: keep admin session/console open and inspect sshd before retry.' >&2; fi
      echo 'Original SSH files restored; administrator access must be verified before closing the existing session.' >&2
    fi
  fi
  [[ -z "$scratch" ]] || rm -rf "$scratch"
  exit "$rc"
}
trap finish EXIT
while (($#)); do
  case "$1" in
    --check|--apply) [[ -z "$mode" ]] || exit 10; mode="$1"; shift;;
    --legacy-dir) legacy="${2:?}"; shift 2;;
    --prod-key) prod_key="${2:?}"; shift 2;;
    --stage-key) stage_key="${2:?}"; shift 2;;
    --runtime-source) runtime_source="${2:?}"; shift 2;;
    --help) echo 'provision-vavilon.sh --check|--apply --legacy-dir /srv/services/MediaCode [--prod-key prod.pub --stage-key stage.pub --runtime-source /secure/frozen-source]'; exit 0;;
    *) echo 'Unknown/incomplete provisioning option' >&2; exit 10;;
  esac
done
fail() { echo "Provisioning blocked: $1" >&2; exit 10; }
[[ -n "$mode" && "$legacy" = /* && -d "$legacy" ]] || fail 'explicit mode and existing legacy directory required'
phase=preflight
source /etc/os-release
[[ "$ID" = ubuntu && "$VERSION_ID" =~ ^(22\.04|24\.04)$ ]] || fail 'Ubuntu 22.04/24.04 required'
[[ -d /run/systemd/system ]] || fail 'real systemd required (no container service shim)'
for cmd in sshd visudo setpriv install systemctl namei getfacl gpasswd; do command -v "$cmd" >/dev/null || fail "missing prerequisite $cmd"; done
source "$(dirname "$0")/unix-access.sh"
echo "OS: Ubuntu $VERSION_ID; legacy: $legacy"
systemctl show mediacode.service caddy.service -p Id -p LoadState -p ActiveState -p WorkingDirectory
for user in deploy-prod deploy-stage mediacode-prod mediacode-stage; do
  if id "$user" >/dev/null 2>&1; then
    echo "$user exists"
    suffix=prod; [[ "$user" != *stage ]] || suffix=stage
    for group in $(id -nG "$user"); do
      [[ "$group" = "$user" || "$group" = "mediacode-$suffix" || "$group" = "mediacode-code-$suffix" ]] || fail "$user has unexpected group $group; review manually"
    done
    [[ "$(id -gn "$user")" = "$user" ]] || fail "$user primary group mismatch"
    for other in prod stage; do
      [[ "$other" != "$suffix" ]] || continue
      if [[ -e "/var/lib/mediacode/$([[ "$other" = prod ]] && echo production || echo staging)" ]] && runuser -u "$user" -- test -r "/var/lib/mediacode/$([[ "$other" = prod ]] && echo production || echo staging)"; then fail 'cross-contour data access'; fi
    done
  else echo "$user needs creation"; fi
done
for contour in production staging; do audit_private_acl "/var/lib/mediacode/$contour" || fail 'data ACL audit failed'; done
legacy_open=0
for file in "$legacy/.env" "$legacy/data/media.db" "$legacy/uploads"; do
  [[ -e "$file" ]] || fail "missing legacy path: $file"
  namei -l "$file"
  if [[ "$EUID" = 0 ]]; then
    if setpriv --reuid=65534 --regid=65534 --clear-groups /usr/bin/test -r "$file"; then legacy_open=1; fi
    for user in deploy-stage mediacode-stage; do
      if id "$user" >/dev/null 2>&1 && runuser -u "$user" -- test -r "$file"; then legacy_open=1; fi
    done
  else
    # Conservative check; full effective ACL/group check requires administrator.
    [[ $(stat -c '%a' "$file") =~ [4567]$ ]] && legacy_open=1
  fi
done
if [[ "$legacy_open" = 1 ]]; then
  echo 'Legacy data is readable outside its owner. No chmod/chown is applied.'
  echo 'Plan: save getfacl metadata; approve owner-only traversal on legacy data root; verify Caddy only needs HTTP; test administrative access and then re-run --check.'
fi
if [[ -n "$prod_key" || -n "$stage_key" ]]; then
  for key in "$prod_key" "$stage_key"; do
    [[ -f "$key" ]] || fail 'both public key files required'
    [[ "$(awk 'NR==1{print $1}' "$key")" = ssh-ed25519 ]] || fail 'Ed25519 public keys required'
    [[ "$(awk 'END{print NR}' "$key")" = 1 ]] || fail 'one public key per file required'
    ssh-keygen -lf "$key" >/dev/null 2>&1 || fail 'invalid public key'
  done
  [[ "$(awk '{print $2}' "$prod_key")" != "$(awk '{print $2}' "$stage_key")" ]] || fail 'production/staging keys must differ'
fi
if [[ "$mode" = --check ]]; then
  [[ "$EUID" = 0 ]] || echo 'Repeat --check with sudo for effective permission/sudoers verification.'
  [[ ! -f /etc/sudoers.d/mediacode-deploy ]] || visudo -cf /etc/sudoers.d/mediacode-deploy
  echo "Read-only check complete; legacy permission gate=$legacy_open. No accounts, files or services changed."
  exit 0
fi
[[ "$EUID" = 0 ]] || fail '--apply requires administrator'
[[ "$legacy_open" = 0 ]] || fail 'approve and execute legacy permission plan separately before creating staging accounts'
[[ -f "$prod_key" && -f "$stage_key" ]] || fail 'two approved public keys required'
[[ -d "$runtime_source/server" && -d "$runtime_source/node_modules" ]] || fail '--runtime-source must name a frozen root-owned reviewed snapshot with built dependencies'
umask 077
scratch=$(mktemp -d)
phase=ssh-candidate
cat > "$scratch/sshd-users" <<'EOF'
Match User deploy-prod,deploy-stage
    AuthenticationMethods publickey
    AuthorizedKeysFile /etc/ssh/mediacode-keys/%u
    PermitUserRC no
    PubkeyAuthentication yes
    PubkeyAcceptedAlgorithms ssh-ed25519
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PermitTTY no
    AllowTcpForwarding no
    AllowAgentForwarding no
    X11Forwarding no
    PermitTunnel no
EOF
ssh_include='Include /etc/ssh/mediacode-deploy.conf'
cp /etc/ssh/sshd_config "$scratch/sshd_config"
if ! grep -qxF "$ssh_include" "$scratch/sshd_config"; then printf '\nMatch all\nInclude %s/sshd-users\n' "$scratch" >> "$scratch/sshd_config";
else sed -i "s|^$ssh_include\$|Include $scratch/sshd-users|" "$scratch/sshd_config"; fi
sshd -t -f "$scratch/sshd_config" || fail 'candidate sshd config invalid'
# Syntax alone is insufficient: preserve non-deploy administrator effective policy.
for admin in root no1se runner ubuntu; do
  sshd -T -C "user=$admin,host=localhost,addr=127.0.0.1" > "$scratch/admin.before"
  sshd -T -f "$scratch/sshd_config" -C "user=$admin,host=localhost,addr=127.0.0.1" > "$scratch/admin.after"
  cmp -s "$scratch/admin.before" "$scratch/admin.after" || fail 'candidate changes administrator SSH policy'
done
echo 'Candidate SSH configuration validated'
if [[ -f /etc/ssh/mediacode-deploy.conf ]]; then cmp -s /etc/ssh/mediacode-deploy.conf "$scratch/sshd-users" || fail 'existing deploy SSH policy differs; review before overwrite'; fi
# Install/validate the admin-owned helper and scoped sudo policy after account creation.
for suffix in prod stage; do
  echo "Preparing isolated accounts/directories: $suffix"
  runtime="mediacode-$suffix"; deploy="deploy-$suffix"
  phase="users-$suffix"
  id "$runtime" >/dev/null 2>&1 || useradd --system --user-group --shell /usr/sbin/nologin "$runtime"
  id "$deploy" >/dev/null 2>&1 || useradd --create-home --user-group --shell /bin/bash "$deploy"
  phase="groups-$suffix"; prepare_code_membership "$runtime" "$deploy"
  phase="keys-$suffix"
  # Deploy-owned ~/.ssh cannot authorize a shared Environment key anymore.
  [[ ! -L /etc/ssh/mediacode-keys ]] || fail 'symlink in administrator key directory'
  install -d -m 755 -o root -g root /etc/ssh/mediacode-keys
  key="$prod_key"; [[ "$suffix" != stage ]] || key="$stage_key"
  auth="/etc/ssh/mediacode-keys/$deploy"
  [[ ! -L "$auth" ]] || fail 'symlink in administrator key path'
  printf 'restrict %s\n' "$(cat "$key")" > "$scratch/key-$suffix"
  [[ ! -e "$auth" ]] || cmp -s "$auth" "$scratch/key-$suffix" || fail 'installed deploy key differs; explicit administrator key rotation required'
  install -m 644 -o root -g root "$scratch/key-$suffix" "$auth"
  contour=production; [[ "$suffix" != stage ]] || contour=staging
  phase="directories-$suffix"
  for dir in "/opt/mediacode/$contour" "/opt/mediacode/$contour/releases" "/opt/mediacode/$contour/repo"; do prepare_code_directory "$dir" "$deploy" "$runtime"; done
  install -d -m 700 -o "$runtime" -g "$runtime" "/var/lib/mediacode/$contour"
  for dir in data uploads uploads/recruitment backups; do install -d -m 750 -o "$runtime" -g "$runtime" "/var/lib/mediacode/$contour/$dir"; done
done
echo 'Installing administrator-owned broker and policy'
phase=broker-sudoers
/usr/bin/python3 -I "$(dirname "$0")/install-runtime-ops.py" "$runtime_source"
phase=ssh-files
cp -p /etc/ssh/sshd_config "$scratch/sshd_config.before"
[[ ! -e /etc/ssh/mediacode-deploy.conf ]] || cp -p /etc/ssh/mediacode-deploy.conf "$scratch/sshd-users.before"
ssh_armed=1
install -m 600 "$scratch/sshd-users" /etc/ssh/mediacode-deploy.conf
if ! grep -qxF "$ssh_include" /etc/ssh/sshd_config; then
  cp -p /etc/ssh/sshd_config "/etc/ssh/sshd_config.before-mediacode-$(date +%Y%m%d%H%M%S)"
  printf '\nMatch all\n%s\n' "$ssh_include" >> /etc/ssh/sshd_config
fi
phase=ssh-validation
sshd -t
phase=ssh-reload
systemctl reload ssh.service
ssh_armed=0
phase=complete
echo 'Accounts, isolated directories, scoped sudo and deploy-only publickey SSH prepared. Existing application units, Caddy, ports and data were not changed.'
