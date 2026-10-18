# Sourcerer: the model reads the thrift find, plain code decides the price

*This is a submission for the [Hacktoberfest Open-Source AI Challenge, Week 2: Side Hustle](https://dev.to/challenges/hacktoberfest-week2-2026-10-12).*

---

## What I Built

The moment this is for: a woman standing in a thrift store basement holding a jacket she
doesn't recognise, with no signal on her phone, and about ten seconds to decide whether
eight dollars is a good idea.

She does what everyone does. Opens a marketplace app, types a guess, waits, squints at a
dozen listings that may or may not be the same thing, and buys on a hunch. Or doesn't.
She'll never find out which was right.

Sourcerer answers one question instead: **what is the most I should pay, right now?**
Not "what is it worth" — that's a search result. This is a ceiling, after fees, shipping
and the margin she actually wants.

It runs on her own machine. Photograph the item (or type what you see if the light is
bad), and a local multimodal model reads it:

```
Levi's 501 "Big E" selvedge denim jacket, size 42, small hole at cuff
```

and nine seconds later you get:

```
VERDICT      ● BUY
MAX OFFER    $35
EST. RESALE  $133   ($127 – $140)
PROFIT       $94 after eBay fees and shipping
BASIS        1 item from your own sold history
```

Type a different price on the tag and the whole thing re-prices instantly, with the
network off, because the arithmetic is not a model call. That number is the product.
Everything else is scaffolding around it.

**Who pays for this.** A weekend flipper doing 20–40 items a month. She is not
optimising a warehouse; she is trying to stop buying stuff that sits in a tote for a
year, and to stop walking past a $140 flip because she wasn't sure. The app also writes
her listings, which is the other half of the job — the 11pm typing grind of titles and
descriptions for a pile of items she bought that morning.

---

## Demo

The demo video is an unedited run of the real thing on this laptop:
**[`docs/evidence/sourcerer-demo.webm`](docs/evidence/sourcerer-demo.webm)** — capture →
verdict → max offer → listing draft, with the browser's network tab quiet.

Screenshots are in [`docs/evidence/screenshots/`](docs/evidence/screenshots/), generated
by [`scripts/capture-evidence.ts`](scripts/capture-evidence.ts), which drives the actual
app in a real browser and records the video. They are not mockups; they are the output of
that script.

Hardware, for every timing claim in this post: 8-core CPU, 15.4 GB RAM, an NVIDIA
GTX 1650 with 3.6 GB of VRAM — enough to hold part of the model, not all of it, so most
inference runs on CPU. No cloud GPU, no paid inference, at any point.

---

## Code

**github.com/…/sourcerer** — MIT.

`pnpm install && bash scripts/setup.sh`, then two terminals
(`pnpm --filter @sourcerer/brain dev`, `pnpm --filter @sourcerer/web dev`). No API keys
are required to see the core loop work.

---

## How I Built It

### The finding: the model reads, the arithmetic decides

I started by asking a small model to do the whole job — look at the item *and* tell me
whether to buy it. It was bad at the second half in a way that is hard to notice and
expensive to ignore. Ask a 4B model for a verdict and you get a confident, plausible,
arithmetically wrong answer, because the thing you actually need is a solve:

```
max_offer = (resale − resale·fee − shipping − supplies) / target_multiple
```

A language model is the wrong instrument for that. It is the right instrument for
looking at a blurry photo of a label in bad light and saying "that's a Pendleton board
shirt, and it's been shrunk."

So the system is split, permanently:

| | Who does it | Why |
|---|---|---|
| Read the item from a photo | **Gemma 3 4B, locally** | Fuzzy, tolerant of bad light, occasionally wrong in interesting ways. Perfect fit. |
| Name the keywords a reseller would search | **Gemma 3** | It knows that a "Big E" is a thing. |
| Price the market | **Live listings, or your own sold history** | Ground truth beats generation. |
| Decide the money | **Plain functions** — `packages/shared/src/economics.ts` | Deterministic, unit-tested, identical offline. |

The consequence is that the verdict the browser shows you offline and the verdict the
server computes online are *the same code*. [`decideVerdict`](packages/shared/src/economics.ts)
is pure and takes no I/O, so a reseller typing a price in a dead zone gets an answer that
agrees with the server's to the cent. That is not a nicety; it's why the tool can be
trusted with money.

### The thing that moved accuracy most was not the prompt

The honest engineering story is that I expected prompt work to be the lever and it
mostly wasn't.

Every experiment in this section is the same 30 hand-labelled items run through four
configurations, with
[`apps/brain/eval/run-identify.ts`](apps/brain/eval/run-identify.ts). Ground truth is
what I wrote in the `text` field — a brand and an item type — so the scoring is
mechanical and every failure below can be checked by reading the row. Full output:
[`docs/evidence/identify-results.json`](docs/evidence/identify-results.json).

<<EVAL_TABLE>>

Two things worth pulling out of that table.

**Constrained decoding beat prompt engineering.** The biggest single jump came from
passing a JSON Schema to Ollama's `format` field, which makes the sampler *structurally
unable to* emit an invalid object. Same prompt, same model, same temperature — the only
change was refusing to accept the answer any other way. A 4B model asked politely for
JSON complies about half the time. A 4B model that cannot produce anything else complies
every time. That one line is the difference between a demo and a tool.

**The prompt that mattered was the one about refusing to guess.** The failure mode that
actually costs a reseller money isn't a wrong price, it's a *fabricated brand*. Show this
model an unmarked mid-century chair and it will tell you it's an Eames. Correcting that
required telling it, in the prompt, that an unbranded Eames-style chair is not an Eames
and that `brand` should be `null` when there's no mark.

### The failure I'm leaving in

Item 21 in the labelled set is "Eames style lounge chair, rosewood, no labels anywhere."
Ground truth: **no brand**.

On the weakest prompt, the model named a designer. On the version I ship, it didn't — but
it also, on one run, hedged into `"brand": "Unbranded"` and put *"appears to be Eames-style,
but no maker's mark visible"* in `caveats`, which is exactly the behaviour I wanted and
the reason the schema has a `caveats` field at all.

I kept the item in the set, and I kept the row in the evidence file, because the
interesting number isn't the accuracy — it's that the model's error direction is
*predictable*. It doesn't fail randomly; it fails optimistically, on unbranded goods that
resemble something valuable. That is also the exact population of items a flipper is most
likely to overpay for. So the mitigation isn't "get a better model", it's the UI: when
confidence is below 0.5 the verdict can never say BUY, and the reason string says so.

### A real bug from a real run: Gemma 3 cannot call tools

I built the sourcing advisor as a Mastra agent with five tools — search comps, estimate a
price, do the fee math, save the item, look up similar past purchases — each wrapping the
*same deterministic function* the pipeline uses, so the agent physically cannot invent a
number it would have to fetch.

Then it failed on the first request:

```
$ curl -s localhost:8787/advisor -d '{"message":"...Ludwig Acrolite snare for $150..."}'
{"error":"registry.ollama.ai/library/gemma3:4b does not support tools"}

$ ollama show gemma3:4b
  capabilities: completion, vision
```

No `tools`. Gemma 3 in Ollama will do vision and completion and nothing else, so the
model that reads your photograph is not the model that can run an advise loop.

The fix was to stop pretending one model does everything:

```ts
// Ollama reports Gemma 3 as `completion, vision` — no tool calling.
// The agent loop gets a small tool-capable open model instead.
model: toolModel(),   // qwen3:4b
```

Gemma keeps the jobs it is genuinely good at — reading items, writing listings — and the
agent loop runs beside it on a tool-capable open model. `GET /capabilities` now reports
the tool model separately, with `Run: ollama pull qwen3:4b (Gemma 3 cannot call tools)`
as its detail string when it's missing, and the advisor route degrades to a deterministic
answer built from the same numbers rather than returning a 500.

This is the kind of thing that only shows up when you run the thing, and it's the reason
I'd rather ship a four-model pipeline that works than a one-model pipeline that's elegant
in a diagram.

### The comps problem I couldn't engineer around

eBay moved its completed listings behind a login, and the search API's sold filter went
with them. There is no free source of real sold prices for eBay any more.

The tempting move — and by far the most common one — is to quietly return asking prices
labelled as sold. A reseller who finds out you did that never trusts another number you
show them.

So instead: every comp is tagged `kind: "asking"`, the UI says *asking* on every row, and
prices are multiplied by a visible, named constant:

```ts
export const ASKING_TO_SOLD_FACTOR = 0.86;  // labelled everywhere it is applied
```

A 14% haircut is not a sold price. It is a defensible range, presented as a range, with
the reasoning attached. The whole thing sits behind a `CompsProvider` interface so a real
sold-comps vendor drops in without touching the pipeline.

### Numbers

- **18 unit tests pass**, `pnpm test`. They cover the parts that decide whether someone
  makes money: the fee arithmetic, the max-offer solve, the verdict thresholds, and
  trimmed-mean robustness to a single seller asking 10× the going rate.
- **Warm identification: ~8–9 seconds** on this CPU for a typed description, ~30–40 s for
  a photo, because the vision encoder is doing more work. The first scan after a restart
  pays ~75 s of weight loading. `keep_alive: 30m` means you pay that once per session, not
  once per item — which matters when you scan a dozen things in a row at a sale.
- **Zero bytes uploaded** on a local scan. The photos are downscaled on-device before
  anything else happens, and with live comps off there is nothing to upload *to*.

---

## Why Does Open Innovation Matter?

The glib answer is "privacy," and a third of this challenge's field has already said it,
so let me be specific instead about the part that isn't ideology.

**The decision happens where there is no signal.** Not "sometimes." *Characteristically.*
Basements, back rooms, barns, rural estate sales, the far corner of a flea market
warehouse. Any architecture that needs a round trip to price an item fails at the exact
moment the product exists for. That's not a cost problem you can optimise your way out
of — it's a physics problem, and the only fix is to put the model where the decision is.

Being open-weight is what makes that possible at all. I can ship a 3.3 GB vision model
that runs on a five-year-old laptop's CPU *because* it's open weights: no per-call
pricing, no rate limit, no vendor that can deprecate the model version my prompts depend
on, and no terms of service standing between a user and the file on their own disk.

**What it costs to run.** Zero, per item, forever. A closed vision+pricing API at ~$0.01
per call sounds trivial until you're a flipper scanning forty items at a sale, six sales
a month — call it $30/year for the privilege of a round trip. The local model costs
electricity. That's what makes a $5/month price *possible* while staying honest about
where the margin is.

**Where a closed model would genuinely be better.** I'll say this plainly: a frontier
model has a larger world-knowledge base for genuinely obscure collectibles, and no
quantisation loss on fine label detail. This 4B model is confident about Levi's and
Pyrex and shaky on a mid-century chair with no marks — which is exactly the row I left in
the table above. If you're appraising a single $4,000 item, call a proper model. Sourcerer
optimises for the other case: forty $12 items and ten seconds each.

**Honest limits.**

- It is *slow on CPU*. Nine seconds warm, forty on the first photo. A laptop with an
  integrated GPU does better; mine offloads part of the model and no more.
- **The sold-comp data does not exist for free**, and I am not going to pretend an asking
  price is a sold price. The 0.86 haircut is a judgement call, labelled as one.
- **The price model is empty on day one.** With no sold history it falls back to
  condition-adjusted comps and a deliberately pessimistic guess, so the first week's
  verdicts lean PASS.
- **The advisor degrades** whenever the tool model isn't installed. On a machine that only
  has Gemma, everything *except* the conversational advisor works — the app tells you
  which, rather than failing quietly.
- **Untested at scale.** The largest eval here is 30 items, labelled by one person, on one
  machine, in one afternoon.
- **Not typed for the browser's model.** The on-device fallback used when the brain is
  unreachable is heuristics, not Gemma-in-the-tab. That's a real gap and the obvious next
  piece of work.

---

## Prize Categories

- **Best Use of Gemma** — Gemma 3 4B runs locally through Ollama's native API to read
  items from photos and write listings, with JSON-schema-constrained decoding; the 1B
  variant takes the cheap text-only paths so a title costs a second, not a model load.
- **Best Use of Mastra** — the agent runtime: five tools wrapping the deterministic
  pipeline functions (so the agent cannot invent a price), a sourcing advisor with memory,
  a listing-writer agent, and a four-step typed scan workflow composed from the same
  functions the HTTP route calls.
- **Best Use of SerpApi** — live eBay listing search with the condition filter, free-
  shipping filter, result cap and a JSON restrictor to pull only the fields needed.
- **Best Use of TabPFN** — a price and days-to-sell model fitted on the user's own sold
  history via the Prior Labs REST API, which is what makes the offline number personal
  rather than generic.
- **Best Use of Sentry Agent Tracing** — `@sentry/node` auto-instruments Mastra, emitting
  a `gen_ai.*` span per agent step with tokens and latency; input recording is off so
  photos never enter a trace.
- **Best Use of Temporal** — a durable reprice workflow that refreshes stale comps with
  explicit retry policy and resumes from history after a worker crash.
- **Best Use of Tiger Data** — Postgres + pgvector for "have I bought this before?" hybrid
  retrieval, with a local pgvector container for users who want no cloud at all.
- **Best Use of ElevenLabs** — dictate an item while both hands are full, or hear the
  verdict read back.
- **Best Use of a .tech Domain** — a landing page for the demo at the domain.
- **Best Use of Backboard** — the second brain: the same agent against open-weight models
  through one key, which is what makes a GPU-less hosted demo possible.

*Every category listed above has a code path in the repo; none of them is a logo on a
slide. Anything not demonstrated above is not listed.*
