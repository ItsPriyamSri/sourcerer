# Architecture

Sourcerer is three packages and one idea: **the model reads the item, arithmetic decides
the money.** Everything below follows from that split.

```
┌───────────────────────────── apps/web (PWA) ──────────────────────────────┐
│  Scan · Listings · Insights                                               │
│  • IndexedDB is the source of truth for captures (works with no server)   │
│  • service worker precaches the shell; the app boots with no network      │
│  • re-prices a verdict locally from packages/shared when you type a price │
│  • queues a capture when the brain is unreachable, refines it later       │
└───────────────────────────────────┬───────────────────────────────────────┘
                                    │  POST /scan  (SSE stage stream)
┌───────────────────────────────────▼────── apps/brain (Hono) ──────────────┐
│  GET  /capabilities    the truth about what is live                       │
│  POST /scan            the pipeline, streamed stage by stage              │
│  POST /advisor         Mastra agent, tools, memory                        │
│  POST /listing         Mastra listing-writer agent                        │
│  GET  /inventory · POST /inventory/:id/sold · GET /insights               │
│  GET  /similar         pgvector hybrid retrieval                          │
│  POST /train           fit a TabPFN model on your sold history            │
│  POST /transcribe · /speak   ElevenLabs                                   │
│  POST /reprice         starts the Temporal workflow                       │
└──────┬────────────────────┬───────────────────┬───────────────────────────┘
       │                    │                   │
┌──────▼──────┐   ┌─────────▼────────┐  ┌───────▼──────────┐
│  core/steps │   │  mastra/*        │  │  durable/*       │
│  the pipeline│  │  agents, tools,  │  │  Temporal        │
│             │   │  workflow, memory│  │  worker + client │
└──────┬──────┘   └─────────┬────────┘  └──────────────────┘
       │                    │
┌──────▼────────────────────▼───────────────────────────────────────────────┐
│  providers/  llm · comps · pricing · vector · voice · tracing             │
│  every one optional, every one swappable, every one reports its own truth │
└───────────────────────────────────────────────────────────────────────────┘
```

## 1. The pipeline

`apps/brain/src/core/steps.ts` holds five plain async functions:

| Step | Job | Failure behaviour |
|---|---|---|
| `identify` | Photo and/or text → `Identification` (title, brand, category, attributes, condition, keywords, confidence, caveats) | Falls through the provider chain (Ollama → Backboard); if a model returns prose instead of JSON, the prose becomes a low-confidence title rather than a 500 |
| `findComps` | Keywords → comparable listings | SerpApi → comps cache → the user's own sold history → `estimate` |
| `estimatePrice` | `Identification` + comps → `PriceEstimate` (expected / low / high / confidence) | TabPFN → condition-adjusted comps median → conservative heuristic |
| `decideVerdict` | `buyPrice` + expected resale + `CostModel` → `Verdict` | Pure function; cannot fail |
| `writeListing` | item → `ListingDraft` | Model → a clearly-labelled template built from what we already know |

The HTTP route and the Mastra workflow both call these same functions, so the app, the
agent and the workflow can never disagree about what an item is worth.

Every step appends to a `ran[]` log: which provider ran, how long it took, and — the
part that matters — whether data left the device.

## 2. The provider model

Each provider is a small interface plus a chain.

```ts
// llm.ts
providerChain()        // [primary, ...the rest]
llmChat(opts)          // walks the chain, collecting errors, throws only if all fail

// comps.ts
new CachedCompsProvider(new LocalHistoryCompsProvider(new SerpApiCompsProvider(...)))

// pricing.ts
new ChainedPricingEngine([new TabPfnPricingEngine(), new HeuristicPricingEngine()])
```

The rule is that a provider never throws past the caller that can degrade. A missing API
key is not an error; it is a capability that is `false` in `GET /capabilities`, and the
chain simply skips that link.

`GET /capabilities` deliberately distinguishes *"the server is up"* from *"the model is
actually pulled"*. A running Ollama with no Gemma is not a usable brain, and the UI says
so instead of failing ninety seconds into a scan.

## 3. Local inference

`OllamaProvider` speaks Ollama's **native** `/api/chat`, not the OpenAI compatibility
shim, for two reasons:

1. **Vision.** Images attach to the final user message as base64, which is how Gemma 3
   receives them.
2. **Constrained decoding.** `body.format = <JSON Schema>` makes Ollama *constrain*
   sample selection to the schema. A 4B model that is merely asked for JSON produces
   JSON most of the time; a 4B model that is *constrained* produces valid JSON
   essentially always. This is the single highest-leverage line in the codebase — see
   `docs/evidence/identify-results.json`, where switching it on moves parseable output
   from a coin flip to eight or nine in ten.

