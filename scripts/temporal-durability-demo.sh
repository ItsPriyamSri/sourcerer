#!/usr/bin/env bash
#
# Prove the reprice workflow is actually durable.
#
# Anyone can put "Temporal" on a slide. The claim worth making is narrower and
# checkable: kill the worker in the middle of a sweep, and the run finishes without
# re-doing the items it already priced. This script produces that evidence — the two
# worker logs and the event history count — into docs/evidence/.
#
# Requirements: `temporal server start-dev` running, and the brain up (for /demo/seed).
#
#   bash scripts/temporal-durability-demo.sh
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
BRAIN="${BRAIN_URL:-http://127.0.0.1:8787}"
TEMPORAL="${TEMPORAL_BIN:-$HOME/.local/bin/temporal}"
EVIDENCE="$ROOT/docs/evidence"
WORK="$EVIDENCE/temporal"
PACE_MS="${PACE_MS:-1200}"        # a real rate limit for a paid search API
SUFFIX="${SUFFIX:-demo-$(date -u +%H%M%S)}"

mkdir -p "$WORK"
cd "$ROOT/apps/brain" || exit 1

log() { printf '%s\n' "$*" | tee -a "$WORK/run.txt"; }
: > "$WORK/run.txt"

log "── Sourcerer reprice durability demo ──"
log "($(date -Is))"

if ! "$TEMPORAL" operator cluster health >/dev/null 2>&1; then
  log "Temporal is not reachable. Start it first:  temporal server start-dev"
  exit 1
fi
log "temporal:  $($TEMPORAL --version | head -1)"

# ── 1. a sweep worth interrupting ────────────────────────────────────────────
log ""
log "1. seeding a demo inventory (sold history + items, no model calls)"
SEED="$(curl -sf -X POST "$BRAIN/demo/seed?reset=1" || true)"
if [ -z "$SEED" ]; then
  log "   could not reach the brain at $BRAIN — start it with: pnpm --filter @sourcerer/brain dev"
  exit 1
fi
log "   $SEED"

TOTAL="$(curl -sf "$BRAIN/inventory" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["items"]))')"
log "   inventory now holds $TOTAL items"

# ── 2. start a worker, then a paced sweep ────────────────────────────────────
start_worker() { # $1 = log file
  setsid pnpm exec tsx src/durable/worker.ts > "$1" 2>&1 &
  echo $!
}

log ""
log "2. starting worker #1"
W1="$(start_worker "$WORK/worker-1.txt")"
for _ in $(seq 1 40); do
  grep -q "listening" "$WORK/worker-1.txt" 2>/dev/null && break
  sleep 1
done
log "   $(grep -m1 listening "$WORK/worker-1.txt" || echo 'worker #1 did not report in')"

log ""
log "3. starting a paced sweep (${PACE_MS}ms between items: a rate limit for a paid API)"
REPRICE_PACE_MS="$PACE_MS" REPRICE_ID_SUFFIX="$SUFFIX" pnpm exec tsx src/durable/reprice-cli.ts > "$WORK/client.txt" 2>&1 &
CLIENT=$!
sleep 1
log "   $(grep -m1 started "$WORK/client.txt" || echo 'client not started yet')"

# ── 3. kill it mid-sweep ─────────────────────────────────────────────────────
log ""
log "4. waiting for some real work to land, then killing worker #1 outright (SIGKILL)"
for _ in $(seq 1 60); do
  DONE_NOW="$(grep -c '\[reprice\]' "$WORK/worker-1.txt" 2>/dev/null || true)"
  [ "${DONE_NOW:-0}" -ge 3 ] && break
  sleep 1
done
BEFORE="$(grep -c '\[reprice\]' "$WORK/worker-1.txt" 2>/dev/null || true)"
BEFORE="${BEFORE:-0}"
kill -9 -- "-$W1" 2>/dev/null || kill -9 "$W1" 2>/dev/null || true
sleep 2
log "   worker #1 had refreshed $BEFORE item(s) when it died"

