# Keys & accounts

Sourcerer runs with **zero keys**. Anything below is additive: it upgrades one
capability and the app tells you whether it's live on the *What runs where* sheet
(and via `GET /capabilities`). Nothing here is required to demo the core loop.

Free partner credits for several of these are at
<https://hacktoberfest.com/my/promos> (Tinker, Render, Backboard, a .tech domain).

Copy `apps/brain/.env.example` → `apps/brain/.env` and fill in what you have.

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
| **Where** | <https://serpapi.com/manage-api-key> (100 free searches/month; more on paid plans) |
| **Code** | `apps/brain/src/providers/comps.ts` → `SerpApiCompsProvider` |
| **Without it** | Falls back to `LocalHistoryCompsProvider`, then to a clearly-labelled `estimate`. |

> On the sold-vs-asking distinction: eBay moved completed listings behind a login and
> SerpApi retired its Sold filter, so we return **live asking prices**, tag every one
> `kind: "asking"`, and apply a visible `ASKING_TO_SOLD_FACTOR = 0.86`. The UI states
> this. It is the honest version of a metric that no longer exists for free.

### `TABPFN_TOKEN` — your own price model
| | |
|---|---|
| **Unlocks** | A price + days-to-sell model trained on *your* sold history (quantile output from the Prior Labs REST API). The offline number stops being generic. |
| **Where** | <https://platform.priorlabs.ai/account/api-keys> (free non-commercial key) |
| **Code** | `apps/brain/src/providers/pricing.ts` → `TabPfnPricingEngine`; endpoint `POST /train` |
| **Without it** | `HeuristicPricingEngine`: condition-adjusted comps median. Solid, just not personal. |
| **Try it** | `POST /demo/seed` then `POST /train` — 12 historical sales are enough to fit. |

---

## Recommended (partner tracks)

### `SENTRY_DSN` — agent tracing
| | |
|---|---|
| **Unlocks** | `@sentry/node` v11 auto-instruments Mastra: a `gen_ai.*` span per agent step and model call, with token counts, latency and cost. Also captures pipeline errors with the route that produced them. |
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

| Env var | Service | Required | Buys you |
|---|---|---|---|
| — | Ollama + Gemma 3 | **no (but assumed for the full experience)** | identification + listing writing, entirely local |
| `SERPAPI_API_KEY` | SerpApi | no | live eBay comps |
| `TABPFN_TOKEN` | Prior Labs | no | personal price + days-to-sell model |
| `SENTRY_DSN` | Sentry | no | agent tracing |
| `BACKBOARD_API_KEY` | Backboard | no | hosted open-weight brain (GPU-less demo) |
| `DATABASE_URL` | Tiger Data / pgvector | no | vector memory |
| `ELEVENLABS_API_KEY` | ElevenLabs | no | voice in and out |
| `SENTRY_RECORD_INPUTS` | Sentry | no | set `1` only to debug with inputs recorded |
| `MODEL_PROVIDER` | — | no | force `ollama` or `backboard` |
