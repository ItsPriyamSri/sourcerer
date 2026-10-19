#!/usr/bin/env bash
#
# Add optional partner keys to apps/brain/.env, one at a time.
#
# Sourcerer needs none of them. This asks only for the six values that actually
# require a human, says what each one buys and where it comes from, and edits
# .env in place: every unrelated line and comment is preserved byte for byte and
# the previous file is kept as apps/brain/.env.bak. Secrets are read from the
# terminal, never from the command line, and echoed back at most four characters
# deep.
#
# Re-running is safe: it rewrites only the exact `VAR=` lines it was told about,
# so keys never duplicate.
#
# Usage:  pnpm keys:setup
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

env_file="apps/brain/.env"
example_file="apps/brain/.env.example"

say() { printf '\033[1;33m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[1;35m!\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[ -f "$example_file" ] || die "Missing $example_file — run this from the Sourcerer repo root."

if [ ! -f "$env_file" ]; then
  cp "$example_file" "$env_file"
  say "Created $env_file from $example_file."
fi

# Show at most the first four characters of a value, never the whole thing.
redact() {
  local s="$1"
  if [ "${#s}" -le 4 ]; then printf '…'; else printf '%s…' "${s:0:4}"; fi
}

# The current value of VAR in $env_file (everything after the first '='), or empty.
current_value() {
  grep -m1 "^$1=" "$env_file" 2>/dev/null | cut -d= -f2- || true
}

vars=()
vals=()

ask() {
  local var="$1" unlocks="$2" url="$3"
  local existing
  existing="$(current_value "$var")"

  printf '\n  \033[1m%s\033[0m — %s\n' "$var" "$unlocks"
  printf '  Get it:  %s\n' "$url"
  if [ -n "$existing" ]; then
    printf '  Current: %s\n' "$(redact "$existing")"
  fi
  printf '  Paste the value (Enter to skip): '

  # -s: do not echo the secret to the terminal. -r: keep backslashes literal.
  local value=""
  IFS= read -rs value || true
  printf '\n'

  if [ -z "$value" ]; then
    if [ -n "$existing" ]; then
      say "kept the existing $var."
    else
      say "skipped $var."
    fi
    return 0
  fi

  vars+=("$var")
  vals+=("$value")
  say "set $var = $(redact "$value")"
}

printf '\n  Sourcerer keys setup — every key is optional.\n'
printf '  Press Enter to skip any of them; you can re-run this at any time.\n'

ask SERPAPI_API_KEY \
  "live eBay comps instead of only your own sold history" \
  "https://serpapi.com/manage-api-key"

ask BACKBOARD_API_KEY \
  "the same agent against open-weight models with no GPU (hosted demo)" \
  "https://app.backboard.io"

ask TABPFN_TOKEN \
  "a price + days-to-sell model fitted on your own sold history" \
  "https://platform.priorlabs.ai/account/api-keys"

ask DATABASE_URL \
  'vector memory — "have I bought this before?" and similar-item search' \
  "https://console.cloud.timescale.com/ (free tier)  —  or, locally: bash scripts/db-up.sh"

ask ELEVENLABS_API_KEY \
  "dictate an item hands-free and hear the verdict read back" \
  "https://elevenlabs.io/app/settings/api-keys"

ask SENTRY_DSN \
  "agent tracing — one span per model call, with tokens and latency" \
  "https://sentry.io"

if [ "${#vars[@]}" -eq 0 ]; then
  printf '\n'
  say "Nothing entered; $env_file is unchanged."
  printf '\n  Next:  pnpm keys:check\n\n'
  exit 0
fi

# ── write ───────────────────────────────────────────────────────────────────
cp "$env_file" "$env_file.bak"
say "Backed up the previous file to $env_file.bak."

for i in "${!vars[@]}"; do
  var="${vars[$i]}"
  val="${vals[$i]}"
  tmp="$(mktemp)"
  found=0
  # Rewrite the file line by line so every other line survives verbatim. Only an
  # exact `VAR=...` line at the start of a line is replaced; a commented-out
  # `# VAR=...` is left alone.
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" == "$var="* ]]; then
      printf '%s=%s\n' "$var" "$val" >>"$tmp"
      found=1
    else
      printf '%s\n' "$line" >>"$tmp"
    fi
  done <"$env_file"
  if [ "$found" -eq 0 ]; then
    printf '%s=%s\n' "$var" "$val" >>"$tmp"
  fi
  mv "$tmp" "$env_file"
done

say "Updated $env_file."
printf '\n  Next:  pnpm keys:check\n\n'
