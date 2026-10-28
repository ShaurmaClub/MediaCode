#!/usr/bin/env bash
# Run on administrator workstation. Existing keys remain under their control.
set -euo pipefail
host='' port=22 prod_key='' stage_key='' hosts='' fingerprint='' mode=check
repo=ShaurmaClub/MediaCode
while (($#)); do
  case "$1" in
    --host) host="${2:?}"; shift 2;;
    --port) port="${2:?}"; shift 2;;
    --prod-key) prod_key="${2:?}"; shift 2;;
    --stage-key) stage_key="${2:?}"; shift 2;;
    --known-hosts) hosts="${2:?}"; shift 2;;
    --host-fingerprint) fingerprint="${2:?}"; shift 2;;
    --repo) repo="${2:?}"; shift 2;;
    --apply) mode=apply; shift;;
    --dry-run|--check) mode=check; shift;;
    --help) echo 'setup-github.sh --host HOST --prod-key FILE --stage-key FILE --known-hosts FILE --host-fingerprint SHA256:... [--apply]'; exit 0;;
    *) echo "Unknown argument: $1" >&2; exit 10;;
  esac
done
fail() { echo "GitHub setup blocked: $1" >&2; exit 10; }
[[ "$host" =~ ^[a-zA-Z0-9][a-zA-Z0-9.:-]*$ ]] || fail 'invalid --host'
[[ "$port" =~ ^[0-9]{1,5}$ ]] && ((10#$port > 0 && 10#$port < 65536)) || fail 'invalid --port'
[[ "$repo" =~ ^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$ ]] || fail 'invalid --repo'
[[ -f "$hosts" && -f "$prod_key" && -f "$stage_key" ]] || fail 'provide existing private keys and trusted known_hosts'
[[ "$fingerprint" =~ ^SHA256:[a-zA-Z0-9+/]+$ ]] || fail 'fingerprint from trusted server console required'
lookup="$host"; [[ "$port" = 22 ]] || lookup="[$host]:$port"
umask 077
scratch=$(mktemp -d)
trap 'rm -f "$scratch/hosts" "$scratch/selected"; rmdir "$scratch"' EXIT
ssh-keygen -F "$lookup" -f "$hosts" | sed '/^#/d' > "$scratch/selected"
[[ -s "$scratch/selected" ]] || fail 'host entry missing'
while IFS= read -r entry; do
  actual=$(printf '%s\n' "$entry" | ssh-keygen -lf - | awk '{print $2}')
  [[ "$actual" != "$fingerprint" ]] || printf '%s\n' "$entry" >> "$scratch/hosts"
done < "$scratch/selected"
[[ -s "$scratch/hosts" ]] || fail 'trusted fingerprint mismatch'
ssh-keygen -y -P '' -f "$prod_key" >/dev/null 2>&1 || fail 'production key invalid'
ssh-keygen -y -P '' -f "$stage_key" >/dev/null 2>&1 || fail 'staging key invalid'
[[ "$(ssh-keygen -y -f "$prod_key")" != "$(ssh-keygen -y -f "$stage_key")" ]] || fail 'use distinct keys for each contour'
for contour in production staging; do
  user=deploy-prod; key="$prod_key"
  [[ "$contour" != staging ]] || { user=deploy-stage; key="$stage_key"; }
  identity=$(ssh -i "$key" -p "$port" -o IdentitiesOnly=yes -o BatchMode=yes \
    -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$scratch/hosts" \
    -o ConnectTimeout=15 "$user@$host" id -un) || fail "$contour SSH rejected key; install public key on server first"
  [[ "$identity" = "$user" ]] || fail "$contour remote identity mismatch"
done
echo 'Both deployment keys accepted with verified host fingerprint.'
[[ "$mode" = apply ]] || { echo 'Check only: no GitHub changes. Runner connectivity still requires a CI probe.'; exit 0; }
gh auth status >/dev/null 2>&1 || fail 'run gh auth login on workstation'
# This helper NEVER enables CD. Create environments/protection rules in UI first.
gh variable set CD_STAGING_ENABLED --repo "$repo" --body false
gh variable set CD_PRODUCTION_ENABLED --repo "$repo" --body false
for contour in production staging; do
  user=deploy-prod; key="$prod_key"; service=mediacode-prod; domain=kaiton.ru
  [[ "$contour" != staging ]] || { user=deploy-stage; key="$stage_key"; service=mediacode-stage; domain=stage.kaiton.ru; }
  gh api "repos/$repo/environments/$contour" >/dev/null || fail "create protected $contour environment first"
  gh secret set SSH_HOST --repo "$repo" --env "$contour" --body "$host"
  gh secret set SSH_PORT --repo "$repo" --env "$contour" --body "$port"
  gh secret set SSH_USER --repo "$repo" --env "$contour" --body "$user"
  gh secret set SSH_PRIVATE_KEY --repo "$repo" --env "$contour" < "$key"
  gh secret set SSH_KNOWN_HOSTS --repo "$repo" --env "$contour" < "$scratch/hosts"
  gh secret set DEPLOY_PATH --repo "$repo" --env "$contour" --body "/opt/mediacode/$contour"
  gh secret set SERVICE_NAME --repo "$repo" --env "$contour" --body "$service"
  gh secret set HEALTHCHECK_URL --repo "$repo" --env "$contour" --body "https://$domain/api/health/ready"
done
echo 'GitHub configured after real SSH verification. Both CD switches remain false.'
