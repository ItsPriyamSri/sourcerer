# Set up your keys

The short version: **do this, in this order, and you are done.**

Sourcerer runs with **zero keys**. No key, no network, no GPU: local Gemma
identifies, local heuristics price, and your own sold history is the comps
source. Every key below only *upgrades* one capability, and the app tells the
truth about which ones are live via `GET /capabilities`. So if you stop after
step 1, you still have a working app.

For the long form — what each integration is, where it lives in the code, what
it degrades to — see [`KEYS.md`](./KEYS.md).

---

## The path

```bash
# 1. install the workspace (pulls the local-first deps)
pnpm install

# 2. add the keys you have — one prompt at a time, Enter to skip
pnpm keys:setup

# 3. prove they actually work — this is the real gate
pnpm keys:check

# 4. run the two processes, in two terminals
pnpm --filter @sourcerer/brain dev   # → http://127.0.0.1:8787
pnpm --filter @sourcerer/web dev     # → http://localhost:3000
```

`pnpm keys:setup` writes to `apps/brain/.env` (creating it from
`apps/brain/.env.example` if needed), backs the previous file up to
`apps/brain/.env.bak`, and never repeats a key. Re-run it whenever you like.

`pnpm keys:check` makes one live, read-only request per integration and prints a
`PASS` / `FAIL` / `SKIPPED(no key)` / `SHAPE-ONLY` row. It exits non-zero only if
something you *did* configure is broken. An absent key is never a failure.

---

## The six keys

| Env var | Service | What it unlocks | Where to get it | Paid account? |
|---|---|---|---|---|
| `SERPAPI_API_KEY` | SerpApi | live eBay comps instead of only your own sold history | <https://serpapi.com/manage-api-key> | No — free tier (100 searches/mo); paid for volume |
| `BACKBOARD_API_KEY` | Backboard | the same agent against open-weight models with no GPU (hosted demo) | <https://app.backboard.io> | No — free credit to start |
| `TABPFN_TOKEN` | Prior Labs | a price model fitted on *your* sold history | <https://platform.priorlabs.ai/account/api-keys> | No — free non-commercial key |
| `DATABASE_URL` | Tiger Data | vector memory: "have I bought this before?" and similar-item search | <https://console.cloud.timescale.com/> (free tier) — or locally `bash scripts/db-up.sh` | No — free tier |
| `ELEVENLABS_API_KEY` | ElevenLabs | dictate an item hands-free and hear the verdict read back | <https://elevenlabs.io/app/settings/api-keys> | No — free tier available |
| `SENTRY_DSN` | Sentry | agent tracing: a span per pipeline stage (identify, comps, price) | <https://sentry.io> → new Node project → copy the DSN | No — free developer tier |

None of these are required. The only thing that is effectively required for the
full offline experience is Ollama plus the Gemma models (`pnpm model:pull`), and
`keys:check` checks those too.

### The exact `.env` line for each

`pnpm keys:setup` fills these in for you. If you would rather edit the file by
hand, `apps/brain/.env` takes exactly one line per key:

```dotenv
SERPAPI_API_KEY=<your key>
BACKBOARD_API_KEY=<your key>
TABPFN_TOKEN=<your key>
DATABASE_URL=postgresql://tsdbadmin:<password>@<service>.<project>.tsdb.cloud.timescale.com:<port>/tsdb?sslmode=require
ELEVENLABS_API_KEY=<your key>
SENTRY_DSN=https://<public-key>@<org>.ingest.sentry.io/<project-id>
```

Related, all optional and already in `.env.example`:
`MODEL_PROVIDER=ollama|backboard` forces the model provider,
`PREFER_BACKBOARD=1` prefers Backboard when a key exists, and
`BACKBOARD_BASE_URL` defaults to `https://app.backboard.io/api`.

---

## If `keys:check` says FAIL

`FAIL` always means "a value you supplied was tried and did not work". Fix the
row, re-run `pnpm keys:check`.

| Failing row | Usually means | Do this |
|---|---|---|
| `Ollama` | not running, or a configured model is not pulled | `ollama serve`, then `pnpm model:pull` |
| `Temporal` | the dev server is not running | `temporal server start-dev` |
| `SerpApi` — `HTTP 401` | the key is wrong or truncated | re-run `pnpm keys:setup` and paste it again |
| `Backboard` — `HTTP 401/403` | the key was rejected | check it at <https://app.backboard.io> |
| `TabPFN` — `HTTP 401/403` | the token was rejected | check it at <https://platform.priorlabs.ai/account/api-keys> |
| `Tiger Data` | the URL is unreachable, or `pgvector` is not installed | verify the connection string, or run `bash scripts/db-up.sh` for a local one |
| `ElevenLabs` — `HTTP 401` | the key was rejected, or its IP allowlist excludes you | check it at <https://elevenlabs.io/app/settings/api-keys> |
| `Sentry` | the DSN was rejected, or no delivery receipt came back | copy the DSN again from your Sentry project |
| any row — a timeout | the host is unreachable from here | check your network or firewall |

`SKIPPED(no key)` is not a problem — it means that integration is simply not
configured. `SHAPE-ONLY` means the service was reachable but the documented
read-only probe could not confirm the key (for example, the route moved), so
`keys:check` refuses to claim a pass.

---

## A note on what has actually been verified

`keys:check` verifies *your* keys, live, the moment you run it. This repo does
not ship a claim that any integration has been billed or exercised against a
paid account; the partner integrations are implemented, typechecked, wired into
the capability registry, and observed to degrade cleanly when their key is
absent. If you supply a key, `keys:check` is the switch that tells you whether it
is genuinely live.
