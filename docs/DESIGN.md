# Sourcerer — Design Thinking & UX Plan

> **Sourcerer** — *Know what it's worth. Anywhere.*
> An offline-first, open-weight AI sourcing & listing copilot for resellers.

Challenge: Hacktoberfest Open-Source AI Challenge, Week 2 — **"Side Hustle"**.
Prompt: *build something with open-weight models or open-source AI that someone would actually pay for.*

---

## 1. Empathize — who is this actually for?

**Primary persona — "Maya, the weekend flipper."**
28, day job, flips vintage clothing + housewares on eBay/Mercari/Poshmark on weekends.
Sources at thrift stores, estate sales, garage sales, flea-market warehouses.

Her real loop today:

1. Spots an item on a rack. *Is this worth $8?*
2. Pulls out phone → opens a marketplace app → types a search → filters → squints → guesses.
3. Often there is **no signal** (basement, back room, warehouse, rural estate sale).
4. Buys on a hunch — or walks away from a $140 flip.
5. Photographs everything; at 11pm writes titles + descriptions for 20–30 items. *Brutal.*
6. Never really knows if she made money.

**Secondary — "Ray, the estate-sale pro."** Full-time, volume-driven. Cares about
throughput, margin discipline, and inventory that doesn't rot.

**Anti-persona.** Someone selling 3 items a year. Won't pay. We don't design for them.

**Observed pains (ranked by frequency × severity):**

| # | Pain | Frequency | Severity |
|---|------|-----------|----------|
| P1 | No comps when there's no signal | daily | severe |
| P2 | Decision paralysis at the rack | daily | severe |
| P3 | Listing-writing fatigue at night | daily | high |
| P4 | Dead inventory from bad price guesses | weekly | high |
| P5 | No idea of real profit | monthly | medium |
| P6 | "Did I already buy one of these?" | weekly | medium |

## 2. Define — the problem statement

> A reseller standing in front of an item, **often with no network**, needs to know
> **"what is this, what will it actually sell for, and should I buy it?"** in under ten
> seconds — and later needs the listing written without the 11pm typing grind.

**The critical insight.**

> The moment of decision is *offline and time-pressured*.

Any tool whose pricing requires a cloud round-trip **fails the job-to-be-done**.
That is why open-weight, on-device AI isn't a nice-to-have here — **it is the enabling
technology.** A closed API is architecturally disqualified from the core moment of value.

This is the honest answer to *"why does open innovation matter?"* — not ideology, but
physics: the basement has no bars.

## 3. Ideate — divergent, then converge

Generated ideas:

1. Camera-scan → comps → buy verdict. **core**
2. Voice capture while hands are full.
3. Margin math: platform fees + shipping + target margin → **max offer price**. **core**
4. Batch listing writer. **core**
5. Local "price memory": predict price from comp features. **core** *(a days-to-sell model was considered and not built)*
6. Similar-item / "have I bought this?" search. **core-lite**
7. Profit & sell-through dashboard. **core-lite**
8. Offline heuristics from the user's own sold history.
9. Auto photo cleanup / background removal. *cut*
10. Gamified "grail alerts". *cut*
11. Community comps network. *cut (needs network effects)*
12. Spoken verdicts / ElevenLabs narration.
13. Durable nightly reprice jobs.
14. Offline capture queue that syncs later. **core**

