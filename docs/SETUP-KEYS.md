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
| `SERPAPI_API_KEY` | SerpApi | live eBay comps instead of only your own sold history | <https://serpapi.com/manage-api-key> | No — free tier (250 searches/mo); paid for volume |
| `BACKBOARD_API_KEY` | Backboard | the same agent against open-weight models with no GPU (hosted demo) | <https://app.backboard.io> | No — free credit to start |
| `TABPFN_TOKEN` | Prior Labs | a price model fitted on *your* sold history | <https://platform.priorlabs.ai/account/api-keys> | No — free non-commercial key |
| `DATABASE_URL` | Tiger Data | vector memory: "have I bought this before?" and similar-item search | <https://console.cloud.tigerdata.com/signup> (free tier) — or locally `bash scripts/db-up.sh` | No — free tier |
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

## The exact click path, one service at a time

Every one of these needs a human to create an account — that part cannot be
scripted, automated, or done on someone's behalf. Everything on the other side of
the account (the code, the wiring, the probe, the tests) is already done. So each
entry below is deliberately only: **open this URL, click these things, copy this
one value.**

Ordered by what it buys. Stop wherever you like; `keys:check` will tell you
exactly where you stopped.

### 1. SerpApi — live eBay comps

1. <https://serpapi.com/users/sign_up> — sign up (free tier: 250 searches/month).
2. The dashboard shows **Your API Key** at the top.
3. Copy it → `SERPAPI_API_KEY`.

What it changes: comps stop being only your own sold history and become live eBay
listings. Asking prices, not sold — the app says so in `comps.basis` and applies
the disclosed 14% adjustment rather than pretending they are sold prices.

### 2. Backboard — the same agent, no GPU

1. <https://app.backboard.io> — sign up with GitHub, Google, or email.
2. Left sidebar → **Settings** → **API Keys**.
3. **Create New API Key** → copy it **now**.
4. Paste → `BACKBOARD_API_KEY`.

Backboard only shows the key once, at creation. This is the one key that lets the
whole pipeline run on a machine with no GPU and no Ollama, against the same
open-weight Gemma weights.

### 3. ElevenLabs — voice in, voice out

1. <https://elevenlabs.io/app/sign-up> — sign up (free monthly credits).
2. Bottom-left avatar → **API Keys** (direct link:
   <https://elevenlabs.io/app/settings/api-keys>).
3. **Create API key** → copy it (starts with `sk_`).
4. Paste → `ELEVENLABS_API_KEY`.

What it changes: you can dictate a condition note instead of typing it, and the
verdict can be read back to you — which matters when both hands are holding a
bowl. Transcription uses `scribe_v2`, speech uses `eleven_flash_v2_5`.

### 4. Sentry — see what the agent actually did

1. <https://sentry.io/signup/> — sign up (free Developer tier).
2. Create a project → platform **Node.js** → name it `sourcerer`.
3. Copy the **DSN** from the setup snippet — or **Settings → Projects →
   sourcerer → Client Keys (DSN)**.
4. Paste → `SENTRY_DSN`.

The DSN looks like `https://<public-key>@o<org>.ingest.<region>.sentry.io/<id>`
and is safe to paste (it is a write-mostly ingest key, not an auth token).

What it changes: identify / comps / price get wrapped in real spans, so you can
see "identify 4.2 s on Gemma, comps 900 ms, price 300 ms" instead of guessing.
The spans are ours and every number in them is measured. What is *not* claimed:
Sentry's Mastra integration, which emits the framework's own `gen_ai.*` spans —
that needs `@mastra/observability` and Sentry preloading, and neither is wired.

### 5. Tiger Data — vector memory (optional)

Only needed if you want the **cloud** version. The local one needs no account at
all:

```bash
bash scripts/db-up.sh   # starts pgvector on 127.0.0.1:5433, prints the .env line
```

If you do want Tiger Cloud:

1. <https://console.cloud.tigerdata.com/signup> → **Start your free trial**.
2. Confirm the emailed link, then pick a plan.
3. **Create service** → the free/shared tier → name it `sourcerer` → create.
4. Copy the connection string (`postgresql://…?sslmode=require`) →
   `DATABASE_URL`.

What it changes: "have I bought this before?" and similar-item search go from
keyword matching to real pgvector similarity. The code strips `sslmode` and sets
TLS itself, because `sslmode=require` means verify-full as of pg 8.23 and Tiger's
free services present a self-signed certificate.

### 6. Prior Labs / TabPFN — the fitted price model (optional, last)

TabPFN is not one of the prize tracks, which is why it sits last: it makes the
pricing claim stronger, not the submission broader.

1. <https://platform.priorlabs.ai> — sign in.
2. Complete account setup.
3. **API Keys** page → create → copy.
4. Paste → `TABPFN_TOKEN`.

What it changes: `POST /train` fits a model on your own sold history instead of
using the condition-adjusted comps heuristic. It does **not** predict
days-to-sell — nothing populates that field.

---

## If you would rather not paste keys into a terminal

Paste the values anywhere and they can be written for you. The mechanism is the
same either way:

```bash
pnpm keys:setup    # one prompt per key, Enter to skip, secrets never echoed
pnpm keys:check    # live probes; proves which ones are real
```

If you hand the values over in chat, `pnpm keys:setup` and `pnpm keys:check` are
run for you and the results in [`KEYS.md`](./KEYS.md) are updated to match what
the live probe actually returned.

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
