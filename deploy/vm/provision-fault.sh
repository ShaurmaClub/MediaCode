#!/usr/bin/env bash
# Root-owned client-side faults in disposable VM only, no production hooks.
set -euo pipefail
[[ -f /etc/mediacode-lab-vm && "$(hostname)" = mediacode-vm-lab ]] || exit 90
cmd=${0##*/}; hit=/root/mc-provision-fault-hit
fault=${MC_PROVISION_FAULT:-}; target="${!#}"
fail_once() { [[ ! -e "$hit" ]] && { touch "$hit"; exit 73; }; return 0; }
case "$cmd:$fault" in
  useradd:users) [[ "$target" != deploy-prod ]] || fail_once;;
  usermod:groups) [[ "$target" != deploy-prod ]] || fail_once;;
  install:directories) [[ "$target" != /opt/mediacode/production/releases ]] || fail_once;;
  install:keys) [[ "$target" != /etc/ssh/mediacode-keys/deploy-prod ]] || fail_once;;
  install:ssh-files) [[ "$target" != /etc/ssh/mediacode-deploy.conf ]] || fail_once;;
  sshd:ssh-validation) [[ " $* " != *' -f '* ]] || fail_once;;
  sshd:ssh-installed) [[ "$*" != '-t' ]] || fail_once;;
  systemctl:ssh-reload) [[ "$*" != 'reload ssh.service' ]] || fail_once;;
esac
case "$cmd" in useradd|usermod|sshd) exec "/usr/sbin/$cmd" "$@";; *) exec "/usr/bin/$cmd" "$@";; esac
