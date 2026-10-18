#!/usr/bin/env bash
#
# Pull the open-weight models Sourcerer needs.
#
# Gemma 3 is the brain. The 4B vision model identifies items from a photo; the 1B
# text model handles the cheap text-only paths (listing wording, keyword cleanup) so
# we are not loading 3 GB of vision weights to write a title.
#
# The third model is the odd one out: the sourcing advisor's tool loop needs a model
# that emits tool calls, and Gemma 3 does not (`completion, vision`, no `tools`).
# llama3.2:3b does, and — just as importantly — has no thinking mode. The first choice
# here was Qwen 3 4B, which calls tools correctly and spends roughly eight thousand
# tokens thinking about it first, turning a one-line question into a four-minute wait.
# A tool loop wants a model that follows a protocol, not one that deliberates about it.
#
# Usage:  bash scripts/pull-model.sh [--embed]
set -euo pipefail

OLLAMA_HOST="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
VISION_MODEL="${OLLAMA_MODEL:-gemma3:4b}"
TEXT_MODEL="${OLLAMA_TEXT_MODEL:-gemma3:1b}"
TOOL_MODEL="${OLLAMA_TOOL_MODEL:-llama3.2:3b}"
EMBED_MODEL="${OLLAMA_EMBED_MODEL:-nomic-embed-text}"

say() { printf '\033[1;33m▸\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

if ! curl -sf --max-time 3 "$OLLAMA_HOST/api/version" >/dev/null; then
  die "No Ollama server at $OLLAMA_HOST. Start it with: ollama serve"
fi

version="$(curl -s "$OLLAMA_HOST/api/version" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
say "Ollama $version at $OLLAMA_HOST"

# Gemma 3 requires a reasonably recent Ollama. Fail loudly rather than mysteriously.
major="${version%%.*}"
if [ "${major:-0}" -lt 1 ] && [ "${version%%%.*}" = "0" ]; then
  minor="$(echo "$version" | cut -d. -f2)"
  if [ "${minor:-0}" -lt 30 ]; then
    die "Ollama $version is too old for Gemma 3. Upgrade to 0.30+ (0.40+ recommended)."
  fi
fi

pull() {
  local model="$1"
  say "Pulling $model …"
  curl -s -X POST "$OLLAMA_HOST/api/pull" \
    -H 'content-type: application/json' \
    -d "{\"model\":\"$model\",\"stream\":true}" |
    while IFS= read -r line; do
      status="$(printf '%s' "$line" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')"
      [ -n "$status" ] && printf '\r    %-40s' "$status"
    done
  printf '\r    %-40s\n' "$model ready"
}

pull "$VISION_MODEL"
pull "$TEXT_MODEL"
pull "$TOOL_MODEL"

if [ "${1:-}" = "--embed" ]; then
  pull "$EMBED_MODEL"
fi

say "Done. Models on disk:"
curl -s "$OLLAMA_HOST/api/tags" | tr ',' '\n' | sed -n 's/.*"name":"\([^"]*\)".*/    \1/p'
