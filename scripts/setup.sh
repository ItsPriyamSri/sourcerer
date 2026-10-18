#!/usr/bin/env bash
#
# One-shot developer setup.
#
# Verifies the toolchain, installs the workspace, prepares config, and pulls the
# open-weight model. Everything optional key-wise is left to the user; Sourcerer is
# designed to run end to end with zero API keys.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

say() { printf '\033[1;33m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[1;35m!\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# ── toolchain ───────────────────────────────────────────────────────────────
command -v node >/dev/null || die "Node 22.18+ is required."
node_major="$(node -p 'process.versions.node.split(".")[0]')"
node_minor="$(node -p 'process.versions.node.split(".")[1]')"
if [ "$node_major" -lt 22 ] || { [ "$node_major" -eq 22 ] && [ "$node_minor" -lt 18 ]; }; then
  die "Node 22.18+ required (found $(node -v)). local-first needs modern fetch + native .env."
fi
say "Node $(node -v)"

command -v pnpm >/dev/null || die "pnpm 10+ is required (this repo is pnpm-only). Try: corepack enable && corepack prepare pnpm@10 --activate"
say "pnpm $(pnpm -v)"

if ! command -v ollama >/dev/null; then
  warn "ollama is not on PATH. Install it from https://ollama.com/download, then re-run."
  warn "Sourcerer will still run: it falls back to on-device heuristics with no model."
fi

# ── config ──────────────────────────────────────────────────────────────────
if [ ! -f apps/brain/.env ]; then
  cp apps/brain/.env.example apps/brain/.env
  say "Wrote apps/brain/.env (all keys optional — fill in what you have)."
else
  say "apps/brain/.env already exists; leaving it alone."
fi

# ── deps ────────────────────────────────────────────────────────────────────
say "Installing workspace dependencies…"
pnpm install

# ── models ──────────────────────────────────────────────────────────────────
if command -v ollama >/dev/null; then
  if ! curl -sf --max-time 2 "${OLLAMA_BASE_URL:-http://127.0.0.1:11434}/api/version" >/dev/null; then
    say "Starting ollama serve in the background…"
    (ollama serve >/tmp/sourcerer-ollama.log 2>&1 &) || true
    sleep 3
  fi
  bash scripts/pull-model.sh || warn "Model pull failed — see the message above."
fi

# ── optional vector store ───────────────────────────────────────────────────
if [ -n "${DATABASE_URL:-}" ]; then
  say "DATABASE_URL is set — using it for vector memory."
elif command -v podman >/dev/null || command -v docker >/dev/null; then
  say "No DATABASE_URL. To add local pgvector for similar-item search: bash scripts/db-up.sh"
fi

cat <<'EOF'

  Ready. Two terminals:

    1) the brain     pnpm --filter @sourcerer/brain dev      → http://127.0.0.1:8787
    2) the app       pnpm --filter @sourcerer/web dev        → http://localhost:3000

  Optional, only if you want the partner tracks live — see docs/KEYS.md.

EOF
