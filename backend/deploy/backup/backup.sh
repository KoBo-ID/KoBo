#!/usr/bin/env bash
# KoBo backups (spec section 12). Runs inside the kobo-backup image (postgres client tools + rclone + curl).
#
#   backup.sh daemon              nightly loop at BACKUP_HOUR_UTC (default 20:00 UTC = 03:00 WIB)
#   backup.sh daily               one daily backup now
#   backup.sh pre-deploy <tag>    one backup to pre-deploy/, no Healthchecks ping (used by deploy.sh)
#
# Every backup: pg_dump -Fc -> pg_restore --list -> restore into a temp DB in the same postgres
# -> compare row counts against the live DB -> drop the temp DB -> upload to R2.
# Env: PGHOST PGUSER PGPASSWORD PGDATABASE, R2_ENDPOINT, R2_BACKUP_BUCKET,
#      R2_BACKUP_ACCESS_KEY_ID, R2_BACKUP_SECRET_ACCESS_KEY, HEALTHCHECKS_URL (optional),
#      BACKUP_HOUR_UTC, DISK_FAIL_PCT.
set -Eeuo pipefail

: "${PGDATABASE:?}" "${R2_ENDPOINT:?}" "${R2_BACKUP_ACCESS_KEY_ID:?}" "${R2_BACKUP_SECRET_ACCESS_KEY:?}"
BUCKET="${R2_BACKUP_BUCKET:-kobo-backups}"
HC="${HEALTHCHECKS_URL:-}"
HC="${HC%/}"
DISK_FAIL_PCT="${DISK_FAIL_PCT:-85}"
CHECK_DB="kobo_restorecheck"
WORK="$(mktemp -d)"

export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_BACKUP_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_BACKUP_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT"
# The bucket-scoped token cannot create buckets; do not try.
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true

log() { printf '%s backup: %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }

ping_hc() { # ping_hc [/start|/fail] [message]
  [ -n "$HC" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "${2:-}" "$HC${1:-}" || log "healthchecks ping failed"
}

cleanup() {
  dropdb --if-exists "$CHECK_DB" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# "table|count" for every public table in database $1, one query.
counts() {
  psql -X -At -d "$1" -c "
    SELECT table_name || '|' ||
      (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY 1"
}

# The live DB may take writes while we dump, so a restored count is valid anywhere between the
# count taken just before the dump and the one taken just after.
compare_counts() { # before after restored
  local bad=0 t lo hi n
  declare -A B A
  while IFS='|' read -r t n; do B[$t]=$n; done < "$1"
  while IFS='|' read -r t n; do A[$t]=$n; done < "$2"
  if [ ! -s "$1" ] && [ ! -s "$3" ]; then log "source DB has no tables yet (first deploy?); skipping count comparison"; return 0; fi
  [ "$(wc -l < "$1")" -eq "$(wc -l < "$3")" ] || { log "table count differs: source $(wc -l < "$1"), restored $(wc -l < "$3")"; bad=1; }
  while IFS='|' read -r t n; do
    if [ -z "${B[$t]+x}" ]; then log "table $t missing in source"; bad=1; continue; fi
    lo=${B[$t]}; hi=${A[$t]:-${B[$t]}}
    if [ "$lo" -gt "$hi" ]; then local tmp=$lo; lo=$hi; hi=$tmp; fi
    if [ "$n" -lt "$lo" ] || [ "$n" -gt "$hi" ]; then
      log "row count mismatch in $t: restored $n, source $lo..$hi"; bad=1
    fi
  done < "$3"
  return "$bad"
}

# dump_verify_upload <r2 prefix> <file name>
dump_verify_upload() {
  local prefix="$1" name="$2" file="$WORK/$2"
  counts "$PGDATABASE" > "$WORK/before.txt"
  pg_dump -Fc --no-owner -f "$file" "$PGDATABASE"
  counts "$PGDATABASE" > "$WORK/after.txt"
  pg_restore --list "$file" > /dev/null

  # Restore check in the same postgres, in a throwaway database, as the same (superuser) role.
  dropdb --if-exists "$CHECK_DB"
  createdb "$CHECK_DB"
  pg_restore --no-owner --exit-on-error -d "$CHECK_DB" "$file"
  counts "$CHECK_DB" > "$WORK/restored.txt"
  compare_counts "$WORK/before.txt" "$WORK/after.txt" "$WORK/restored.txt"
  dropdb "$CHECK_DB"

  rclone copyto "$file" "r2:$BUCKET/$prefix/$name"
  [ "$(rclone size --json "r2:$BUCKET/$prefix/$name" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')" = "$(stat -c %s "$file")" ] \
    || { log "uploaded size mismatch for $prefix/$name"; return 1; }
  log "ok $prefix/$name ($(stat -c %s "$file") bytes, restore check passed)"
  if [ "$prefix" = "daily" ] && [ "$(date -u +%d)" = "01" ]; then
    rclone copyto "r2:$BUCKET/daily/$name" "r2:$BUCKET/monthly/$name"
    log "ok monthly/$name"
  fi
}

disk_check() {
  local pct
  pct="$(df --output=pcent / | tail -n 1 | tr -dc '0-9')"
  if [ -n "$pct" ] && [ "$pct" -ge "$DISK_FAIL_PCT" ]; then
    log "disk usage ${pct}% >= ${DISK_FAIL_PCT}%"
    ping_hc /fail "disk usage ${pct}% (threshold ${DISK_FAIL_PCT}%)"
    return 1
  fi
}

run_daily() {
  ping_hc /start
  local ts; ts="$(date -u +%Y%m%dT%H%M%SZ)"
  # Separate process: set -e is ignored inside an `if !` context, so the steps must not run in one.
  if ! "$0" _dump daily "kobo-$ts.dump" 2> >(tee "$WORK/err.txt" >&2); then
    ping_hc /fail "$(tail -c 800 "$WORK/err.txt" 2>/dev/null)"
    return 1
  fi
  disk_check || return 1
  ping_hc "" "ok"
}

case "${1:-}" in
  _dump)
    dump_verify_upload "$2" "$3"
    ;;
  daily)
    run_daily
    ;;
  pre-deploy)
    tag="${2:?usage: backup.sh pre-deploy <tag>}"
    dump_verify_upload pre-deploy "kobo-$tag-$(date -u +%Y%m%dT%H%M%SZ).dump"
    ;;
  daemon)
    trap 'exit 0' TERM INT
    log "daemon up; backing up daily at ${BACKUP_HOUR_UTC:-20}:00 UTC"
    while true; do
      now="$(date -u +%s)"
      target="$(date -u -d "today ${BACKUP_HOUR_UTC:-20}:00" +%s)"
      [ "$target" -gt "$now" ] || target=$((target + 86400))
      sleep "$((target - now))" & wait $!
      run_daily || log "daily backup FAILED"
    done
    ;;
  *)
    echo "usage: backup.sh daemon | daily | pre-deploy <tag>" >&2
    exit 64
    ;;
esac
