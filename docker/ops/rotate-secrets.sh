#!/usr/bin/env bash
# Rotate MYSQL_PASSWORD, MYSQL_ROOT_PASSWORD, GRAFANA_ADMIN_PASSWORD on the running stack.
# Default = dry-run (prints plan, changes nothing). Pass --apply to execute.
# Usage (repo root): docker/ops/rotate-secrets.sh [--apply] [path-to-.env]
# Never prints passwords. See docker/ops/RUNBOOK.md.
set -eu
export MSYS_NO_PATHCONV=1   # git-bash must not mangle container paths

APPLY=0
ENVF=./.env
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    -*) echo "unknown flag: $a" >&2; exit 2 ;;
    *) ENVF="$a" ;;
  esac
done
cd "$(dirname "$0")/../.."   # repo root (docker-compose.yml lives here)
[ "$ENVF" = ./.env ] || ENVF="$(cd "$(dirname "$ENVF")" && pwd)/$(basename "$ENVF")"

MYSQL_C=bmonitor-mysql
GRAFANA_C=bmonitor-grafana
CR=$(printf '\r')
KEYS="MYSQL_PASSWORD MYSQL_ROOT_PASSWORD GRAFANA_ADMIN_PASSWORD"
BACKUP=""
STARTED=0

envget() { grep -E "^$1=" "$ENVF" | tail -n1 | cut -d= -f2- | tr -d '\r' || true; }
genpw() {
  local p
  p=$(openssl rand -base64 96 | tr -dc 'A-Za-z0-9' | head -c 32)
  [ "${#p}" -eq 32 ] || { echo "password generation failed" >&2; exit 1; }
  printf '%s' "$p"
}
# root_sql: stdin = SQL. Root password from .env is fed via stdin, never argv
# (container env goes stale after a rotation, so it is not used here).
root_sql() {
  { printf '%s\n' "$OLD_ROOT_PW"; cat; } | docker exec -i "$MYSQL_C" sh -c 'read -r MYSQL_PWD; export MYSQL_PWD; mysql -uroot -N -B'
}
# mysql_as <user> <password>: login check, password via stdin, never argv
mysql_as() {
  printf '%s\n' "$2" | docker exec -i "$MYSQL_C" sh -c \
    'read -r MYSQL_PWD; export MYSQL_PWD; mysql -u"$0" -N -B -e "SELECT 1"' "$1" >/dev/null 2>&1
}
# http_code <user|""> <password> <url>: credentials via curl config on stdin, never argv
http_code() {
  if [ -n "$1" ]; then printf 'user = "%s:%s"\n' "$1" "$2" | curl -s -o /dev/null -w '%{http_code}' -K - "$3" || true
  else curl -s -o /dev/null -w '%{http_code}' "$3" || true; fi
}
wait_code() { # <expected> <user> <pw> <url>
  local i c
  for i in $(seq 1 30); do
    c=$(http_code "$2" "$3" "$4")
    [ "$c" = "$1" ] && return 0
    sleep 2
  done
  return 1
}
rollback_hint() {
  cat >&2 <<EOF

ROLLBACK (old values are in the backup, nothing printed here):
  1. cp "$BACKUP" "$ENVF"
  2. Re-ALTER MySQL users and reset Grafana admin with the old values from that file
     (commands: docker/ops/RUNBOOK.md, section Rollback).
  3. docker compose up -d --no-deps --force-recreate backend grafana
EOF
}
trap 'rc=$?; if [ "$rc" -ne 0 ] && [ "$STARTED" -eq 1 ]; then echo "FAILED (exit $rc) after changes began." >&2; rollback_hint; fi' EXIT

# 1. preflight
[ -f "$ENVF" ] || { echo "preflight: $ENVF not found" >&2; exit 1; }
for c in "$MYSQL_C" "$GRAFANA_C"; do
  [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null || true)" = true ] \
    || { echo "preflight: container $c not running" >&2; exit 1; }
done
MYSQL_USER=$(envget MYSQL_USER)
GF_USER=$(envget GRAFANA_ADMIN_USER)
OLD_USER_PW=$(envget MYSQL_PASSWORD)
OLD_ROOT_PW=$(envget MYSQL_ROOT_PASSWORD)
OLD_GF_PW=$(envget GRAFANA_ADMIN_PASSWORD)
case "$MYSQL_USER" in ''|*[!A-Za-z0-9_]*) echo "preflight: MYSQL_USER missing or not [A-Za-z0-9_]" >&2; exit 1 ;; esac
[ -n "$GF_USER" ] || { echo "preflight: GRAFANA_ADMIN_USER missing" >&2; exit 1; }
for k in $KEYS; do grep -qE "^$k=" "$ENVF" || echo "note: $k not in $ENVF, will be appended"; done
[ "$(printf 'SELECT 1' | root_sql 2>/dev/null | tr -d '\r')" = 1 ] \
  || { echo "preflight: cannot log in to MySQL as root with the .env root password" >&2; exit 1; }
