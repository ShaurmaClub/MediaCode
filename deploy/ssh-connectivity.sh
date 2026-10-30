#!/usr/bin/env bash
# Runner-side diagnosis. Remote command is always the literal `id -un`.
set -euo pipefail
case "${DEPLOY_ENV:-}" in production) expected=deploy-prod; other=deploy-stage;; staging) expected=deploy-stage; other=deploy-prod;; *) exit 10;; esac
[[ "${SSH_USER:-}" = "$expected" && -n "${SSH_TARGET_IP:-}" ]] || exit 10
umask 077
scratch=$(mktemp -d)
trap 'rm -f "$scratch/key" "$scratch/hosts" "$scratch/wrong" "$scratch/wrong.pub"; rmdir "$scratch"' EXIT
printf '%s\n' "$SSH_PRIVATE_KEY" > "$scratch/key"
printf '%s\n' "$SSH_KNOWN_HOSTS" > "$scratch/hosts"
opts=(-F /dev/null -p "$SSH_PORT" -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityAgent=none -o PreferredAuthentications=publickey -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$scratch/hosts" -o "HostKeyAlias=$SSH_HOST" -o ConnectTimeout=10)
identity=$(ssh "${opts[@]}" -i "$scratch/key" "$expected@$SSH_TARGET_IP" id -un 2>/dev/null) || { echo 'SSH authentication/host verification failed; check trusted host key and installed deploy key.' >&2; exit 10; }
[[ "$identity" = "$expected" ]] || { echo 'Wrong remote identity' >&2; exit 10; }
if ssh "${opts[@]}" -i "$scratch/key" "$other@$SSH_TARGET_IP" id -un >/dev/null 2>&1; then echo 'Isolation failed: Environment key accepted by other deploy account' >&2; exit 10; fi
ssh-keygen -q -t ed25519 -N '' -f "$scratch/wrong"
if ssh "${opts[@]}" -i "$scratch/wrong" "$expected@$SSH_TARGET_IP" id -un >/dev/null 2>&1; then echo 'Wrong-key negative test failed' >&2; exit 10; fi
echo "OpenSSH verified: id -un=$identity; other-account and wrong-key access denied. No remote writes performed."
