#!/usr/bin/env bash
# Fail (exit 1) if MYSQL_PASSWORD / MYSQL_ROOT_PASSWORD / GRAFANA_ADMIN_PASSWORD are weak.
# Usage: docker/ops/check-env.sh [path-to-.env]   (default ./.env). Never prints values.
set -u
f="${1:-./.env}"
[ -f "$f" ] || { echo "check-env: $f not found" >&2; exit 2; }

bad=0
for k in MYSQL_PASSWORD MYSQL_ROOT_PASSWORD GRAFANA_ADMIN_PASSWORD; do
  # last assignment wins (same as compose); strip CR and one pair of quotes
  v=$(grep -E "^${k}=" "$f" | tail -n1 | cut -d= -f2- | tr -d '\r')
  v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
  if [ -z "$v" ]; then echo "FAIL $k: empty or missing"; bad=1
  elif [ "${#v}" -lt 12 ]; then echo "FAIL $k: shorter than 12 chars"; bad=1
  else
    case "$v" in
      change-me|bmonitor_pass|admin|password) echo "FAIL $k: default/known value"; bad=1 ;;
      *) echo "ok   $k" ;;
    esac
  fi
done
[ "$bad" -eq 0 ] || echo "Weak secrets found. Run: docker/ops/rotate-secrets.sh --apply (see docker/ops/RUNBOOK.md)"
exit "$bad"