**Cut** anything that needs a social graph or a second user to be useful (#10, #11) or
that bloats capture time (#9). A one-person tool must be useful on the very first scan.

**The winning framing:**

> Sourcerer turns your phone into a scout that already knows the resale market —
> and it keeps working in a basement with no bars, because the brain is on your device.

## 4. UX principles (design thinking → concrete rules)

1. **Speed is the feature.** Verdict target ≤ 5s on CPU. Small model, short prompts,
   streamed stages. Never a blank spinner.
2. **Glanceable verdict.** One dominant signal: **BUY / MAYBE / PASS**, a big max-offer
   number, an expected multiple. **Never colour-only** — icon + label + number.
3. **Thumb-first.** One-handed at a rack: bottom nav, a large bottom action button,
   results as a bottom sheet. ≥44px targets. Reachable zone only.
4. **Honest uncertainty.** Offline = *estimate*, online = *comps*. Never dress one as the
   other. Show the basis and a confidence. Fake precision loses a reseller forever.
5. **Offline is a state, not an error.** A calm persistent chip: *"Offline · local model."*
   The app gets *quieter* offline, never broken.
6. **No dead ends.** Everything is editable and re-priceable; captures are local-first.
7. **Accessible.** WCAG AA contrast, dynamic type, SR labels, reduced-motion honoured,
   full keyboard path, no colour-only meaning.
8. **Privacy made visible.** "Your photos never leave this device" is surfaced in the UI
   and backed by an inspectable *local-run log*. The promise is provable, not marketing.
9. **Progressive disclosure.** Novice sees verdict + price. Pro expands fees, shipping,
   margin target, comps table.
10. **Delight with restraint.** One tactile verdict reveal + a whisper of haptics.
    No confetti spam.

## 5. Flows

**Sourcing (default, offline-capable):**
```
Scan tab → big camera button
  → capture        → staged progress: Reading · Comps · Pricing · Verdict
  → VERDICT CARD
       Item        Levi's 501 "Big E" selvedge, ~1966–71
       Verdict     ● BUY            (icon + label + colour)
       Max offer   $18
       Est. resale $120 – $160      ~4.2×
       Basis       12 live comps  ·  or  ·  local model · 87% conf
       Assumptions expand ▸ platform 13% + ship $8 + target 3×
     → [Save to queue]  [Re-price]  [Note / voice]
```

**Listings (synced later, batch):**
```
Listings tab → queued items → "Generate all"
  → drafts: title · description · price · category · keywords
  → copy / share / export CSV
```

**Insights:**
```
Insights tab → spend · revenue · profit · sell-through · best flips · margin trend
```

**Onboarding** ≤ 3 screens, ending in a real first scan pre-seeded with a demo item, so
first-run has instant value.

## 6. Visual direction

- **Voice:** confident, plain-spoken, a little wry. *"Never overpay in a basement again."*
- **Look:** warm, tactile, retro-mercantile — it's about *objects* and *prices*.
  Ink-dark and warm-paper light themes. **Monospace for prices** (price-tag feel).
- **Accent:** amber (attention), emerald (buy), slate (pass). All paired with icons.
- **Iconography:** line icons — tag, eye, label, bolt, signal-off.

## 7. Technology → partner-category mapping (only what is genuinely used)

The third column is the honest status at submission time. **We only enter categories in
the left column of the "Status" field** — anything marked *not entered* is listed here so
the reader can see what was considered and dropped, not because we claim it.

| Category | How it is genuinely used | Status |
|---|---|---|
| **Gemma** (featured) | Local multimodal inference: identify an item from a photo, read labels, write listings. Two sizes chosen by task: `gemma3:4b` for vision, `gemma3:1b` for cheap text paths. | **Implemented, verified end to end** — `docs/evidence/identify-results.json` |
| **Temporal** | Durable nightly reprice: refresh stale comps with retry/backoff, survive a worker crash, resume from history. | **Implemented, verified** — a `SIGKILL` mid-sweep is proven in `docs/evidence/temporal/` |
| **Mastra** | Agent runtime: five tools wrapping the deterministic pipeline functions, a memory-backed sourcing advisor, a listing-writer agent, a four-step typed scan workflow, LibSQL storage. | **Implemented** — workflow + tools + memory wired; the tool loop needs a tool-capable model beside Gemma (see below) |
| **SerpApi** | Live eBay *asking* prices for market grounding, with condition and free-shipping filters and a JSON restrictor. Sold comps no longer exist; see the README. | **Implemented, not verified with a live key** |
| **TabPFN** | Price fitted on the user's own sold history via the Prior Labs REST API; makes the offline number personal instead of generic. Sale speed is recorded on sold items but no engine models it. | **Implemented, not verified with a live token** |
| **Sentry** | `@sentry/node` spans around identify, comps and price, plus error capture; genAI input recording explicitly off, so photos never enter a trace. The framework's own `gen_ai.*` spans need `@mastra/observability`, which is not installed. | **Implemented, not verified with a live DSN** |
| **Tiger Data** | Postgres + pgvector for "have I bought this before?" hybrid retrieval and duplicate detection, with a local pgvector container as the zero-cloud option. | **Implemented, not verified with a live database** |
| **ElevenLabs** | Speak a note while your hands are full; hear the verdict read back. | **Implemented, not verified with a live key** |
| **Backboard** | The hosted brain path: the same agent against open-weight models through one key, which is what makes a GPU-less demo possible. | **Implemented, not verified with a live key** |
| **.tech domain** | Public landing page for the demo. | **Landing page deployed** to `sourcerer-ochre.vercel.app`; the `.tech` domain itself is not registered yet |
| **Render** | Blueprint for the hosted brain (Backboard-backed, because free tiers have no GPU) and the static PWA. | **Blueprint written**, not deployed |
| **GitHub Copilot** | — | *Not entered.* A dev tool, not a product integration. |
| **Entire** | — | *Not entered.* Not used. |

**A limitation this table exists to make visible:** Ollama reports Gemma 3's capabilities
as `completion, vision` — there is **no `tools`**. So the model that reads your photograph
cannot run the agent's tool loop, and a second small tool-capable open model
(`OLLAMA_TOOL_MODEL`, default `llama3.2:3b`) runs beside it. It is deliberately not a
reasoning model: Qwen 3 4B calls tools correctly and then spends minutes deciding to, while
a plain instruct model heeds the protocol and gets on with it. `GET /capabilities` reports
this as its own row with the fix in its `detail` string.

Everything above sits behind a **capability registry** with graceful degradation: with no
keys and no network the app still works end-to-end on local Gemma + local heuristics.
