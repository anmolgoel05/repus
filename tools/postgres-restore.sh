#!/bin/bash
set -euo pipefail

backup_file=${1:?Usage: postgres-restore.sh /backups/repus-<timestamp>.dump.enc}
: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY is required}"
: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL to a newly-created empty database}"
if [ "${RESTORE_CONFIRM:-}" != 'RESTORE_TO_EMPTY_DATABASE' ]; then
  echo 'Set RESTORE_CONFIRM=RESTORE_TO_EMPTY_DATABASE after verifying the target is disposable and empty.' >&2
  exit 2
fi
if [ ! -f "$backup_file" ] || [ ! -f "$backup_file.hmac" ]; then
  echo 'Backup archive or authentication file is missing.' >&2
  exit 2
fi
if [ "${#BACKUP_ENCRYPTION_KEY}" -lt 32 ]; then
  echo 'BACKUP_ENCRYPTION_KEY must contain at least 32 characters.' >&2
  exit 2
fi

derive_key(){ printf '%s' "$1" | openssl dgst -sha256 -hmac "$BACKUP_ENCRYPTION_KEY" -binary | od -An -tx1 | tr -d ' \n'; }
ENC_KEY=$(derive_key 'repus-postgres-backup-encryption-v1')
MAC_KEY=$(derive_key 'repus-postgres-backup-authentication-v1')
expected=$(cat "$backup_file.hmac")
line=$(openssl dgst -sha256 -hmac "$MAC_KEY" "$backup_file")
actual=${line##*= }
if [ -z "$expected" ] || [ "$actual" != "$expected" ]; then
  echo 'Backup authentication failed; refusing to restore.' >&2
  exit 2
fi

# Refuse to merge an authenticated backup into a database that already contains application objects.
# pg_restore without --clean can otherwise leave a partially restored target on conflict.
object_count=$(psql --dbname="$RESTORE_DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  --command="SELECT (SELECT count(*) FROM pg_class AS c JOIN pg_namespace AS n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast' AND c.relkind IN ('r','p','v','m','S','f')) + (SELECT count(*) FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast') + (SELECT count(*) FROM pg_type AS t JOIN pg_namespace AS n ON n.oid=t.typnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast' AND t.typtype IN ('c','d','e','r') AND NOT EXISTS (SELECT 1 FROM pg_class AS c WHERE c.reltype=t.oid)) + (SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname !~ '^pg_') + (SELECT count(*) FROM pg_largeobject_metadata) + (SELECT count(*) FROM pg_extension WHERE extname <> 'plpgsql');")
object_count=${object_count//$'\r'/}
case "$object_count" in ''|*[!0-9]*) echo 'Could not verify that the restore database is empty; refusing to continue.' >&2; exit 2 ;; esac
if [ "$object_count" -ne 0 ]; then
  echo 'Restore target contains application objects; create a new empty database and retry.' >&2
  exit 2
fi

umask 077
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass "pass:$ENC_KEY" -in "$backup_file" \
  | pg_restore --exit-on-error --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL"
echo 'PostgreSQL backup restored successfully.'
