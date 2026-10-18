#!/usr/bin/env bash
#
# Local pgvector, for the "have I bought this before?" search.
#
# Tiger Data's free tier is the production answer (pgvector + pgvectorscale, already
# installed, one connection string). This is the offline/self-hosted answer for anyone
# who would rather not hand over a database at all — which is a perfectly good stance
# for a tool whose whole pitch is "your data stays with you".
set -euo pipefail

NAME="${PGVECTOR_CONTAINER:-sourcerer-pgvector}"
PORT="${PGVECTOR_PORT:-5433}"
PASSWORD="${PGVECTOR_PASSWORD:-sourcerer}"
IMAGE="pgvector/pgvector:pg16"

say() { printf '\033[1;33m▸\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

if command -v podman >/dev/null; then RUNTIME=podman
elif command -v docker >/dev/null; then RUNTIME=docker
else die "No podman or docker found."; fi

if "$RUNTIME" ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  say "Starting existing container $NAME…"
  "$RUNTIME" start "$NAME" >/dev/null
else
  say "Creating $NAME from $IMAGE…"
  "$RUNTIME" run -d --name "$NAME" \
    -e POSTGRES_PASSWORD="$PASSWORD" \
    -e POSTGRES_DB=sourcerer \
    -p "$PORT:5432" \
    "$IMAGE" >/dev/null
  say "Waiting for postgres…"
  for _ in $(seq 1 30); do
    if "$RUNTIME" exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; then break; fi
    sleep 1
  done
  "$RUNTIME" exec "$NAME" psql -U postgres -d sourcerer -c 'CREATE EXTENSION IF NOT EXISTS vector;' >/dev/null
fi

cat <<EOF

  pgvector is up.

  Put this in apps/brain/.env:

    DATABASE_URL=postgresql://postgres:${PASSWORD}@127.0.0.1:${PORT}/sourcerer

  Then restart the brain. "Have I bought this?" search goes live.

EOF
