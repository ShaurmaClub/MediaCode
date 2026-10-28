#!/usr/bin/env bash
# Explicit preparation for EXISTING Ubuntu/Caddy hosts; no application/service cutover.
set -euo pipefail
mode='' legacy='' prod_key='' stage_key=''
while (($#)); do
  case "$1" in
    --check|--apply) [[ -z "$mode" ]] || exit 10; mode="$1"; shift;;
    --legacy-dir) legacy="${2:?}"; shift 2;;
    --prod-key) prod_key="${2:?}"; shift 2;;
    --stage-key) stage_key="${2:?}"; shift 2;;
    --help) echo 'provision-vavilon.sh --check|--apply --legacy-dir /srv/services/MediaCode [--prod-key prod.pub --stage-key stage.pub]'; exit 0;;
    *) echo 'Unknown/incomplete provisioning option' >&2; exit 10;;
  esac
done
fail() { echo "Provisioning blocked: $1" >&2; exit 10; }
[[ -n "$mode" && "$legacy" = /* && -d "$legacy" ]] || fail 'explicit mode and existing legacy directory required'
source /etc/os-release
[[ "$ID" = ubuntu && "$VERSION_ID" =~ ^(22\.04|24\.04)$ ]] || fail 'Ubuntu 22.04/24.04 required'
[[ -d /run/systemd/system ]] || fail 'real systemd required (no container service shim)'
for cmd in sshd visudo setpriv install systemctl namei; do command -v "$cmd" >/dev/null || fail "missing prerequisite $cmd"; done
echo "OS: Ubuntu $VERSION_ID; legacy: $legacy"
systemctl show mediacode.service caddy.service -p Id -p LoadState -p ActiveState -p WorkingDirectory
for user in deploy-prod deploy-stage mediacode-prod mediacode-stage; do
  if id "$user" >/dev/null 2>&1; then
    echo "$user exists"
    suffix=prod; [[ "$user" != *stage ]] || suffix=stage
    for group in $(id -nG "$user"); do
      [[ "$group" = "$user" || "$group" = "mediacode-$suffix" ]] || fail "$user has unexpected group $group; review manually"
    done
    [[ "$(id -gn "$user")" = "$user" ]] || fail "$user primary group mismatch"
    for other in prod stage; do
      [[ "$other" != "$suffix" ]] || continue
      if [[ -e "/var/lib/mediacode/$([[ "$other" = prod ]] && echo production || echo staging)" ]] && runuser -u "$user" -- test -r "/var/lib/mediacode/$([[ "$other" = prod ]] && echo production || echo staging)"; then fail 'cross-contour data access'; fi
    done
  else echo "$user needs creation"; fi
done
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
umask 077
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
cat > "$scratch/sshd-users" <<'EOF'
Match User deploy-prod,deploy-stage
    AuthenticationMethods publickey
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
if ! grep -qxF "$ssh_include" "$scratch/sshd_config"; then printf '\nInclude %s/sshd-users\n' "$scratch" >> "$scratch/sshd_config";
else sed -i "s|^$ssh_include\$|Include $scratch/sshd-users|" "$scratch/sshd_config"; fi
sshd -t -f "$scratch/sshd_config" || fail 'candidate sshd config invalid'
if [[ -f /etc/ssh/mediacode-deploy.conf ]]; then cmp -s /etc/ssh/mediacode-deploy.conf "$scratch/sshd-users" || fail 'existing deploy SSH policy differs; review before overwrite'; fi
# Keep all root commands restricted to the single Environment service.
for suffix in prod stage; do
  printf 'deploy-%s ALL=(root) NOPASSWD: /bin/systemctl restart mediacode-%s.service, /bin/systemctl stop mediacode-%s.service, /bin/systemctl start mediacode-%s.service, /bin/systemctl status mediacode-%s.service, /bin/systemctl is-active mediacode-%s.service\n' "$suffix" "$suffix" "$suffix" "$suffix" "$suffix" "$suffix"
  printf 'deploy-%s ALL=(mediacode-%s) NOPASSWD: /usr/bin/env, /usr/bin/node, /bin/test\n' "$suffix" "$suffix"
done > "$scratch/sudoers"
# Validate syntax before installing; unknown users may warn before their creation.
visudo -cf "$scratch/sudoers" || fail 'candidate sudoers invalid'
for suffix in prod stage; do
  runtime="mediacode-$suffix"; deploy="deploy-$suffix"
  id "$runtime" >/dev/null 2>&1 || useradd --system --user-group --shell /usr/sbin/nologin "$runtime"
  id "$deploy" >/dev/null 2>&1 || useradd --create-home --user-group --shell /bin/bash "$deploy"
  usermod -a -G "$runtime" "$deploy"
  [[ ! -L "/home/$deploy/.ssh" && ! -L "/home/$deploy/.ssh/authorized_keys" ]] || fail 'symlink in deploy key path; review manually'
  install -d -m 700 -o "$deploy" -g "$deploy" "/home/$deploy/.ssh"
  key="$prod_key"; other_key="$stage_key"; [[ "$suffix" != stage ]] || { key="$stage_key"; other_key="$prod_key"; }
  auth="/home/$deploy/.ssh/authorized_keys"
  [[ ! -f "$auth" ]] || ! grep -qF "$(awk '{print $2}' "$other_key")" "$auth" || fail 'other Environment key already authorized; remove separately'
  touch "$auth"
  if ! grep -qF "$(awk '{print $2}' "$key")" "$auth"; then printf 'restrict %s\n' "$(cat "$key")" >> "$auth"; fi
  chown "$deploy:$deploy" "$auth"; chmod 600 "$auth"
  contour=production; [[ "$suffix" != stage ]] || contour=staging
  install -d -m 750 -o "$deploy" -g "$runtime" "/opt/mediacode/$contour" "/opt/mediacode/$contour/releases" "/opt/mediacode/$contour/repo"
  install -d -m 700 -o "$runtime" -g "$runtime" "/var/lib/mediacode/$contour"
  for dir in data uploads uploads/recruitment backups; do install -d -m 750 -o "$runtime" -g "$runtime" "/var/lib/mediacode/$contour/$dir"; done
done
install -m 440 "$scratch/sudoers" /etc/sudoers.d/mediacode-deploy
install -m 600 "$scratch/sshd-users" /etc/ssh/mediacode-deploy.conf
if ! grep -qxF "$ssh_include" /etc/ssh/sshd_config; then
  cp -p /etc/ssh/sshd_config "/etc/ssh/sshd_config.before-mediacode-$(date +%Y%m%d%H%M%S)"
  printf '\n%s\n' "$ssh_include" >> /etc/ssh/sshd_config
fi
sshd -t
systemctl reload ssh.service
echo 'Accounts, isolated directories, scoped sudo and deploy-only publickey SSH prepared. Existing application units, Caddy, ports and data were not changed.'
