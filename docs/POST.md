---
title: "Sourcerer: the model reads the thrift find, plain code decides the price"
published: true
description: "An offline-first sourcing copilot for resellers. A local open-weight model reads the item; plain arithmetic decides the most you should pay."
tags: devchallenge, hf26challenge, ai, opensource
cover_image: https://raw.githubusercontent.com/ItsPriyamSri/sourcerer/master/docs/media/cover.png
---

*This is a submission for the [Hacktoberfest Open-Source AI Challenge, Week 2: Side Hustle](https://dev.to/challenges/hacktoberfest-week2-2026-10-12).*

![An animated screen recording of the app running. A capture screen with a photo and an asking price; four pipeline stages completing in sequence; then a verdict card reading PASS with a MAX OFFER of $20.22 and the note that the asking price sits 197% over the ceiling; and finally the same card re-priced by hand while the model stays untouched.](https://raw.githubusercontent.com/ItsPriyamSri/sourcerer/master/docs/media/demo.hero.gif)

> **What it is:** an offline-first sourcing copilot for resellers. Photograph an item, or type what you see; a local open-weight model reads it, and plain TypeScript decides the most you should pay — after eBay's fees, shipping, supplies and the margin you actually want. No internet, no API keys, no per-scan cost.
>
> **Short on time?** The [verdict card](#demo) is the product in one screen; the [engineering](#how-i-built-it) is underneath it. Every claim points at a file you can open — **[landing page](https://sourcerer-ochre.vercel.app)** · **[source](https://github.com/ItsPriyamSri/sourcerer)** · [`docs/KEYS.md`](https://github.com/ItsPriyamSri/sourcerer/blob/master/docs/KEYS.md) has the live-verification status of every keyed integration in one table.

---

## What I Built

The moment this is for: a woman standing in a thrift store basement holding a jacket she doesn't recognise, with no signal on her phone, and about ten seconds to decide whether eight dollars is a good idea.

She does what everyone does. Opens a marketplace app, types a guess, waits, squints at a dozen listings that may or may not be the same thing, and buys on a hunch. Or doesn't. She'll never find out which was right.

Sourcerer answers one question instead: **what is the most I should pay, right now?** Not "what is it worth" — that's a search result. This is a ceiling, after fees, shipping and the margin she actually wants.

It runs on her own machine. Photograph the item (or type what you see if the light is bad), and a local multimodal model reads it:

```
Levi's 501 "Big E" selvedge denim jacket, size 42, small hole at cuff
```

and a few seconds later you get:

```
VERDICT      ● BUY
MAX OFFER    $35.32
EST. RESALE  $133.40   ($126.73 – $140.07)
AT $12       $93.96 profit, after eBay fees, shipping and supplies
BASIS        6 items from your own sold history
```

Every number in that block was computed by `packages/shared`, not by the model: eBay's 13.6% plus $0.30 payment fee on the $133.40 sale, $8 shipping, $1 supplies, a net of $105.96, divided by the 3× multiple she wants to make, which is where $35.32 comes from.

Type a different price on the tag and the whole thing re-prices instantly, with the network off, because the arithmetic is not a model call. That number is the product. Everything else is scaffolding around it.

**Where it actually runs.** No phone holds a 3.3 GB vision model, so Gemma lives on the laptop or home machine she already owns. The phone is the camera and the screen; the two talk over her own network. That covers the case that matters: the basement has no signal, and the laptop is in the bag. With neither machine reachable the app still boots from the service-worker cache and prices from her own sold history, tagged `estimate` so it can never pass for a live comp. The browser-only fallback is honest about what it is — heuristics, not the model — and it says so on screen rather than guessing silently.

**Who pays for this.** A weekend flipper doing 20–40 items a month. She is not optimising a warehouse; she is trying to stop buying stuff that sits in a tote for a year, and to stop walking past a $140 flip because she wasn't sure. The app also writes her listings, which is the other half of the job — the 11pm typing grind of titles and descriptions for a pile of items she bought that morning.

---

## Demo

Four screenshots show the flow in the order you would use it. If you want the whole thing unedited, **[the webm is a single run on this laptop](https://github.com/ItsPriyamSri/sourcerer/blob/master/docs/media/sourcerer-demo.webm)**: capture screen → all four pipeline stages → the verdict → the tag price changed by hand and the verdict re-priced with the model untouched → the run log opened → Insights.

![A phone screenshot of Sourcerer's verdict card for a Levi's 501 Big E Selvedge Denim Jacket. The header chips read Online, Local · gemma3:4b and heuristic pricing, and the item chips read Jeans and good. A green check and the word BUY sit above two panels: MAX OFFER $35.32, and RESALE $133.40 with a range from $126.73 to $140.07 — above "$105.96 net ÷ 3× target = $35.32" and "Asking $12 sits 66% under your ceiling." Below them a range bar marks the comps median; a chip reads "your sold history", a second reads "57% confidence", and the basis line reads "6 similar items you have already sold. Real realised prices, on this device." In the rail beneath, the asking price is $12, the marketplace is eBay, and the profit at that price is $93.96 (8.8×).](https://raw.githubusercontent.com/ItsPriyamSri/sourcerer/master/docs/media/verdict.buy.light.png)

*The verdict card. One dominant signal: the maximum offer in the largest type on the screen, the resale range it came from, and a chip that says where the number came from. The asking price is editable and the whole card re-prices on-device as you type. Resale is the comps median adjusted for condition — these comps are `good`, so ×0.92 — which is why it sits just under the raw median in the panel below.*

The run log is the part worth pausing on. It is not an overlay; it is a field in the scan response, and it reads *"Nothing in this scan left your device."* next to a per-stage list of which provider executed each step.

![A phone screenshot of an expanded panel headed "What ran where", reading "Nothing in this scan left your device. The photo, the identification and the pricing all ran locally." Under it, three rows — Identify (ollama:gemma3:1b, on this device, 6047 ms), Comps (local_history, on this device, 6 listings, 2 ms) and Price (comps_median, on this device, $133.40 at 0.57 confidence, 1 ms) — each marked with a monitor icon rather than a cloud, and a total of 6051 ms. Above the panel the rail records the same run: asking price $12, profit $93.96, multiple 8.8×, net $105.96, fees $18.44.](https://raw.githubusercontent.com/ItsPriyamSri/sourcerer/master/docs/media/ranlog.light.png)

*What ran where. Every scan records which provider executed each stage, how long it took, and whether anything left the device, which makes the privacy claim checkable rather than aspirational: it is a field in the response. There are four stages in the workflow and three rows here, because the verdict stage is arithmetic — it calls no provider and so has nothing to report. The chip in the header names the brain's primary model — `gemma3:4b`, the vision default — while each row names the model that actually ran that stage; text-only paths deliberately use the 1B, which is why Identify says `gemma3:1b`.*

![An expanded Comparables panel headed "Comparables (6)": all six are the user's own sold history, each row tagged sold, priced from $136 to $155, under summary tiles reading low $139, median $145, mean $145.17 and high $151.50, with a note that the mean is trimmed 10%. The panel states "6 similar items you have already sold. Real realised prices, on this device." and records that it searched "Levi's 501 Big E".](https://raw.githubusercontent.com/ItsPriyamSri/sourcerer/master/docs/media/comps.expanded.light.png)

*The comparables, each one tagged with where it came from. Every row here is a real price this user realised, not an asking price scraped from a stranger.*

![A dark-theme phone screenshot taken with the browser's network disabled: the header chips read "Offline · local only" and "Brain asleep". The app says "Your brain isn't running. I'll price from your own sold history instead — open Settings to point me at it.", and the capture screen — photograph, describe, asking price — is fully rendered from the service-worker cache.](https://raw.githubusercontent.com/ItsPriyamSri/sourcerer/master/docs/media/offline.shell.dark.png)

*Network genuinely off, taken in the browser with the connection disabled. The chip says so, the brain is unreachable, and the app still boots and still offers the capture screen out of the service-worker cache — because a dead spot in a charity shop is where this thing is meant to be used.*

All 21 screenshots, with captions and alt text, are in [`docs/media/`](https://github.com/ItsPriyamSri/sourcerer/tree/master/docs/media), catalogued in [`docs/media/CAPTIONS.md`](https://github.com/ItsPriyamSri/sourcerer/blob/master/docs/media/CAPTIONS.md).

Every screenshot and the video were produced by [`scripts/capture-evidence.ts`](https://github.com/ItsPriyamSri/sourcerer/blob/master/scripts/capture-evidence.ts), which drives the actual app in a real browser against a real brain, seeds the sample data from the committed fixture first so two runs produce the same frames, and writes the screenshots and the video in one pass. They are not mockups and they are not retouched. The cover image is the one exception: it is composed from one of those captures, not drawn.

The public landing page is live at **<https://sourcerer-ochre.vercel.app>** — the same claims in one page, with its headline numbers read out of the eval's JSON at capture time so they cannot drift from the evidence the way a hand-typed statistic would.

That script also found a bug worth admitting to: the asking price you typed on the capture form was being silently discarded by the verdict card, because the card kept a private copy of the price, initialised to zero. Every screenshot in that first capture came back priced as if the item were free. It survived every typecheck, every build and the entire test suite, and it was visible the moment something rendered the screen and wrote the result to a file. A screenshot is a test you cannot lie to.

Hardware, for every timing claim in this post: 8-core CPU, 15.4 GB RAM, an NVIDIA GTX 1650 with 3.6 GB of VRAM — enough to hold part of the model, not all of it, so most inference runs on CPU. No cloud GPU, no paid inference, at any point.

---

## Code

https://github.com/ItsPriyamSri/sourcerer

MIT. Clone and run: `pnpm install && bash scripts/setup.sh`, then two terminals —
`pnpm --filter @sourcerer/brain dev` and `pnpm --filter @sourcerer/web dev`. No API keys
are required to see the core loop work.

If you only read two files: the [README](https://github.com/ItsPriyamSri/sourcerer#readme)
says what each piece is for and which technology does which job, and
[`docs/ARCHITECTURE.md`](https://github.com/ItsPriyamSri/sourcerer/blob/master/docs/ARCHITECTURE.md)
covers the pipeline and how every layer behaves when a provider is missing.

---

## How I Built It

### The finding: the model reads, the arithmetic decides

I started by asking a small model to do the whole job — look at the item *and* tell me whether to buy it. It was bad at the second half in a way that is hard to notice and expensive to ignore. Ask a 4B model for a verdict and you get a confident, plausible, arithmetically wrong answer, because the thing you actually need is a solve:

```
max_offer = (resale − resale·fee − shipping − supplies) / target_multiple
```

A language model is the wrong instrument for that. It is the right instrument for looking at a blurry photo of a label in bad light and saying "that's a Pendleton board shirt, and it's been shrunk."

So the system is split, permanently:

| | Who does it | Why |
|---|---|---|
| Read the item from a photo | **Gemma 3 4B, locally** | Fuzzy, tolerant of bad light, occasionally wrong in interesting ways. Perfect fit. |
| Name the keywords a reseller would search | **Gemma 3** | It knows that a "Big E" is a thing. |
| Price the market | **Live listings, or your own sold history** | Ground truth beats generation. |
| Decide the money | **Plain functions** — `packages/shared/src/economics.ts` | Deterministic, unit-tested, identical offline. |

The consequence is that the verdict the browser shows you offline and the verdict the server computes online are *the same code*. [`decideVerdict`](https://github.com/ItsPriyamSri/sourcerer/blob/master/packages/shared/src/economics.ts) is pure and takes no I/O, so a reseller typing a price in a dead zone gets an answer that agrees with the server's to the cent. That is not a nicety; it's why the tool can be trusted with money.

### What the two changes actually did

The honest engineering story is that I expected prompt work to be the lever and it mostly wasn't.

Every experiment in this section is the same 30 hand-labelled items run through four configurations, with [`apps/brain/eval/run-identify.ts`](https://github.com/ItsPriyamSri/sourcerer/blob/master/apps/brain/eval/run-identify.ts). Ground truth is what I wrote in the `text` field — a brand and an item type — so the scoring is mechanical and every failure below can be checked by reading the row. Full output: [`docs/evidence/identify-results.json`](https://github.com/ItsPriyamSri/sourcerer/blob/master/docs/evidence/identify-results.json).

<!-- EVAL_TABLE_START -->
| Configuration | Emitted parseable JSON | Brand correct | Type correct | **Both** | Invented a brand | Median |
|---|---|---|---|---|---|---|
| `v1` prose prompt, no schema | 100% | 97% | 100% | **29/30** | 1/4 | 8.8 s |
| `v2` same prompt, + JSON schema | 100% | 100% | 100% | **30/30** | 0/4 | 8.6 s |
| `v3` full rules prompt, + schema | 100% | 100% | 100% | **30/30** | 0/4 | 8.5 s |
| `v4` v3 + anti-invention rules | 100% | 100% | 100% | **30/30** | 0/4 | 8.3 s |

Model `gemma3:4b`, temperature 0.1, 30 items, one machine, one afternoon.
<!-- EVAL_TABLE_END -->

**Both levers were different levers than I expected.** I built the JSON-extraction path braced for a fight — fenced code blocks, prose wrappers, objects truncated mid-string — and the naive prompt produced a parseable object on the first try, **30 times out of 30**, by wrapping it in a `json` fence the extractor already handled. Prompt craft bought exactly zero points of parseability on this model, because there was nothing to buy. The prompt did one job, the schema did another, and neither of them was "accuracy". The single row that failed is where that becomes concrete.

### The failure I am leaving in

Item 21 in the labelled set is *"Eames style lounge chair, rosewood, no labels anywhere."* Ground truth: **no brand.** Same model, same 30 items, same temperature — only the prompt and the schema change:

| Configuration | `brand` field | `confidence` | `caveats` |
|---|---|---|---|
| naive prose prompt, no schema | `"Eames (Style)"` | **0.95** | — |
| same prompt, + JSON schema | *(omitted)* | 0.95 | — |
| + full rules prompt | *(omitted)* | 0.85 | — |
| + explicit anti-invention rules | *(omitted)* | **0.6** | *"No visible labels, condition is based on visual assessment only."* |

The first row is why this project is shaped the way it is. The model did not produce garbage; it produced a clean, well-formed, **confident** record with a fabricated brand in a machine-readable field. Nothing about it looks wrong, it would have become a listing title and the basis of a price, and the person reading it at the counter had no reason to doubt it. It failed on *exactly one item* — the other three unbranded items came back `"Unknown"` — so the error is not diffuse but **optimistic, on unbranded goods that resemble something valuable**: exactly what a flipper overpays for, and the error they are least likely to catch.

Two fixes, two different jobs:

- **The schema removed the fabrication.** `brand` is typed `["string", "null"]`, so "I don't know" became a legal answer and the model took it. Inventions on the set: **1 → 0**.
- **The prompt changed calibration, not accuracy.** Accuracy was already 100% by the second column. What the anti-invention rules moved was stated confidence on the one item that is unverifiable by design — 0.95 to 0.6 — and they made the model volunteer a caveat without being asked for one. A better answer for being the same answer, because it tells you how far to trust it.

**What is still wrong.** In column four the title still reads *"Eames Lounge Chair Rosewood"*. The doubt left `brand`, which carried the most weight, but the title still names a designer — and the title is what gets pasted into a listing. The money is unaffected, because the verdict is anchored to comps rather than the title, but the listing writer should refuse a designer's name whenever `brand` is null, and that is the next thing I would build. My scorer does not penalise an overclaiming title either: it catches `"Eames (Style)"` mechanically and cannot catch `"Eames Lounge Chair"`, and I left it that way rather than tuning it until the number looked better.

Two notes on defence in depth. Below 0.5 confidence the verdict can never say BUY, whatever the arithmetic says — but on this item the model settled at 0.6, so the caveat is what protects the user here, not the threshold. And the risk was never in the price: the arithmetic is pure, deterministic and unit-tested, which is exactly why it is allowed anywhere near the money. The risk was one string field from a 4B model, and the fix for the worst version of it turned out to be a type annotation, not a paragraph of instructions.

### One model reads, a second one calls tools

The sourcing advisor is a Mastra agent with five tools — search comps, estimate a price, do the fee math, save the item, look up similar past purchases — each wrapping the *same deterministic function* the pipeline uses, so the agent physically cannot invent a number it would have to fetch.

It runs on a different model from the one that reads the photo, and that is a capability boundary rather than a surprise. Ollama reports Gemma 3's capabilities as `completion, vision`: vision is exactly what makes it the right reader, and tool calling is simply not part of the model.

```
$ ollama show gemma3:4b
  Capabilities
    completion
    vision
```

So the agent loop runs beside it on `llama3.2:3b` — `tools`, no reasoning mode, and the same money question answered in about two seconds:

```ts
// Gemma 3 reports `completion, vision`; the agent needs `tools`.
model: toolModel(),   // llama3.2:3b
```

The reasoning models are the obvious candidate and were the wrong trade here. Qwen 3 4B calls tools correctly, but it deliberates before every step: roughly 35 KB of `thinking` per step across a six-step budget is over four minutes to answer a question about a $215 sale. The arithmetic was right; the wait was not survivable. Two details follow from the same boundary — `think` is read from the model's own reported capabilities rather than hard-coded, because a non-reasoning model rejects the request outright rather than ignoring the flag, and the tool schemas coerce, because this model sends `{"resalePrice":"215"}`, a string where a number belongs.

Gemma keeps the jobs it is good at: reading items and writing listings. `GET /capabilities` reports the tool model separately, and the advisor route degrades to a deterministic answer built from the same numbers rather than returning a 500.

### The money sentence is not the model's to write

The loop worked and the transcript was clean, which is when I noticed the same question giving different answers. A model that small will restate your numbers correctly and then invert the conclusion: asked about a $150 snare with a $58.82 ceiling, one run said the asking price was *below* the ceiling and the verdict was BUY — both numbers right, the comparison backwards. Three runs, three verdicts:

```
run 1  PASS. Most I would pay is $58.82.
run 2  The item should be bought.
run 3  The reseller should pass on the snare drum.
```

A number a language model paraphrased is a number you cannot audit, and auditable numbers are this app's whole claim. So the money sentence is no longer the model's to write: `feeMath` composes the reply — verdict, ceiling, profit, every figure straight out of the same `decideVerdict()` the scan screen uses — and the route sends that instead of the model's version. The same question, five times, one answer, character for character:

```
PASS. Most I would pay is $58.82. At $150 you would make $26.46 if it resells at $215.
```

What is left to the agent is what it is genuinely good at: understanding the request and calling the tool with the right arguments. The three-turn transcript in [`docs/evidence/agent-transcript.json`](https://github.com/ItsPriyamSri/sourcerer/blob/master/docs/evidence/agent-transcript.json) is the proof rather than the assertion — *"I'm shipping cross-country, so put shipping at $35"* becomes `shippingCost: 35`, the ceiling moves from $58.82 to $49.82, and the third turn still knows what the first one was about. The advisor picks the tool. It does not get to pick a number.

### The comps problem I couldn't engineer around

eBay moved its completed listings behind a login, and the search API's sold filter went with them. There is no free source of real sold prices for eBay any more.

The tempting move — and by far the most common one — is to quietly return asking prices labelled as sold. A reseller who finds out you did that never trusts another number you show them.

So instead: every comp is tagged `kind: "asking"`, the UI says *asking* on every row, and prices are multiplied by a visible, named constant:

```ts
export const ASKING_TO_SOLD_FACTOR = 0.86;  // labelled everywhere it is applied
```

A 14% haircut is not a sold price. It is a defensible range, presented as a range, with the reasoning attached. The whole thing sits behind a `CompsProvider` interface so a real sold-comps vendor drops in without touching the pipeline.

### Durable work, and a crash I can prove cost nothing

The job nobody watches is the one where durability stops being a slide and starts being a line item: comps go stale, and re-pricing a few hundred inventory items should not be something a reseller has to sit and wait for.

`apps/brain/src/durable/` is that job on Temporal. Each item is two activities — refresh its comps, then apply the new price — with an explicit retry policy on the flaky search call and a `paceMs` delay between items. **The pacing is not a demo trick.** It is a rate limit for a paid search API, because a 200-item sweep will otherwise get you throttled; it also happens to make the crash window wide enough to aim at, which is how the number below was produced.

So I killed it. Mid-sweep, `SIGKILL`, no cleanup, no graceful shutdown — the way a laptop dies when someone shuts the lid at a sale:

```
items in the sweep                          : 12
worker #1 refreshed before the SIGKILL      : 3
worker #2 refreshed after the restart       : 9
distinct items across both worker logs      : 12
items refreshed twice (should be 0)         : 0
activity executions in the history          : 24  (expected 24 = 2/item)
workflow status right after the kill        : RUNNING
final result reported by the client         : done: 12/12 refreshed, 0 failed

PASS — the SIGKILL cost the run time and nothing else.
```

What makes that table worth reading: a second worker replays the workflow history, sees that the first three activities already completed, and starts at item four. The number that matters is `items refreshed twice: 0` — no item was priced twice, so the crash cost wall-clock time and nothing else. `bash scripts/temporal-durability-demo.sh` reproduces the whole thing, including the kill; the raw worker and client logs are committed in [`docs/evidence/temporal/`](https://github.com/ItsPriyamSri/sourcerer/tree/master/docs/evidence/temporal).

### Numbers

Every figure here is measured on the machine described above, and each one is traceable to a file in the repository.

- **101 unit tests pass** (`pnpm test`, no model, no network): eighteen in `packages/shared` covering the parts that decide whether someone makes money — eBay's fee arithmetic, the max-offer solve, the verdict thresholds, trimmed-mean robustness to one seller asking ten times the going rate — and eighty-three in `apps/brain`, mostly pinning the seams where a model meets code: the JSON salvage that stops a prose answer taking a whole scan down, the verdict wrapper, the exact request sent to each keyed integration, and what the local matcher is allowed to count as a comparable (this is what stopped the Woolrich parka pricing the Pendleton shirt).
- **Six integrations are demonstrated end to end; three more were exercised as far as their free tiers allowed.** Gemma and Temporal are described above; **SerpApi** returned 51 live eBay listings for a brass narwhal bottle opener, raw response committed at `docs/evidence/serpapi-live.json`; **pgvector** ran in a local container with no cloud account, where 32 items were embedded through the real pipeline and *"something to cook with in the kitchen"* came back with Pyrex mixing bowls and a Griswold skillet, with no shared keywords with the query — which is the entire point of a vector index; **Sentry** confirmed delivery with the SDK's own receipt back and ships a real span envelope. ElevenLabs, Backboard and TabPFN are wired, called by the running app, and pointed at real accounts, and where a provider's free tier rather than this code is what stopped them, `docs/KEYS.md` says so per key.
- **Latency, starting with the number that matters: 30–40 seconds to identify from a photo**, and 8.3–8.8 seconds from a typed note, measured across 120 real model calls in the eval above. The photo is the product, so the photo is the honest headline — the vision encoder does far more work per token. The first scan after a restart adds about 75 seconds of weight loading, and the request sets `keep_alive: 30m`, so that is paid once per session rather than once per item. Thirty seconds is slower than the ten-second decision this tool is built for, and that gap is the main thing it does not yet win.
- **The advisor answers a money question in about 2 seconds warm.** The three-turn transcript — a question, a correction, and a recall — runs in roughly 16 s end to end, and the same question asked five times produced the same sentence character for character. That last number did not come for free; the section above is what it cost.
- **A listing draft takes ~2 s for the local 1B model**, and 67 ms for the template that stands in when no model is running. Both produce a draft the reseller can edit, which is the point of the second one existing.
- **Zero bytes uploaded** on a local scan. Photos are downscaled on-device before anything else happens, and with live comps off there is nothing to upload *to*. The run log on each scan states this as a field rather than a promise.
- **12 items, 3 + 9, 0 duplicates.** A `SIGKILL` mid-sweep in the durable reprice job cost the run time and nothing else; the full numbers are in the Temporal section above.

Pointing real services at this code found three more defects, two of them silent. **Ollama 0.40 removed `POST /api/embeddings`** in favour of `POST /api/embed`, so every upsert stored a NULL vector: "have I bought this before?" degraded to keyword matching with no error raised anywhere. A 32-item seed then blew the request timeout on every embed, because Ollama answers one request per model at a time; the writes are serialised now. And the comps step logged a network call as `provider: cache` / `locality: device` — the one line whose job is to say whether your query left the machine — because SerpApi sits behind an on-disk cache that describes itself as local. It reads the result's own `source` now.

---

## Why Does Open Innovation Matter?

The glib answer is "privacy," and a third of this challenge's field has already said it, so let me be specific instead about the part that isn't ideology.

**The decision happens where there is no signal.** Not "sometimes." *Characteristically.* Basements, back rooms, barns, rural estate sales, the far corner of a flea market warehouse. Any architecture that needs a round trip to price an item fails at the exact moment the product exists for. That's not a cost problem you can optimise your way out of — it's a physics problem, and the only fix is to put the model where the decision is.

Being open-weight is what makes that possible at all. I can ship a 3.3 GB vision model that runs on a laptop with no cloud GPU *because* it's open weights: no per-call pricing, no rate limit, no vendor that can deprecate the model version my prompts depend on, and no terms of service standing between a user and the file on their own disk.

**The model is load-bearing, not a garnish.** A reseller cannot price an item she cannot name, and naming it is the part that used to need a person who knows the category: the query that finds comps is *big e levi's jacket*, not *denim jacket*. That step belongs to the model, and when it fails it fails quietly — which is why so much of this post is about how it fails rather than how fast it is.

**What it costs to run.** Zero, per item, forever. The flipper this is built for does 20–40 items a month plus the ones she puts back on the shelf — a few hundred scans a year, so a cent or two per call would be single-digit dollars annually. Cost is not really the argument; the round trip is. A cent is cheap right up until there is no signal, which is the exact moment this tool exists for. Electricity is the whole running cost, and it is what makes a $5/month price even arguable — though nobody has paid it yet.

**Where a closed model would genuinely be better.** I'll say this plainly: a frontier model has a larger world-knowledge base for genuinely obscure collectibles, and no quantisation loss on fine label detail. This 4B model is confident about Levi's and Pyrex and shaky on a mid-century chair with no marks — which is exactly the row I left in the table above. If you're appraising a single $4,000 item, call a proper model. Sourcerer optimises for the other case: forty $12 items and ten seconds each.

**Honest limits.**

- **It is slow on CPU**: 8–9 seconds from a typed note once warm, 30–40 seconds from a photo, and about 75 seconds on the very first scan of a session while the weights load. A laptop with an integrated GPU does better; mine offloads part of the model and no more.
- **The sold-comp data does not exist for free.** An asking price is not a sold price, and the 0.86 haircut is a judgement call, labelled as one everywhere it is applied. So is the 3× target multiple, which is the single biggest lever on the ceiling.
- **Nobody has paid for this yet.** There is no first-user section and no testimonial, because inventing one is not worth a paragraph. The persona is inferred from the shape of the problem, the price is a hypothesis, and the only demand signal so far is that I built the thing for myself and use it.
- **The price model is empty on day one.** With no sold history it falls back to condition-adjusted comps and a deliberately pessimistic guess, so the first week's verdicts lean PASS.
- **The advisor degrades** whenever the tool model isn't installed. On a machine that only has Gemma, everything *except* the conversational advisor works — the app tells you which, rather than failing quietly.
- **Untested at scale.** The largest eval here is 30 items, labelled by one person, on one machine, in one afternoon.
- **Not typed for the browser's model.** The on-device fallback used when the brain is unreachable is heuristics, not Gemma-in-the-tab. That's a real gap and the obvious next piece of work.

---

## Prize Categories

I have kept two lists, because a category has to be genuinely used and "genuinely used" should mean more than an import statement. The first list has evidence in this post: a measured eval, raw logs, a screenshot you can reproduce. The second is integrated and called by the running app, with a real account behind it, but a provider's free tier or plan — not this code — stopped the full demonstration. Merging the two would buy three extra category claims at the cost of the only thing this post has going for it.

### Demonstrated end to end

- **Best Use of Gemma** — Gemma 3 4B runs locally through Ollama's native API via `format: <JSON Schema>` to read items and write listings, with the 1B variant taking the cheap text-only paths so a title costs a second rather than a model load. This is the core of the product, and its accuracy is measured over 30 labelled items across 4 configurations in the table above.
- **Best Use of Mastra** — the agent runtime. Five tools wrap the deterministic pipeline functions, so the agent physically cannot invent a price it would have to fetch; a sourcing advisor runs them with LibSQL-backed memory across turns; a listing-writer agent drafts the post; and a four-step typed scan workflow is composed from the same step functions the HTTP route calls. The advisor is also where this project's thesis got its hardest test — a small model restates the numbers correctly and inverts the conclusion, so the money sentence is composed by the tool and the agent's remaining job is choosing the tool and its arguments. It does that well enough to turn "put shipping at $35" into `shippingCost: 35` mid-thread.
- **Best Use of Temporal** — the durable reprice workflow above, with an explicit retry policy on the flaky search call. Durability is demonstrated rather than asserted: a `SIGKILL` mid-sweep, a second worker, 12 items refreshed exactly once, zero duplicates.
- **Best Use of SerpApi** — live eBay listing search with the condition filter, free-shipping filter, result cap and a JSON restrictor to pull only the fields needed. It is the reason `comps.source` can become `live` instead of `local_history`, and it is now verified against a real account: a scan for a brass narwhal bottle opener returned **51 real eBay listings** for the query `brass bottle opener nautical`, and the raw response is committed at [`docs/evidence/serpapi-live.json`](https://github.com/ItsPriyamSri/sourcerer/blob/master/docs/evidence/serpapi-live.json). The scan log names the query it actually sent, and the network step is marked `cloud` while the two model steps stay `device`.
- **Best Use of Tiger Data** — Postgres + pgvector for "have I bought one of these before?" hybrid retrieval, exercised live against **pgvector 0.8.7**: 32 items embedded through the real pipeline, then a search for *"something to cook with in the kitchen"* returned Pyrex mixing bowls and a Griswold skillet — no shared keywords with the query, which is the whole point. The same code talks to Tiger Cloud by connection string; the local container is there so the answer to "do I have to hand over a database?" is no.
- **Best Use of Sentry Agent Tracing** — `@sentry/node` spans around identify, comps and price, so one scan becomes a waterfall instead of a wall clock reading, plus error capture that carries the route it came from. Verified against a real project: `pnpm keys:check` reads the SDK's own delivery receipt back (`HTTP 200`), a real scan ships its span envelope (`Sending span envelope for trace 39adcde… with 2 spans`), and `GET /health` reports `tracing: true`. genAI input recording is explicitly off, because v11 removed `sendDefaultPii` and an unset `dataCollection` collects prompt and image content by default — so photos do not enter a trace. The framework's own `gen_ai.*` spans are *not* wired: that needs `@mastra/observability`, and I would rather say that than let a span name imply token accounting that is not there.

### Wired, and exercised as far as the free tiers allow

These run in the app, sit in the capability registry, and are what the UI falls back *from* when a key is missing. Where a key exists, it has also been pointed at a real account.

| Partner | What is built | What stopped the full demonstration |
|---|---|---|
| **Backboard** | The second brain: the same agents against open-weight models through one key, which is what makes a GPU-less demo possible. | Its free credit excludes LLM chat, and a failed run returns **HTTP 200** with `status: "FAILED"`. The pipeline once read the billing notice as the item's title and sent `misc Your free` to eBay. Failed runs throw now, so `llmChat` falls through to local Gemma and the scan comes back correct: [`docs/evidence/backboard-credit-wall.json`](https://github.com/ItsPriyamSri/sourcerer/blob/master/docs/evidence/backboard-credit-wall.json). |
| **ElevenLabs** | `POST /transcribe` and `POST /speak`, both in the registry. Voice **in** is verified live: `scribe_v2` returns HTTP 200 against a real key. | The mic and play controls are not in the UI yet, so this is a live integration rather than a button you can press. Voice **out** is refused by the free plan, not the code: `402 paid_plan_required` on library voices, default included. |
| **TabPFN** | A price model fitted on the user's own sold history, so the offline number is personal rather than generic. | Implemented, not verified with a live token. It predicts price; sale speed is recorded on sold items but is not modelled, and the repo says so. |

**Not entered:** *GitHub Copilot* is a development tool, not a product integration. *MongoDB Atlas* would duplicate the vector memory Tiger Data already provides. *Arduino* has no hardware here. Length would not make the app better.

[`docs/KEYS.md`](https://github.com/ItsPriyamSri/sourcerer/blob/master/docs/KEYS.md) states the verification status of every integration in one table, and `GET /capabilities` reports the same thing at runtime — so nothing above has to be taken on trust.
