#!/usr/bin/env bash
# Client-side injection only; installed broker is not modified and has no test bypass.
set -euo pipefail
[[ -f /etc/mediacode-lab-vm && "$(hostname)" = mediacode-vm-lab ]] || exit 90
cmd=${0##*/}; fault=${FAULT_CASE:-}; hit=/tmp/mediacode-fault-hit
args="$*"
once() { [[ ! -e "$hit" ]] && { touch "$hit"; return 0; }; return 1; }
case "$cmd:$fault" in
  ln:previous-ln|mv:previous-mv) if [[ "$args" = *previous.next.* ]] && once; then exit 1; fi;;
  ln:current-ln|mv:current-mv) if [[ "$args" = *current.next.* ]] && once; then exit 1; fi;;
  sudo:prepare) if [[ "${4:-}" = policy ]] && once; then exit 1; fi;;
  sudo:stop) if [[ "${4:-}" = stop ]] && once; then exit 1; fi;;
  sudo:restart) if [[ "${4:-}" = restart ]] && once; then exit 1; fi;;
  sudo:restart-all) if [[ "${4:-}" = restart ]]; then exit 1; fi;;
  sudo:db-unavailable|sudo:future-schema|sudo:interrupt)
    if [[ "${4:-}" = stop ]] && once; then
      /usr/bin/sudo "$@"
      if [[ "$fault" = db-unavailable ]]; then /bin/mv /var/lib/mediacode/production/data/media.db /var/lib/mediacode/production/data/hidden.db;
      elif [[ "$fault" = future-schema ]]; then sqlite3 /var/lib/mediacode/production/data/media.db 'PRAGMA user_version=99';
      else kill -TERM "$PPID"; fi
      exit 0
    fi;;
  sudo:readiness)
    if [[ "${4:-}" = restart ]] && once; then sqlite3 /var/lib/mediacode/production/data/media.db 'INSERT INTO lab_preserve VALUES (999)'; fi;;
  curl:health) exit 1;;
esac
exec "/usr/bin/$cmd" "$@"
