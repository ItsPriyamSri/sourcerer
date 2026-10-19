# Keys & accounts

Sourcerer runs with **zero keys**. Anything below is additive: it upgrades one
capability and the app tells you whether it's live on the *What runs where* sheet
(and via `GET /capabilities`). Nothing here is required to demo the core loop.

Free partner credits for several of these are at
<https://hacktoberfest.com/my/promos> (Tinker, Render, Backboard, a .tech domain).

Copy `apps/brain/.env.example` → `apps/brain/.env` and fill in what you have — or let
`pnpm keys:setup` prompt you through it and `pnpm keys:check` confirm each one is live.
See [`SETUP-KEYS.md`](./SETUP-KEYS.md) for the one-page version.

---

## Required for the core experience

**None.** No key, no network, no GPU beyond the machine that already runs Ollama.
Local Gemma identifies, local heuristics price, your own sold history is the comps
source. This is deliberate — the working offline behaviour *is* the pitch.

---

## Strongly recommended

### `SERPAPI_API_KEY` — live market comps
| | |
|---|---|
| **Unlocks** | Live eBay asking prices instead of only your own sold history. Turns `comps.source` from `local_history` into `live`. |
| **Where** | <https://serpapi.com/manage-api-key> (250 free searches/month; more on paid plans) |
| **Code** | `apps/brain/src/providers/comps.ts` → `SerpApiCompsProvider` |
| **Without it** | Falls back to `LocalHistoryCompsProvider`, then to a clearly-labelled `estimate`. |

> On the sold-vs-asking distinction: eBay moved completed listings behind a login and
> SerpApi retired its Sold filter, so we return **live asking prices**, tag every one
> `kind: "asking"`, and apply a visible `ASKING_TO_SOLD_FACTOR = 0.86`. The UI states
> this. It is the honest version of a metric that no longer exists for free.

### `TABPFN_TOKEN` — your own price model
| | |
|---|---|
| **Unlocks** | A price model trained on *your* sold history (regression quantiles from the Prior Labs REST API), so the offline number stops being generic. Price only — sale speed is recorded but not modelled. |
| **Where** | <https://platform.priorlabs.ai/account/api-keys> (free non-commercial key) |
| **Code** | `apps/brain/src/providers/pricing.ts` → `TabPfnPricingEngine`; the documented flow `POST /tabpfn/prepare_train_set_upload` → `PUT` → `POST /tabpfn/fit` → `POST /tabpfn/prepare_test_set_upload` → `PUT` → `POST /tabpfn/predict` |
| **Without it** | `HeuristicPricingEngine`: condition-adjusted comps median. Solid, just not personal. |
| **Try it** | `POST /demo/seed?reset=1` then `POST /train` — the demo fixture ships 32 historical sales, and 8 is the minimum a fit will accept. |

---

## Recommended (partner tracks)

### `SENTRY_DSN` — agent tracing
| | |
|---|---|
| **Unlocks** | `@sentry/node` spans around the pipeline — identify, comps, price — so one run becomes a real waterfall, plus error capture that attaches the route it came from. The framework's own `gen_ai.*` spans (token counts, per-model-call cost) are **not** wired: that integration needs `@mastra/observability` installed and `Sentry.init` preloaded, which this repo does not do. |
| **Where** | <https://sentry.io> → create a Node project → copy the DSN |
| **Code** | `apps/brain/src/providers/tracing.ts` (`initTracing`, `withSpan`, `captureError`) |
| **Without it** | Everything works; you just have no traces. `/health` reports `tracing: false`. |
| **Note** | `SENTRY_RECORD_INPUTS=0` by default — photos and prompts stay out of traces. |

