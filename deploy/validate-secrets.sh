#!/usr/bin/env bash
# Validate without printing secret values. Also prevents shell injection in SSH command.
set -euo pipefail
fail() { echo "Deployment configuration invalid: $1" >&2; exit 10; }
for name in SSH_HOST SSH_USER SSH_PORT SSH_PRIVATE_KEY SSH_KNOWN_HOSTS DEPLOY_PATH SERVICE_NAME; do
  [[ -n "${!name:-}" ]] || fail "missing $name"
done
[[ "$SSH_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.:-]*$ ]] || fail 'SSH_HOST'
[[ "$SSH_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || fail 'SSH_USER'
if [[ "${REQUIRE_TAILSCALE:-0}" = 1 ]]; then
  [[ -n "${TS_OAUTH_CLIENT_ID:-}" && -n "${TS_AUDIENCE:-}" ]] || fail 'missing TS_OAUTH_CLIENT_ID or TS_AUDIENCE'
  case "${DEPLOY_ENV:-}" in
    production) [[ "$SSH_USER" = deploy-prod && "$DEPLOY_PATH" = /opt/mediacode/production && "${SERVICE_NAME%.service}" = mediacode-prod ]] || fail 'production account/path/service mismatch';;
    staging) [[ "$SSH_USER" = deploy-stage && "$DEPLOY_PATH" = /opt/mediacode/staging && "${SERVICE_NAME%.service}" = mediacode-stage ]] || fail 'staging account/path/service mismatch';;
    *) fail 'DEPLOY_ENV';;
  esac
  SSH_HOST="$SSH_HOST" node "$(dirname "$0")/tailnet-check.mjs" --validate-host
fi
[[ "$SSH_PORT" =~ ^[0-9]{1,5}$ ]] && ((10#$SSH_PORT > 0 && 10#$SSH_PORT < 65536)) || fail 'SSH_PORT'
[[ "$DEPLOY_PATH" =~ ^/[a-zA-Z0-9_/-]+$ && "$DEPLOY_PATH" != *..* ]] || fail 'DEPLOY_PATH'
[[ "$SERVICE_NAME" =~ ^mediacode-(prod|stage)(\.service)?$ ]] || fail 'SERVICE_NAME'
[[ -z "${EXTERNAL_HEALTH_URL:-}" || "$EXTERNAL_HEALTH_URL" =~ ^https://[a-zA-Z0-9./:_-]+$ ]] || fail 'HEALTHCHECK_URL'
umask 077
scratch=$(mktemp -d)
trap 'rm -f "$scratch/key" "$scratch/hosts"; rmdir "$scratch"' EXIT
printf '%s\n' "$SSH_PRIVATE_KEY" > "$scratch/key"
printf '%s\n' "$SSH_KNOWN_HOSTS" > "$scratch/hosts"
ssh-keygen -y -P '' -f "$scratch/key" >/dev/null 2>&1 || fail 'SSH_PRIVATE_KEY must be a valid unencrypted deployment key'
[[ "$(ssh-keygen -y -P '' -f "$scratch/key" 2>/dev/null)" = ssh-ed25519\ * ]] || fail 'SSH_PRIVATE_KEY must use Ed25519'
ssh-keygen -lf "$scratch/hosts" >/dev/null 2>&1 || fail 'SSH_KNOWN_HOSTS'
host="$SSH_HOST"
[[ "$SSH_PORT" = 22 ]] || host="[$SSH_HOST]:$SSH_PORT"
ssh-keygen -F "$host" -f "$scratch/hosts" >/dev/null || fail 'SSH_KNOWN_HOSTS has no entry for SSH_HOST/SSH_PORT'
echo 'Deployment configuration validated (values suppressed).'
