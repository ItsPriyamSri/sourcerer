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
# Fully qualified on purpose: podman refuses a short name like `pgvector/pgvector:pg16`
# without a TTY ("short-name resolution enforced but cannot prompt without a TTY"), so
# the unqualified form fails in any script, CI job or non-interactive shell.
IMAGE="docker.io/pgvector/pgvector:pg16"

say() { printf '\033[1;33m▸\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

if command -v podman >/dev/null; then RUNTIME=podman
elif command -v docker >/dev/null; then RUNTIME=docker
else die "No podman or docker found."; fi

# On a first run postgres runs its init phase, shuts down, then starts for real. So
# `pg_isready` reports success during the init window and the next command lands mid
# shutdown ("FATAL: the database system is shutting down"). Poll the exact operation we
# actually need instead of a readiness probe that lies for a few seconds.
ensure_vector() {
  say "Waiting for postgres to accept a query…"
  for _ in $(seq 1 60); do
    if "$RUNTIME" exec "$NAME" psql -U postgres -d sourcerer -tAc 'CREATE EXTENSION IF NOT EXISTS vector;' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  die "Postgres in $NAME never accepted a query after 60s."
}

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
fi

ensure_vector

cat <<EOF

  pgvector is up.

  Put this in apps/brain/.env:

    DATABASE_URL=postgresql://postgres:${PASSWORD}@127.0.0.1:${PORT}/sourcerer

  Then restart the brain. "Have I bought this?" search goes live.

EOF
