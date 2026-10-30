#!/usr/bin/env bash
# Sourced only by administrator-run provisioning/installer; no data/content reads.
prepare_code_membership() {
  local runtime="$1" deploy="$2" code="mediacode-code-${1#mediacode-}"
  getent group "$code" >/dev/null || groupadd --system "$code"
  usermod -a -G "$code" "$runtime"
  usermod -a -G "$code" "$deploy"
  # Remove only this obsolete supplementary group, not unrelated primary groups.
  if id -nG "$deploy" | tr ' ' '\n' | grep -qxF "$runtime"; then
    gpasswd -d "$deploy" "$runtime" >/dev/null
  fi
}

prepare_code_directory() {
  local dir="$1" deploy="$2" runtime="$3" code="mediacode-code-${3#mediacode-}" group
  group="$code"
  [[ ! -L "$dir" ]] || { echo 'Code root symlink rejected' >&2; return 10; }
  if [[ -e "$dir" ]]; then
    # Do not invalidate supplementary groups cached in an already running runtime.
    # Legacy parents/releases keep runtime group; new releases use code-only group.
    group=$(stat -c '%G' "$dir")
    [[ "$(stat -c '%U' "$dir")" = "$deploy" && ( "$group" = "$runtime" || "$group" = "$code" ) ]] || return 10
    audit_access_acl "$dir" || return 10
  fi
  install -d -m 750 -o "$deploy" -g "$group" "$dir" || return 10
  audit_access_acl "$dir" || return 10
}

audit_access_acl() {
  local acl
  acl=$(getfacl -cp -- "$1") || return 10
  if grep -Eq '^(default:|user:[^:]|group:[^:])' <<< "$acl"; then
    echo 'Extended/default ACL requires manual review' >&2; return 10
  fi
}

audit_private_acl() {
  local root="$1" file
  [[ ! -L "$root" ]] || { echo 'Data root symlink rejected' >&2; return 10; }
  [[ ! -e "$root" ]] || {
    for file in "$root" "$root/.env" "$root/data" "$root/data/media.db" "$root/data/media.db-wal" "$root/data/media.db-shm" "$root/uploads" "$root/backups"; do
      [[ ! -L "$file" ]] || return 10
      [[ ! -e "$file" ]] || {
        # Named/default ACLs require explicit administrator review, not blind chmod.
        audit_access_acl "$file" || return 10
      }
    done
  }
  return 0
}
