#!/bin/bash
set -euo pipefail
export LC_ALL=C

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY is required}"
BACKUP_DIR=${BACKUP_DIR:-/backups}
BACKUP_INTERVAL_SECONDS=${BACKUP_INTERVAL_SECONDS:-86400}
BACKUP_RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-30}
mode=${1:-loop}

case "$BACKUP_ENCRYPTION_KEY" in
  *[![:print:]]*|'') echo 'BACKUP_ENCRYPTION_KEY must be non-empty printable ASCII.' >&2; exit 2 ;;
esac
if [ "${#BACKUP_ENCRYPTION_KEY}" -lt 32 ]; then
  echo 'BACKUP_ENCRYPTION_KEY must contain at least 32 characters.' >&2
  exit 2
fi
case "$BACKUP_INTERVAL_SECONDS" in ''|*[!0-9]*) echo 'Backup interval must be a positive integer.' >&2; exit 2 ;; esac
case "$BACKUP_RETENTION_DAYS" in ''|*[!0-9]*) echo 'Backup retention must be a positive integer.' >&2; exit 2 ;; esac
if [ "$BACKUP_INTERVAL_SECONDS" -le 0 ] || [ "$BACKUP_INTERVAL_SECONDS" -gt 31536000 ] || [ "$BACKUP_RETENTION_DAYS" -le 0 ] || [ "$BACKUP_RETENTION_DAYS" -gt 3650 ]; then
  echo 'Backup interval must be at most one year and retention at most ten years.' >&2
  exit 2
fi
case "$mode" in loop|once) ;; *) echo 'Use mode loop or once.' >&2; exit 2 ;; esac

umask 077
mkdir -p "$BACKUP_DIR"
derive_key(){ printf '%s' "$1" | openssl dgst -sha256 -hmac "$BACKUP_ENCRYPTION_KEY" -binary | od -An -tx1 | tr -d ' \n'; }
ENC_KEY=$(derive_key 'repus-postgres-backup-encryption-v1')
MAC_KEY=$(derive_key 'repus-postgres-backup-authentication-v1')
encrypted_tmp=''
hmac_tmp=''
cleanup(){ for path in "$encrypted_tmp" "$hmac_tmp"; do [ -z "$path" ] || rm -f "$path"; done; }
write_hmac(){
  line=$(openssl dgst -sha256 -hmac "$MAC_KEY" "$1") || return 1
  digest=${line##*= }
  [ "$digest" != "$line" ] || return 1
  printf '%s\n' "$digest" >"$2"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

run_backup(){
  stamp=$(date -u '+%Y%m%dT%H%M%SZ')
  encrypted_tmp="$BACKUP_DIR/.repus-$stamp.dump.enc.tmp"
  hmac_tmp="$encrypted_tmp.hmac"

  if pg_dump --format=custom --no-owner --no-acl --dbname="$DATABASE_URL" \
    | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 600000 -pass "pass:$ENC_KEY" -out "$encrypted_tmp" \
    && write_hmac "$encrypted_tmp" "$hmac_tmp"; then
    chmod 600 "$encrypted_tmp" "$hmac_tmp"
    mv "$encrypted_tmp" "$BACKUP_DIR/repus-$stamp.dump.enc"
    mv "$hmac_tmp" "$BACKUP_DIR/repus-$stamp.dump.enc.hmac"
    find "$BACKUP_DIR" -type f -name 'repus-*.dump.enc' -mtime "+$BACKUP_RETENTION_DAYS" -exec sh -c 'rm -f "$1" "$1.hmac"' _ {} \;
    echo "Encrypted PostgreSQL backup completed: repus-$stamp.dump.enc"
    result=0
  else
    echo "PostgreSQL backup failed at $stamp; the previous backup was retained." >&2
    rm -f "$encrypted_tmp" "$hmac_tmp"
    result=1
  fi

  encrypted_tmp=''
  hmac_tmp=''
  return "$result"
}

if [ "$mode" = once ]; then
  run_backup
  exit $?
fi

while :; do
  run_backup || true
  sleep "$BACKUP_INTERVAL_SECONDS"
done
