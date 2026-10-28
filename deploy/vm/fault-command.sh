#!/usr/bin/env bash
# Fault wrapper used solely in the explicit VM lab; calls real systemd otherwise.
set -euo pipefail
[[ -f /etc/mediacode-lab-vm && "$(hostname)" = mediacode-vm-lab ]] || exit 90
cmd=${0##*/}; fault=${FAULT_CASE:-}; hit=${FAULT_HIT:-/tmp/mediacode-fault-hit}
args="$*"
once() { [[ ! -e "$hit" ]] && { touch "$hit"; return 0; }; return 1; }
case "$cmd:$fault" in
  ln:previous-ln|mv:previous-mv) if [[ "$args" = *previous.next.* ]] && once; then exit 1; fi;;
  ln:current-ln|mv:current-mv) if [[ "$args" = *current.next.* ]] && once; then exit 1; fi;;
  systemctl:stop) if [[ "${1:-}" = stop ]] && once; then exit 1; fi;;
  systemctl:restart) if [[ "${1:-}" = restart ]] && once; then exit 1; fi;;
  systemctl:restart-all) if [[ "${1:-}" = restart ]]; then exit 1; fi;;
  systemctl:db-unavailable|systemctl:future-schema)
    if [[ "${1:-}" = stop ]] && once; then
      /bin/systemctl "$@"
      if [[ "$fault" = db-unavailable ]]; then /bin/mv /var/lib/mediacode/production/data/media.db /var/lib/mediacode/production/data/hidden.db;
      else sqlite3 /var/lib/mediacode/production/data/media.db 'PRAGMA user_version=99'; fi
      exit 0
    fi;;
  systemctl:readiness)
    if [[ "${1:-}" = restart ]] && once; then sqlite3 /var/lib/mediacode/production/data/media.db 'INSERT INTO lab_preserve VALUES (999)'; fi;;
  curl:health) exit 1;;
esac
exec "/usr/bin/$cmd" "$@"