ACCOUNTS=$(printf "SELECT user, host FROM mysql.user WHERE (user='%s' AND host='%%') OR (user='root' AND host IN ('localhost','%%'));" "$MYSQL_USER" \
  | root_sql | tr -d '\r')
[ -n "$ACCOUNTS" ] || { echo "preflight: no matching MySQL accounts" >&2; exit 1; }

if [ "$APPLY" -ne 1 ]; then
  echo "DRY-RUN (no changes). Plan:"
  echo "  1. back up $ENVF to \$HOME/.bmonitor-backup/env-<UTC ts> (mode 600)"
  echo "  2. generate 3 random 32-char alnum passwords"
  echo "  3. ALTER USER for (user host):"
  printf '%s\n' "$ACCOUNTS" | sed 's/^/       /'
  echo "  4. grafana cli admin reset-admin-password (user-id 1) in $GRAFANA_C"
  echo "  5. rewrite only: $KEYS in $ENVF"
  echo "  6. docker compose up -d --no-deps --force-recreate backend grafana"
  echo "  7. verify /api/health, MySQL new ok / old rejected, Grafana new 200 / old 401"
  echo "Re-run with --apply to execute."
  exit 0
fi

# 2. backup (outside repo)
umask 077
mkdir -p "$HOME/.bmonitor-backup"
BACKUP="$HOME/.bmonitor-backup/env-$(date -u +%Y%m%dT%H%M%SZ)"
cp "$ENVF" "$BACKUP"; chmod 600 "$BACKUP"
echo "backup: $BACKUP"
STARTED=1

# 3. generate
NEW_USER_PW=$(genpw); NEW_ROOT_PW=$(genpw); NEW_GF_PW=$(genpw)

# 4. MySQL: app user first, root last (root session is the one doing the ALTERs)
SQL=""
while IFS=$'\t' read -r u h; do
  [ "$u" = root ] && continue
  SQL="$SQL ALTER USER '$u'@'$h' IDENTIFIED BY '$NEW_USER_PW';"
done <<EOF
$ACCOUNTS
EOF
while IFS=$'\t' read -r u h; do
  [ "$u" = root ] || continue
  SQL="$SQL ALTER USER 'root'@'$h' IDENTIFIED BY '$NEW_ROOT_PW';"
done <<EOF
$ACCOUNTS
EOF
printf '%s\n' "$SQL" | root_sql
echo "mysql: passwords altered"

# 5. Grafana (GF_SECURITY_ADMIN_PASSWORD only applies on first init)
printf '%s\n' "$NEW_GF_PW" | docker exec -i "$GRAFANA_C" grafana cli admin reset-admin-password --password-from-stdin >/dev/null
echo "grafana: admin password reset"

# 6. .env: replace only the 3 keys, keep other lines and CRLF
tmp=$(mktemp)
rewrite() { # <key> <value>
  if grep -qE "^$1=" "$ENVF"; then sed "s|^$1=[^$CR]*|$1=$2|" "$ENVF" > "$tmp"
  else { cat "$ENVF"; printf '%s=%s\n' "$1" "$2"; } > "$tmp"; fi
  cat "$tmp" > "$ENVF"
}
rewrite MYSQL_PASSWORD "$NEW_USER_PW"
rewrite MYSQL_ROOT_PASSWORD "$NEW_ROOT_PW"
rewrite GRAFANA_ADMIN_PASSWORD "$NEW_GF_PW"
rm -f "$tmp"
echo "env: updated"

# 7. recreate consumers so env_file / provisioning env are re-read
docker compose up -d --no-deps --force-recreate backend grafana

# 8. verify
wait_code 200 "" "" http://127.0.0.1:3001/api/health || { echo "verify: /api/health not 200" >&2; exit 1; }
mysql_as "$MYSQL_USER" "$NEW_USER_PW" || { echo "verify: new app-user password rejected" >&2; exit 1; }
mysql_as root "$NEW_ROOT_PW" || { echo "verify: new root password rejected" >&2; exit 1; }
if mysql_as "$MYSQL_USER" "$OLD_USER_PW"; then echo "verify: OLD app-user password still works" >&2; exit 1; fi
wait_code 200 "$GF_USER" "$NEW_GF_PW" http://127.0.0.1:3000/grafana/api/user || { echo "verify: Grafana new password not 200" >&2; exit 1; }
[ "$(http_code "$GF_USER" "$OLD_GF_PW" http://127.0.0.1:3000/grafana/api/user)" = 401 ] || { echo "verify: Grafana old password not 401" >&2; exit 1; }
echo "verify: all checks passed"
echo "Backup kept at $BACKUP (contains OLD secrets; delete after confirming)."
echo "Rotated: $KEYS"