### `BACKBOARD_API_KEY` — the hosted brain
| | |
|---|---|
| **Unlocks** | The same two agents against open-weight models (Gemma 3 27B, gpt-oss, Qwen…) through one key, with no GPU. This is what makes a *hosted* demo possible. |
| **Where** | <https://app.backboard.io> (free credit at the Hacktoberfest promos page) |
| **Code** | `apps/brain/src/providers/llm.ts` → `BackboardProvider` (`POST /threads/messages`, `X-API-Key`, vision over multipart `files`) |
| **Switch to it** | `MODEL_PROVIDER=backboard` (or `PREFER_BACKBOARD=1` to prefer it when a key exists) |
| **Without it** | Local Gemma only. Fine locally; a problem only for a GPU-less host. |
| **Gotcha** | Backboard is **not** OpenAI-compatible. It is a thread API; the provider handles that. |
| **Live status** | Authenticated against a real account. But a Backboard run that fails comes back as **HTTP 200** with `status: "FAILED"` and the reason in `content` — and this account's free credit is reserved for Memory & RAG, so it cannot cover LLM chat. Read as a success, that billing notice became the item title and then a live search query. It is detected now and `llmChat` falls through to local Gemma, so the scan stays correct with no credit anywhere. See `docs/evidence/backboard-credit-wall.json`. |

### `DATABASE_URL` — vector memory ("have I bought this before?")
| | |
|---|---|
| **Unlocks** | Hybrid (reciprocal-rank-fusion) retrieval over your inventory: near-duplicate detection, "have I seen this?" checks, similar-sold lookups the advisor can cite. |
| **Where** | **Tiger Data** free tier (ex-Timescale; pick **us-east-1**, pgvector + pgvectorscale pre-installed) → *Create service* → copy the connection string |
| **Format** | `postgresql://tsdbadmin:<pw>@<svc>.<proj>.tsdb.cloud.timescale.com:<port>/tsdb?sslmode=require` |
| **Local alternative** | `bash scripts/db-up.sh` → pgvector in a container, no cloud account at all |
| **Code** | `apps/brain/src/providers/vector.ts` |
| **Without it** | `/similar` returns nothing; everything else is unaffected. |

---

## Optional

### `ELEVENLABS_API_KEY` — voice in, verdict out
| | |
|---|---|
| **Unlocks** | Dictate an item while your hands are full (`POST /transcribe`) and hear the verdict read back (`POST /speak`). |
| **Where** | <https://elevenlabs.io/app/settings/api-keys> |
| **Without it** | The voice surfaces return `501` and the UI simply doesn't offer them. |
| **Scopes** | New keys are created **scoped**, and a scoped key answers `401` on routes it was not granted — `user_read` included. The app needs `speech_to_text` and `text_to_speech`. `pnpm keys:check` reads the scope off the error body and then probes the app's real voice-in call, so a valid-but-scoped key is not misreported as broken. |
| **Plan limit** | On the ElevenLabs free plan, **voice out does not work through the API at all**: library voices — including the default one — return `402 paid_plan_required` (*"Free users cannot use library voices via the API"*). Voice **in** works and is verified live. Voice out needs a paid plan, or `ELEVENLABS_TTS_VOICE` set to a voice the account owns. |

### Hosting & domain — no secret needed
| | |
|---|---|
| **Render** | Account + Blueprint deploy from `infra/render.yaml`. Free web tier, no GPU, so the hosted brain uses Backboard. |
| **.tech domain** | Free via the Hacktoberfest promos page. Point it at the Render static site. |
| **Temporal** | No key — `temporal server start-dev`. See *Durable jobs* below. |

---

## Durable jobs (Temporal) — no key, but two processes

```bash
# 1) the dev server (gRPC 7233, UI http://localhost:8233)
curl -LO 'https://temporal.download/cli/archive/latest?platform=linux&arch=amd64'
tar -xzf <archive> temporal && install -m755 temporal ~/.local/bin/temporal
temporal server start-dev

# 2) the worker
pnpm --filter @sourcerer/brain worker

# 3) kick a reprice run
curl -X POST http://127.0.0.1:8787/reprice
```

