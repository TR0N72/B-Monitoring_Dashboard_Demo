# Runbook: rotate default MySQL + Grafana passwords (audit #3)

Run by the user on the live stack. Agents never execute this.

## When
- `docker/ops/check-env.sh` reports FAIL, or `.env` still holds `change-me` / `bmonitor_pass` / `admin` / `password`.
- A secret may have leaked.

## Why a script, not just editing `.env`
- `MYSQL_*` in compose only applies on first init of the `mysql_data` volume. Editing `.env` later does not change the DB users.
- `GRAFANA_ADMIN_PASSWORD` is also first-init only; it needs `grafana cli admin reset-admin-password`.
- Out of scope: MQTT password (`docker/mosquitto/passwd`), `JWT_SECRET`.

## Prerequisites
- Repo root, git-bash or Linux, `docker`, `docker compose`, `openssl`, `curl`.
- Containers `bmonitor-mysql` and `bmonitor-grafana` running.
- `.env` current root password works (script checks this).
- Expect a short backend/Grafana restart (a few seconds).

## Steps
```
bash docker/ops/check-env.sh                      # shows which keys are weak (no values printed)
bash docker/ops/rotate-secrets.sh                 # dry-run: prints plan, changes nothing
bash docker/ops/rotate-secrets.sh --apply         # does it
bash docker/ops/check-env.sh                      # must exit 0 now
```
Optional second arg: path to another env file (default `./.env`).

## Expected output (--apply)
```
backup: $HOME/.bmonitor-backup/env-<UTC ts>
mysql: passwords altered
grafana: admin password reset
env: updated
... docker compose recreate output ...
verify: all checks passed
Rotated: MYSQL_PASSWORD MYSQL_ROOT_PASSWORD GRAFANA_ADMIN_PASSWORD
```
No password is ever printed. New passwords: 32 chars alnum, read them from `.env`.

## Verification (script does these; manual repeat)
- `curl http://127.0.0.1:3001/api/health` returns 200.
- Grafana login at `http://localhost:8080/grafana/` with the new password from `.env`; old one gives 401.
- MySQL: old app-user password is rejected.

## Rollback
The backup (`$HOME/.bmonitor-backup/env-<ts>`, mode 600) holds the OLD values. If the script fails after "backup:", it prints this hint.
```
cp "$HOME/.bmonitor-backup/env-<ts>" .env
# MySQL: re-set app user and root to the OLD values. Use the NEW root password from the failed run's .env,
# or, if .env was not yet rewritten, the old one. Type the SQL, do not paste secrets into shell history:
docker exec -it bmonitor-mysql mysql -uroot -p
#   ALTER USER '<MYSQL_USER>'@'%' IDENTIFIED BY '<old>';
#   ALTER USER 'root'@'localhost' IDENTIFIED BY '<old root>';
#   ALTER USER 'root'@'%' IDENTIFIED BY '<old root>';   -- only if it exists
# Grafana:
printf '%s\n' '<old>' | docker exec -i bmonitor-grafana grafana cli admin reset-admin-password --password-from-stdin
docker compose up -d --no-deps --force-recreate backend grafana
```
Delete the backup after confirming everything works (it contains old secrets).

## Notes
- Compose now refuses to start if `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, or `GRAFANA_ADMIN_PASSWORD` is unset/empty (`set in .env`).
- Follow-up (backend, not this card): `backend/src/config/db.js` still has fallback password `bmonitor_pass`.

# Migration for audit #7 on the live DB
Nothing to run by hand: backend startup creates `emergency_state` (same DDL as `docker/mysql/migrations/001_emergency_state.sql`).
Manual alternative: `docker exec -i bmonitor-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < docker/mysql/migrations/001_emergency_state.sql`
