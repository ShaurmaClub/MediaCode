#!/usr/bin/env bash
# Read-only: no sudo escalation, writes, installation or service mutations.
set -u
set -o pipefail
legacy=''
if [[ "${1:-}" = --legacy-dir && -n "${2:-}" ]]; then legacy="$2";
elif (($#)); then echo 'Usage: bash inspect-legacy.sh [--legacy-dir /absolute/path]' >&2; exit 10; fi
section() { printf '\n## %s\n\n' "$1"; }
printf '# MediaCode legacy audit\n\nCaptured: %s\n' "$(date -u +%FT%TZ)"
section 'Host and resources'
hostname
sed -n '/^PRETTY_NAME=/p;/^VERSION_ID=/p' /etc/os-release 2>/dev/null
node --version 2>/dev/null || true
npm --version 2>/dev/null || true
uptime
df -h / /srv /opt /var/lib 2>/dev/null || true
free -m 2>/dev/null || true
section 'Systemd (paths/identity only; environment and command arguments suppressed)'
if command -v systemctl >/dev/null; then
  systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null || true
  for unit in mediacode mediacode-prod mediacode-stage; do
    systemctl show "$unit.service" -p LoadState -p ActiveState -p User -p Group -p MainPID -p WorkingDirectory -p FragmentPath -p EnvironmentFiles 2>/dev/null || true
  done
fi
section 'Containers and process names (no environment/arguments)'
docker ps --format '{{.Names}} | {{.Image}} | {{.Ports}}' 2>/dev/null || true
ps -eo user,pid,comm | awk 'NR==1 || /node|PM2|nginx|caddy|docker|python/'
section 'Installation and persistent state'
for dir in /opt/mediacode /var/lib/mediacode; do stat -c '%n mode=%a owner=%U:%G' "$dir" 2>/dev/null || true; done
if [[ -n "$legacy" && "$legacy" = /* && -d "$legacy" ]]; then
  stat -c '%n mode=%a owner=%U:%G' "$legacy"
  git -C "$legacy" rev-parse HEAD 2>/dev/null || true
  git -C "$legacy" diff --name-only 2>/dev/null || true
  python3 - "$legacy" <<'PY'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1]).resolve()
env = root / '.env'
print(f'.env: {env} present={env.is_file()}')
values = {}
if env.is_file():
    for line in env.read_text().splitlines():
        m = re.match(r'^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$', line)
        if m: values[m[1]] = m[2].strip().strip(chr(34) + chr(39))
for key, default in [('DB_PATH', './data/media.db'), ('UPLOAD_DIR', './uploads/recruitment'), ('UPLOADS_DIR', ''), ('BACKUP_DIR', './data/backups')]:
    value = values.get(key, default)
    if not value: continue
    if any(c in value for c in ('\n', '\r', '$', '`')):
        print(f'{key}: requires manual path review'); continue
    p = pathlib.Path(value)
    if not p.is_absolute(): p = root / p
    print(f'{key}: {p} exists={p.exists()}')
    if key == 'DB_PATH':
        for suffix in ('', '-wal', '-shm'):
            f = pathlib.Path(str(p) + suffix)
            if f.exists(): print(f'  {f}: {f.stat().st_size} bytes mode={oct(f.stat().st_mode & 0o777)}')
print('SESSION_SECRET: present (value suppressed)' if values.get('SESSION_SECRET') else 'SESSION_SECRET: absent')
PY
else
  echo 'Supply --legacy-dir after identifying the live WorkingDirectory. No data paths assumed.'
fi
section 'Listeners, domains and certificates'
ss -Hltn 2>/dev/null || true
python3 - <<'PY'
import pathlib, re
for root in ['/etc/nginx/sites-enabled', '/etc/caddy']:
    for p in pathlib.Path(root).glob('*'):
        try: text = p.read_text()
        except (OSError, UnicodeError): continue
        print(f'Proxy config: {p}')
        for line in text.splitlines():
            s = line.strip()
            if re.match(r'^(server_name|listen|ssl_certificate)\s', s) or re.match(r'^[\w., -]+\{\s*$', s): print(s)
for p in pathlib.Path('/etc/letsencrypt/live').glob('*/fullchain.pem'):
    print(f'Certificate path: {p} (private keys never read)')
PY
section 'GitHub Actions connectivity'
echo 'UNKNOWN: workstation SSH success does not prove runner reachability.'
echo 'Tailscale 100.64.0.0/10 requires an enrolled runner or separately approved public SSH route.'
section 'Decision'
echo 'Keep existing proxy, TLS, SSH, firewall and unrelated services. Obtain approval before cutover.'
echo 'Audit incomplete if permission errors hid paths/configs; repeat from trusted console as needed.'