WF_ID="reprice-$(date -u +%Y-%m-%d)-$SUFFIX"
STATUS_AFTER_KILL="$("$TEMPORAL" workflow describe --workflow-id "$WF_ID" --output json 2>/dev/null \
  | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    print(d.get("workflowExecutionInfo",{}).get("status","unknown"))
except Exception:
    print("unknown")' 2>/dev/null || echo unknown)"
log "   workflow status right after the kill: $STATUS_AFTER_KILL"
log "   (the process is gone; the run is not)"

# ── 4. bring a fresh worker up and let the run finish ────────────────────────
log ""
log "5. starting worker #2 — it should replay history and resume at the next item"
W2="$(start_worker "$WORK/worker-2.txt")"
for _ in $(seq 1 40); do
  grep -q "listening" "$WORK/worker-2.txt" 2>/dev/null && break
  sleep 1
done
log "   $(grep -m1 listening "$WORK/worker-2.txt" || echo 'worker #2 did not report in')"

for _ in $(seq 1 180); do
  grep -q "^done:" "$WORK/client.txt" 2>/dev/null && break
  sleep 1
done
AFTER="$(grep -c '\[reprice\]' "$WORK/worker-2.txt" 2>/dev/null || true)"
AFTER="${AFTER:-0}"
kill -9 -- "-$W2" 2>/dev/null || kill -9 "$W2" 2>/dev/null || true
kill -9 "$CLIENT" 2>/dev/null || true

# ── 5. the numbers that matter ───────────────────────────────────────────────
# Each item costs two activity executions: refreshComps, then applyReprice. So the
# history should hold exactly 2 × items, and a crash should add none.
STATS="$("$TEMPORAL" workflow show --workflow-id "$WF_ID" --output json 2>/dev/null \
  | python3 -c 'import sys,json
from collections import Counter
try:
    d=json.load(sys.stdin)
    ev=d.get("events") or d.get("history",{}).get("events") or []
    c=Counter(e.get("eventType","?") for e in ev)
    print(c.get("EVENT_TYPE_ACTIVITY_TASK_SCHEDULED",0), c.get("EVENT_TYPE_WORKFLOW_TASK_SCHEDULED",0), len(ev))
except Exception:
    print("? ? ?")' 2>/dev/null || echo "? ? ?")"
read -r SCHEDULED WF_TASKS EVENTS <<< "$STATS"

UNIQUE="$(cat "$WORK/worker-1.txt" "$WORK/worker-2.txt" 2>/dev/null | grep -oP '^\[reprice\] \K[^ ]+' | sort -u | wc -l)"
DUPES="$(cat "$WORK/worker-1.txt" "$WORK/worker-2.txt" 2>/dev/null | grep -oP '^\[reprice\] \K[^ ]+' | sort | uniq -d | wc -l)"
RESULT="$(grep -m1 '^done:' "$WORK/client.txt" 2>/dev/null || echo 'run did not finish')"
EXPECTED_ACTIVITIES=$((TOTAL * 2))

{
  echo ""
  echo "══ durability result ══"
  echo "items in the sweep                          : $TOTAL"
  echo "worker #1 refreshed before the SIGKILL      : $BEFORE"
  echo "worker #2 refreshed after the restart       : $AFTER"
  echo "distinct items across both worker logs      : $UNIQUE"
  echo "items refreshed twice (should be 0)         : $DUPES"
  echo "activity executions in the history          : $SCHEDULED  (expected $EXPECTED_ACTIVITIES = 2/item)"
  echo "workflow tasks scheduled                    : $WF_TASKS  (replays from the crash included)"
  echo "total events persisted                      : $EVENTS"
  echo "final result reported by the client         : $RESULT"
  echo ""
  if [ "$UNIQUE" = "$TOTAL" ] && [ "$DUPES" = "0" ] && [ "$SCHEDULED" = "$EXPECTED_ACTIVITIES" ]; then
    echo "PASS — the SIGKILL cost the run time and nothing else."
    echo "       No item was refreshed twice, and no activity was re-executed on replay."
  else
    echo "REVIEW — the numbers above do not show a clean resume."
  fi
} | tee -a "$WORK/run.txt"

log ""
log "evidence: $WORK/"