Two models are used, chosen by task:

| Task | Model | Why |
|---|---|---|
| Identification (with a photo) | `gemma3:4b` | Needs the vision encoder and enough world knowledge to name a brand from a label |
| Identification (text only), listing copy | `gemma3:1b` | Loading 3 GB of vision weights to tidy a title would be a waste of the user's battery |

Requests carry `keep_alive: 30m`, because a reseller scans a dozen items in a row and
paying the multi-second weight-load cost on each one would be a self-inflicted wound.

## 4. Mastra

Mastra is the agent layer, and it is used for what it is actually good at:

- **`tools.ts`** — five `createTool` definitions (`searchComps`, `estimatePrice`,
  `feeMath`, `saveItem`, `similarItems`). Each tool wraps the *same deterministic
  function* the pipeline uses. This is deliberate: an agent cannot invent a price,
  because the only way it can obtain one is to call arithmetic.
- **`agents.ts`** — a `sourcingAdvisor` (tools + memory) and a `listingWriter`. Memory is
  `@mastra/memory` over `LibSQLStore`, so the advisor remembers what you have bought and
  what you passed on.
- **`workflows.ts`** — a four-step typed `scanWorkflow` composed of the pipeline
  functions. `pnpm --filter @sourcerer/brain mastra` opens the Studio.
- **`storage.ts`** — `LibSQLStore` at `./data/mastra.db`.

**A limitation worth stating.** Ollama reports Gemma 3's capabilities as `completion`
and `vision` only. There is no `tools`. So the tool-using advisor cannot run on Gemma 3
through Ollama; it needs a second, tool-capable open model beside it. The app detects
this, reports it in `/capabilities`, and the advisor degrades to a deterministic answer
built from the same numbers rather than erroring. The agent runtime, the workflow and
memory are Gemma-backed and unaffected.

## 5. Durability

`durable/` is a Temporal workflow, `repriceWorkflow`:

1. List inventory whose comps are older than N days.
2. For each item, re-run `findComps` and `estimatePrice` as activities.
3. Persist the refreshed pricing and record a `pricedChanged` event for the UI.

Activities carry explicit retry policy (`initialInterval`, `backoffCoefficient`,
`maximumInterval`, `maximumAttempts`, plus `nonRetryableErrorTypes`), because the
flakiest dependency in the whole system is a third-party search API. Killing the worker
mid-run is safe: the workflow replays from history and resumes. `POST /reprice` returns
a plain `started: false` with a hint when the server or worker is not running — the app
never pretends a background job exists when it does not.

## 6. Storage

| Data | Where | Why |
|---|---|---|
| Captures, queue, settings | **IndexedDB in the browser** | The app owns its data. It must work with no server at all, and the user can inspect it. |
| Inventory, sold history, comps cache, photos | **JSON + files under `./data`** in the brain | Local-first and provable: open the folder. |
| Agent memory | **LibSQL** at `./data/mastra.db` | Mastra's `Memory` needs a store; LibSQL needs no server. |
| Embeddings | **pgvector** (Tiger Data or a local container) | Only for "have I bought this before?" and near-duplicate detection. Optional. |

## 7. Failure behaviour, layer by layer

This table is the honest version of "it degrades gracefully".

| What breaks | What the user sees |
|---|---|
| No Ollama | Scans run entirely in the browser: text-based identification, pricing from your own sold history, tagged `estimate` |
| Ollama up, model not pulled | Settings says `Waiting on model pull: gemma3:4b`; scans use the on-device path |
| No network | The app loads from the service worker; the offline chip appears; captures queue locally |
| No `SERPAPI_API_KEY` | Comps come from your sold history; the badge changes from `live comps` to `your sold history` |
| No `TABPFN_TOKEN` | Pricing is condition-adjusted comps; `method` reads `comps_median`, not `tabpfn` |
| No `DATABASE_URL` | `/similar` returns nothing; everything else is unaffected |
| Brain unreachable at scan time | The capture is queued, priced on-device, and **silently upgraded to live comps** the next time the brain is reachable |
| Model returns prose instead of JSON | `extractJson` salvages the JSON; failing that, the prose becomes a low-confidence title and the verdict leans PASS |

## 8. Why the shared package exists

`packages/shared` has no I/O. That is the point.

Because `decideVerdict`, `maxOfferFor`, `computeEconomics` and the comps statistics are
pure, the browser can recompute a verdict the instant you type a price — with the
network off — and be guaranteed to agree with the server. It also means the arithmetic
is unit-testable without mocking a model, which is what makes
`packages/shared/src/economics.test.ts` evidence rather than hygiene.
