#!/usr/bin/env bash
# KoBo deploy (spec section 12). The ONLY command the CI SSH key may run:
#   authorized_keys:  command="/opt/kobo/backend/deploy/deploy.sh",no-pty,no-port-forwarding,... ssh-ed25519 AAAA...
# Tag comes from $SSH_ORIGINAL_COMMAND (CI sends only the tag) or $1 (manual: ./backend/deploy/deploy.sh v0.1.1).
#
# flock -> validate tag -> pull -> pre-deploy pg_dump to R2 -> prisma migrate deploy -> up api
#   -> poll health 60 s -> on failure: re-up previous tag, exit 1 -> persist tag + prune images
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$ROOT"
mkdir -p state
IMAGE_REPO="ghcr.io/kobo-id/kobo"
HEALTH_TIMEOUT=60
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env)

log() { printf '%s deploy: %s\n' "$(date -u +%FT%TZ)" "$*"; }

# Single deploy at a time (CI retries, a human running rollback, etc.).
exec 9> state/deploy.lock
flock -n 9 || { log "another deploy is running"; exit 1; }
exec > >(tee -a state/deploy.log) 2>&1

TAG="${SSH_ORIGINAL_COMMAND:-${1:-}}"
if [[ ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  log "invalid tag '${TAG}' (expected vX.Y.Z)"
  exit 2
fi
[ -f .env ] || { log ".env missing in $ROOT"; exit 2; }

PREV="$(cat state/tag 2>/dev/null || true)"
log "deploying $TAG (current: ${PREV:-none})"

# Block until api reports healthy, or fail after $HEALTH_TIMEOUT seconds.
wait_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) cid status
  while [ "$SECONDS" -lt "$deadline" ]; do
    cid="$("${COMPOSE[@]}" ps -q api 2>/dev/null || true)"
    if [ -n "$cid" ]; then
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo none)"
      [ "$status" = "healthy" ] && return 0
    fi
    sleep 2
  done
  return 1
}

log "pulling $IMAGE_REPO:$TAG"
docker pull "$IMAGE_REPO:$TAG"

export KOBO_TAG="$TAG"
"${COMPOSE[@]}" build backup
"${COMPOSE[@]}" up -d --wait postgres

log "pre-deploy dump -> R2 pre-deploy/ (aborts the deploy if it fails)"
"${COMPOSE[@]}" run --rm -T --no-deps backup /backup/backup.sh pre-deploy "$TAG"

log "prisma migrate deploy (one-off container, image $TAG)"
if ! "${COMPOSE[@]}" run --rm -T --no-deps api npx prisma migrate deploy; then
  log "MIGRATION FAILED; running api (${PREV:-none}) was not touched. Fix forward and tag a new release."
  exit 1
fi

log "starting stack with KOBO_TAG=$TAG"
"${COMPOSE[@]}" up -d --remove-orphans

if wait_healthy; then
  log "api healthy on $TAG"
else
  log "api NOT healthy within ${HEALTH_TIMEOUT}s on $TAG; last logs:"
  "${COMPOSE[@]}" logs --tail 40 api || true
  if [ -n "$PREV" ] && [ "$PREV" != "$TAG" ]; then
    log "rolling back to $PREV (note: the DB already has $TAG's migrations; old code runs on the new schema)"
    export KOBO_TAG="$PREV"
    "${COMPOSE[@]}" up -d --no-deps api
    if wait_healthy; then log "rollback to $PREV healthy"; else log "ROLLBACK ALSO UNHEALTHY; restore from pre-deploy dump per RUNBOOK"; fi
  else
    log "no previous tag to roll back to; stopping api"
    "${COMPOSE[@]}" stop api || true
  fi
  exit 1
fi

# Success: persist state, then prune.
if [ -n "$PREV" ] && [ "$PREV" != "$TAG" ]; then echo "$PREV" > state/prev; fi
echo "$TAG" > state/tag.tmp && mv state/tag.tmp state/tag

# Keep the previous release's image for fast rollback: a stopped container referencing it
# stops `image prune -a` from removing it, however old the image is.
docker rm -f kobo-prev-keep >/dev/null 2>&1 || true
if [ -n "$PREV" ] && [ "$PREV" != "$TAG" ] && docker image inspect "$IMAGE_REPO:$PREV" >/dev/null 2>&1; then
  docker create --name kobo-prev-keep --label kobo.keep=previous "$IMAGE_REPO:$PREV" true >/dev/null
fi
docker image prune -af --filter until=168h
log "done: $TAG live"