`POST /reprice` returns a friendly `started: false` with a hint if the server or worker
isn't running — the app never pretends a background job exists when it doesn't.

---

## Summary table

Hand this to whoever is supplying credentials. **Nothing in this table is required** to
run Sourcerer.

Two different things can be meant by "it works", so they are two separate columns:

- **Request verified** — the HTTP request or connection this code builds has been checked
  against the provider's *published* contract (current docs, and its OpenAPI where one
  exists), and pinned by a test wherever the contract can be pinned. This is the class of
  bug that only shows up once someone finally connects a real key: a parameter the API
  rejects, a model id that was retired last month, a TLS default that silently overrides
  your own settings.
- **Live account** — a real, billed account called it and got a real answer back. Rows marked
  *yes* here have been exercised for real and the response is committed under
  `docs/evidence/`. Supplying a key is what moves a row there, and `pnpm keys:check` is the
  command that reports it.

| Env var | Service | Required | Buys you | Request verified | Live account |
|---|---|---|---|---|---|
| — | Ollama + Gemma 3 | no ¹ | identification + listing writing, entirely local | **yes** | **yes — measured**, `docs/evidence/identify-results.json` |
| — | Temporal | no | crash-proof background reprice | **yes** | **yes — a `SIGKILL` mid-sweep**, `docs/evidence/temporal/` |
| `SERPAPI_API_KEY` | SerpApi | no | live eBay asking-price comps | **yes** — the `_ipg` cap snaps to an allowed size (25/50/100/200); 15 tests | **yes — live**, 51 real eBay listings for `brass bottle opener nautical` (`docs/evidence/serpapi-live.json`) |
| `TABPFN_TOKEN` | Prior Labs | no | price model fitted on your own sales | **yes** — quantile-major output read as documented; 7 tests | not yet |
| `SENTRY_DSN` | Sentry | no | a span per pipeline stage, plus error capture | **yes** — v11 `dataCollection`, `isEnabled`, flush-on-exit | not yet |
| `BACKBOARD_API_KEY` | Backboard | no | hosted open-weight brain (GPU-less demo) | **yes** — per-turn text goes in `system_prompt`, not the undocumented `instructions`; 13 tests | **partly** — authenticated live, but this account's free credit is reserved for Memory & RAG and cannot cover LLM chat: a real run returns HTTP 200 with `status: FAILED`. Detected now, so the chain falls through to local Gemma (`docs/evidence/backboard-credit-wall.json`) |
| `DATABASE_URL` | Tiger Data / pgvector | no | vector memory ("have I bought this before?") | **yes** — `sslmode` is stripped so it cannot override our TLS; 7 tests | **yes — pgvector**, a local container (no cloud account): 32 items embedded and a semantic search that shares no keywords with the answer |
| `ELEVENLABS_API_KEY` | ElevenLabs | no | voice in and out | **yes** — `scribe_v2` (`scribe_v1` was retired 2026-07-09) and `eleven_flash_v2_5` | **yes — voice in**: `POST /v1/speech-to-text` with `scribe_v2` returns HTTP 200 live. Voice *out* is blocked by the ElevenLabs **plan**, not by this code: the free plan refuses library voices over the API with 402 `paid_plan_required` |
| `SENTRY_RECORD_INPUTS` | Sentry | no | set `1` only to debug with inputs recorded | — | — |
| `MODEL_PROVIDER` | — | no | force `ollama` or `backboard` | — | — |

¹ Assumed for the full experience, but not required: with no model at all the app falls
back to on-device heuristics.

**What "request verified" does not mean:** it does not mean the integration has been
billed, quota-capped, rate-limited, or has seen a real payload. Each of those is a
live-account question, and for every keyed row except SerpApi and pgvector the honest
answer is still "not yet". What it does mean is that the defects which would have failed
on the *first* live call were found and fixed before a key was ever connected — several of
them by reading the published contract instead of assuming it. Run `pnpm keys:check` to
prove the rest, live, in one command.
