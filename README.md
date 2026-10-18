# Sourcerer

**Know what it's worth. Anywhere.**

An offline-first sourcing copilot for resellers and flippers. Photograph an item, and a
multimodal open-weight model running *on your own machine* identifies it, prices it
against the market, and tells you the most you should pay — in the basement, in the
back room of an estate sale, in a warehouse with no bars on your phone.

```
┌──────────┐   ┌──────────────────────────┐   ┌─────────────────┐   ┌──────────────┐
│ photo or │ → │ Gemma 3 (local, Ollama)  │ → │ comps + fee math│ → │ BUY / MAYBE  │
│  a note  │   │ identify · read labels   │   │ SerpApi or your │   │ PASS + max   │
│          │   │ no network required      │   │ own sold history│   │ offer price  │
└──────────┘   └──────────────────────────┘   └─────────────────┘   └──────────────┘
```

---

## The problem, stated honestly

A reseller's decision moment is **offline and time-pressured**. There is no wifi in a
thrift-store basement and no time to wait for a server round trip while your hands are
full. Every existing pricing tool requires the network at exactly the moment it is
unavailable, so it fails the job-to-be-done — not by being slow, but architecturally.

That is why this project is built the way it is. Open-weight AI on your own device is
not a nice-to-have for this problem. **It is the only architecture that solves it.**

Sourcerer keeps working with:

- no internet connection
- no API keys of any kind
- no per-scan cost
- no photos leaving your machine

and gets *sharper* when you add the network and a few keys back. Degradation is a
feature, not an error path.

---

## What it actually does

**Scan.** Point the camera at an item — a label, a maker's mark, a jacket on a rack — or
just type a description. The app downscales the photo locally, runs it through Gemma 3
on your machine, and streams the pipeline stages back as they happen (`Reading →
Checking the market → Pricing → Deciding`). You get a verdict card:

- one dominant signal — **BUY / MAYBE / PASS** — with an icon, a word and a colour, so
  it reads at arm's length and survives colour blindness
- **the max offer price**, in the largest type on the screen
- an expected resale range, the multiple, and the profit after real fees
- where the number came from, always: `12 live comps` or `your sold history · 71%`

Then type the price on the tag and the whole thing re-prices **instantly and offline**,
because the fee arithmetic is deterministic pure TypeScript shared by the server and the
browser — not a model call.

**Listings.** Everything you captured is in a queue. Tap once and your local model
writes the title, description, tags and price for each item. Copy them one at a time or
export the lot to CSV. This is the 11pm typing grind, deleted.

**Insights.** Realised vs. unrealised profit, sell-through, forecast accuracy, and which
categories actually pay. Computed locally with the same pure functions the server uses,
so the numbers can never disagree.

---

## Quickstart

```bash
git clone <this repo> && cd sourcerer
bash scripts/setup.sh          # checks the toolchain, installs, pulls Gemma 3
```

Then two terminals:

```bash
pnpm --filter @sourcerer/brain dev     # http://127.0.0.1:8787
pnpm --filter @sourcerer/web dev       # http://localhost:3000
```

Open `http://localhost:3000` on your laptop, or on your phone by hitting your laptop's
LAN address — and add it to your home screen. It is a PWA and it works offline.

**No keys are required.** With zero configuration you get local Gemma identification,
local heuristic pricing and your own sold history as the comps source. Everything else
is additive; see [`docs/KEYS.md`](docs/KEYS.md) for the exact list of optional keys and
what each one buys you. `GET /capabilities` always tells you the truth about what is
live right now, and the app surfaces it in Settings → *What runs where*.

### Requirements

| | |
|---|---|
| Node | 22.18+ |
| pnpm | 10+ (this repo is pnpm-only; no `package-lock.json`, no npm) |
| Ollama | 0.30+ (0.40+ recommended) with `gemma3:4b` and `gemma3:1b` |
| RAM | ~6 GB free for the 4B vision model. A GPU is nice; CPU works, just slower. |

---

## How it's built

```
sourcerer/
├─ packages/shared/        pure domain core — types, fee math, comps stats, verdict, zod, prompts
├─ apps/brain/             Hono + Mastra API, providers, workflow, durable jobs
│   ├─ core/steps.ts       the pipeline: identify → comps → price → verdict → listing
│   ├─ providers/          llm · comps · pricing · vector · voice · tracing (all optional, all swappable)
│   ├─ mastra/             tools, two agents, a 4-step typed workflow, LibSQL memory
│   └─ durable/            Temporal reprice workflow: activities, worker, client
└─ apps/web/               Next-generation PWA — scan, listings, insights
```

Three decisions worth explaining:

**The money math is not in the model.** `decideVerdict`, `maxOfferFor` and
`computeEconomics` live in `packages/shared` as pure, tested functions. A model estimates
one number — what the thing sells for — and the arithmetic that decides whether you buy
is deterministic, unit-tested, and identical in the server and the browser. A 4B model
should never be trusted with your margin, and it never is.

