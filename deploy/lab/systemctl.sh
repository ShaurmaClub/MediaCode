#!/usr/bin/env bash
# LAB ONLY: actual Node processes in the container; does not emulate systemd hardening.
set -euo pipefail
[[ -f /.dockerenv && -f /tmp/mediacode-lab-authorized ]] || exit 90
action="${1:-}"; shift || true
[[ "${1:-}" != --quiet ]] || shift
unit="${1:-}"; unit="${unit%.service}"
case "$action" in
  enable|daemon-reload|reload|list-unit-files|cat) exit 0;;
  is-active|status)
    [[ -s "/tmp/$unit.pid" ]] && kill -0 "$(cat "/tmp/$unit.pid")" 2>/dev/null; exit $?;;
  stop|restart|start) ;;
  *) exit 1;;
esac
case "$unit" in
  mediacode-prod|mediacode-stage) ;;
  nginx) [[ "$action" != start ]] || nginx; exit 0;;
  *) exit 0;;
esac
if [[ "$action" != start && -s "/tmp/$unit.pid" ]]; then
  kill -TERM "$(cat "/tmp/$unit.pid")" 2>/dev/null || true
  for _ in $(seq 1 50); do
    kill -0 "$(cat "/tmp/$unit.pid")" 2>/dev/null || break
    sleep .1
  done
  rm -f "/tmp/$unit.pid"
fi
[[ "$action" != stop ]] || exit 0
contour=production; [[ "$unit" != mediacode-stage ]] || contour=staging
code="${LAB_OPT_ROOT:-/opt/mediacode}/$contour/current"
state="${LAB_DATA_ROOT:-/var/lib/mediacode}/$contour"
[[ ! -f "$code/lab-restart-fail" ]] || exit 1
if [[ -f /tmp/mc-fail-restart-sha && "$(cat /tmp/mc-fail-restart-sha)" = "$(cat "$code/.release-sha")" ]]; then exit 1; fi
export LAB_CODE="$code" LAB_ENV_FILE="$state/.env" LAB_UNIT="$unit"
# runuser keeps runtime isolation; dotenv is parsed by Node, never sourced as shell.
nohup runuser -u "$unit" --preserve-environment -- node --input-type=module -e '
  import fs from "node:fs";
  import { createRequire } from "node:module";
  const require=createRequire(process.env.LAB_CODE + "/package.json");
  Object.assign(process.env, require("dotenv").parse(fs.readFileSync(process.env.LAB_ENV_FILE)));
  process.chdir(process.env.LAB_CODE);
  await import(process.env.LAB_CODE + "/server/index.js");
' >"/tmp/$unit.log" 2>&1 &
echo $! > "/tmp/$unit.pid"
sleep .3