**Every integration degrades instead of failing.** Providers sit behind small
interfaces. `llmChat()` walks a provider chain; the comps layer falls back from live
market data to your own sold history; pricing falls back from TabPFN to
condition-adjusted comps; the UI falls back from live comps to on-device estimates. At
no point does a missing key produce a broken screen.

**Provenance is part of the data model, not the copy.** Every `Comp` is tagged
`sold` or `asking`; every comps result is tagged `live`, `local_history`, `cache` or
`estimate`; every scan returns a `ran[]` log of which provider executed each step and
whether data left the device. The UI renders those fields directly, which is why the
privacy claim is inspectable rather than aspirational.

### A real engineering decision: eBay retired its sold-comps filter

When this was built (October 2026), eBay had moved completed listings behind a login,
and the SerpApi `show_only=Sold` filter was retired with them. There is no sold-comps
engine to call.

The wrong move would have been to quietly return *asking* prices and label them "sold".
Instead: Sourcerer returns live asking prices tagged `kind: "asking"`, applies an
explicit, visible **`ASKING_TO_SOLD_FACTOR = 0.86`** haircut, says so in the UI, and puts
the whole thing behind a `CompsProvider` interface so a genuine sold-comps vendor
(Soldgraph, CompSniper, Trawl, or eBay Marketplace Insights) can drop in without
touching the pipeline. A reseller who catches you lying about sold prices never comes
back; a reseller who understands the haircut trusts you more.

---

## Partner technologies — and exactly how each one is used

Nothing here is a logo on a slide. Each entry is a real code path you can read.

| Technology | Where it lives | What it genuinely does |
|---|---|---|
| **Gemma 3** (featured) | `apps/brain/src/providers/llm.ts` | Multimodal identification from the photo, label reading, title/description writing. Runs locally via Ollama's native `/api/chat` with JSON-schema-constrained output, so a 4B model can be trusted to emit valid structured data. |
| **Mastra** | `apps/brain/src/mastra/*` | The agent runtime. Five tools that wrap the same deterministic functions the pipeline uses (an agent physically cannot invent a price), a sourcing-advisor agent with memory of your sold history, a listing-writer agent, a 4-step typed scan workflow, and LibSQL-backed storage. `mastra dev` opens the Studio. |
| **SerpApi** | `providers/comps.ts` | Live eBay asking prices for real market grounding, with the condition filter, free-shipping filter, result cap and a JSON restrictor so we only pull the fields we need. |
| **TabPFN** | `providers/pricing.ts` | A price + days-to-sell model trained on *your* sold history via the Prior Labs REST API (`prepare_train_set_upload → fit → predict`, quantile output). This is the piece that makes the offline number personal instead of generic. |
| **Sentry** | `providers/tracing.ts` | `@sentry/node` auto-instruments Mastra, producing `gen_ai.*` spans per agent step and model call with token counts, latency and cost. Input recording is off by default so photos never enter a trace. |
| **Temporal** | `durable/*` | A durable nightly reprice workflow: refresh comps for stale inventory with proper retry/backoff, survive a worker crash mid-run, and resume from workflow history. |
| **Tiger Data** | `providers/vector.ts` | Postgres + pgvector for "have I bought this before?" hybrid retrieval (reciprocal rank fusion) and duplicate detection. Local pgvector via compose for anyone who wants zero cloud. |
| **ElevenLabs** | `providers/voice.ts` | Speak a note while your hands are full; get a structured item back. Also speaks the verdict aloud. |
| **Backboard** | `providers/llm.ts` | The second brain: the same agent against open-weight models through one key. This is what makes the hosted demo possible on a machine with no GPU. |
| **Render** | `infra/render.yaml` | Blueprint for the hosted brain (Backboard-backed, because free tiers have no GPU) and the static PWA. |
| **.tech** | landing page | A real domain for the demo. |

`GET /capabilities` reports which of these are live, and the app's *What runs where*
sheet shows the user the same thing in plain language.

---

## Tests

```bash
pnpm test          # 18 tests over the money math and comps statistics
pnpm typecheck     # all three packages
```

The tests live in `packages/shared` and cover the parts that decide whether someone
makes money: fee arithmetic, the max-offer solve, the verdict thresholds, trimmed-mean
robustness to a single absurd listing, and clamping of hostile cost-model input.

---

## Configuration

Every key is optional. See [`docs/KEYS.md`](docs/KEYS.md) for the full table, where to
get each one, and what breaks (gracefully) without it. `apps/brain/.env.example` is the
authoritative list.

## Documentation

- [`docs/DESIGN.md`](docs/DESIGN.md) — the design-thinking pass: personas, the problem
  statement, the cut list, ten UX principles and the flows they produce.
- [`docs/KEYS.md`](docs/KEYS.md) — optional API keys, and what each unlocks.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the pipeline, the provider model,
  and the failure behaviour of every layer.

## License

MIT — see [`LICENSE`](LICENSE).
