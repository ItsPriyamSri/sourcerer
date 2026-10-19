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
MAX OFFER    $35.32
EST. RESALE  $133.40   ($126.73 – $140.07)
AT $12       $93.96 profit, after eBay fees, shipping and supplies
BASIS        3 items from your own sold history
```

Every number in that block was computed by `packages/shared`, not by the model: eBay's
13.6% plus $0.30 payment fee on the $133.40 sale, $8 shipping, $1 supplies, a net of
$105.96, divided by the 3× multiple she wants to make, which is where $35.32 comes from.

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
**[`docs/media/sourcerer-demo.webm`](docs/media/sourcerer-demo.webm)** — capture screen →
all four pipeline stages → the verdict → the tag price changed by hand and the verdict
re-priced with the model untouched → the run log opened → Insights.

The run log is the part worth pausing on. It is not an overlay; it is a field in the scan
response, and it reads *"Nothing in this scan left your device."* next to a per-stage list
of which provider executed each step. Screenshots are in
[`docs/media/`](docs/media/), with captions and alt text in
[`docs/media/CAPTIONS.md`](docs/media/CAPTIONS.md).

Everything in that folder was produced by
[`scripts/capture-evidence.ts`](scripts/capture-evidence.ts), which drives the actual app
in a real browser against a real brain, seeds the sample data from the committed fixture
first so two runs produce the same frames, and writes the screenshots and the video in one
pass. They are not mockups and they are not retouched.

The public landing page is live at **<https://sourcerer-ochre.vercel.app>** — the same claims
in one page, with its headline numbers read out of the eval's JSON at capture time so they
cannot drift from the evidence the way a hand-typed statistic would.

That script also found a bug worth admitting to: the asking price you typed on the capture
form was being silently discarded by the verdict card, because the card kept a private copy
of the price, initialised to zero. Every screenshot in that first capture came back priced
as if the item were free. It survived every typecheck, every build and all sixty
passing unit tests, and it was visible the moment something rendered the screen and wrote
the result to a file. A screenshot is a test you cannot lie to.

Hardware, for every timing claim in this post: 8-core CPU, 15.4 GB RAM, an NVIDIA GTX 1650
with 3.6 GB of VRAM — enough to hold part of the model, not all of it, so most inference
runs on CPU. No cloud GPU, no paid inference, at any point.

---

## Code

**[github.com/ItsPriyamSri/sourcerer](https://github.com/ItsPriyamSri/sourcerer)** — MIT.

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

### Two changes, and neither did the job I built it for

The honest engineering story is that I expected prompt work to be the lever and it
mostly wasn't.

Every experiment in this section is the same 30 hand-labelled items run through four
configurations, with
[`apps/brain/eval/run-identify.ts`](apps/brain/eval/run-identify.ts). Ground truth is
what I wrote in the `text` field — a brand and an item type — so the scoring is
mechanical and every failure below can be checked by reading the row. Full output:
[`docs/evidence/identify-results.json`](docs/evidence/identify-results.json).

<!-- EVAL_TABLE_START -->
| Configuration | Emitted parseable JSON | Brand correct | Type correct | **Both** | Invented a brand | Median |
|---|---|---|---|---|---|---|
| `v1` prose prompt, no schema | 100% | 97% | 100% | **29/30** | 1/4 | 8.8 s |
| `v2` same prompt, + JSON schema | 100% | 100% | 100% | **30/30** | 0/4 | 8.6 s |
| `v3` full rules prompt, + schema | 100% | 100% | 100% | **30/30** | 0/4 | 8.5 s |
| `v4` v3 + anti-invention rules | 100% | 100% | 100% | **30/30** | 0/4 | 8.3 s |

Model `gemma3:4b`, temperature 0.1, 30 items, one machine, one afternoon.
<!-- EVAL_TABLE_END -->

What comes out of that table surprised me, and the honest version of the story is narrower
and more useful than the one I expected to write.

**Both levers turned out to be different levers than I thought.** I built the JSON-extraction
path braced for a fight — fenced code blocks, prose wrappers, objects truncated mid-string —
and the naive prompt produced a parseable object on the first try, **30 times out of 30**,
by wrapping it in a ```json fence that the extractor was written to handle. Prompt craft
never bought me a single point of parseability on this model, because there was nothing to
buy. But the prompt did do something for me, and the schema did something else entirely.
Neither of them was "accuracy".

That sounds abstract until you look at the one row that failed.

### The failure I am leaving in

Item 21 in the labelled set is *"Eames style lounge chair, rosewood, no labels anywhere."*
Ground truth: **no brand.** Here is that same item, from the same model, as the prompt and
the schema change. Nothing else differs — same temperature, same 30-item set:

| Configuration | `brand` field | `confidence` | `caveats` |
|---|---|---|---|
| naive prose prompt, no schema | `"Eames (Style)"` | **0.95** | — |
| same prompt, + JSON schema | *(omitted)* | 0.95 | — |
| + full rules prompt | *(omitted)* | 0.85 | — |
| + explicit anti-invention rules | *(omitted)* | **0.6** | *"No visible labels, condition is based on visual assessment only."* |

Read the first row carefully, because it is the reason this project is shaped the way it is.
The model did not produce garbage. It produced a clean, well-formed, **confident** record
with a fabricated brand in a machine-readable field, plus a keyword list containing
"Eames". Nothing about that output looks wrong. It would have become the title of a listing
and the basis of a price, and the person reading it at the counter would have had no reason
to doubt it.

It also failed on *exactly one item*. On the naive prompt, the other three unbranded items
in the set — a teak tray, a quilt, a brass lamp — came back `"Unknown"`, and with a schema
present the field was omitted cleanly on all four. So the failure is not diffuse. This model
fails **optimistically, on unbranded goods that resemble something valuable**, which is
precisely the population a flipper is most likely to overpay for. An error that concentrates
in the profitable-looking cases is much worse than an error that spreads evenly, because it
is the error you were least likely to catch.

And the two changes did different jobs, which took all four columns to see:

- **The schema removed the fabrication.** `brand` is typed `["string", "null"]`, so "I don't
  know" became a legal answer, and the model took it. Inventions on the set: **1 → 0**.
- **The prompt did not change accuracy. It changed calibration.** Accuracy was already 100%
  by the second column. What the anti-invention instructions moved was *stated confidence on
  the one item that is unverifiable by design* — 0.95 down to 0.6 — and they made the model
  volunteer a caveat about the missing label without being asked for one. That is a better
  answer even though it is the same answer, because it tells you how far to trust it.

**What is still wrong, and I am not going to dress it up.** Look at column four's title: the
model still called it an "Eames Lounge Chair Rosewood". It moved the doubt out of the `brand`
field, which was the field carrying the most weight, but the title still names the designer —
and the title is what a reseller would paste into a marketplace listing. In the app the
estimate and the verdict are anchored to comps rather than to the title, so the money is not
affected; but someone copying that title would be making a claim the evidence does not
support. The honest fix is to make the listing writer refuse a designer's name whenever
`brand` is null, and that is the next thing I would build.

There is also a limitation in *this eval* worth naming. My scorer checks the `brand` field
and the item type. It does not penalise a title that overclaims. `"Eames (Style)"` is a hard
failure I could catch mechanically; `"Eames Lounge Chair"` in a title is a softer one I could
not, so I left the scorer alone rather than tuning it until the number looked better.

**What I got wrong about my own project.** I assumed the interesting engineering was in the
prompt and that the interesting risk was in the price. The second half was backwards: the
arithmetic is deterministic, pure and unit-tested, and has been the least surprising part of
this build since the first day — which is exactly why it is allowed anywhere near the money.
The risk was one string field, produced by a 4B model, that a reseller would never think to
question. The fix for the worst version of it turned out to be a type annotation, not a
paragraph of instructions.

The UI carries a second line of defence — below 0.5 confidence the verdict can never say
BUY, whatever the arithmetic says. It is worth being precise that on this item the model
settled at 0.6, above that floor. The caveat is what protects the user here, not the
threshold.

### A real bug from a real run: Gemma 3 cannot call tools

I built the sourcing advisor as a Mastra agent with five tools — search comps, estimate a
price, do the fee math, save the item, look up similar past purchases — each wrapping the
*same deterministic function* the pipeline uses, so the agent physically cannot invent a
number it would have to fetch.

Then it failed on the first request:

```
$ curl -s localhost:8787/advisor -d '{"message":"…Ludwig Acrolite snare for $150…"}'
{"error":"registry.ollama.ai/library/gemma3:4b does not support tools"}

$ ollama show gemma3:4b
  Capabilities
    completion
    vision
```

No `tools`. Gemma 3 in Ollama will do vision and completion and nothing else, so the model
that reads your photograph is not the model that can run an advise loop. The replacement
had to be a second open model, and choosing it took three tries.

**Try one: Qwen 3 4B.** It calls tools correctly — I verified that directly against Ollama,
where it produced a clean `estimate_profit` call from a `thinking` field and no content at
all — and it has a reasoning mode:

```
$ ollama show qwen3:4b
  Capabilities
    completion
    tools
    thinking
```

That `thinking` field was the first trap. The interesting tokens arrive there, before any
content is emitted, so an early probe with a tight `num_predict` budget came back with an
empty `content` and a perfectly good answer upstream in the response. That run is where I
concluded "the model can't call tools", and I was wrong: I was reading the wrong field and
the budget I had set was 20 tokens.

**The second trap was quieter, and it was not mine.** Ollama's AI SDK provider resolves its
`think` flag to `false` when nothing sets it:

```ts
function resolveOllamaThinkFlag({ reasoning, ollamaThink, warnings }) {
  if (ollamaThink !== void 0) return ollamaThink;
  if (isCustomReasoning(reasoning)) { /* … */ return reasoning !== "none"; }
  return false;   // ← the default
}
```

Qwen 3 thinks whether or not the flag is set. With it off, Ollama does not separate the
reasoning out, and it arrives inside `content` — so the agent's answer was several paragraphs
of the model arguing with itself about what a tool call is, with the actual recommendation
somewhere in the middle. Turning it on fixes that:

```ts
providerOptions: { ollama: { think: true } }
```

Getting the key right matters more than it should. Provider options are matched against the
provider id, and the model object reports `provider: "ollama.responses"`. Using that string
in place of `ollama` does nothing at all, silently, with no warning — which is how the bug
survived a first round of debugging and a second round of false conclusions.

**And then the flag showed me the bill.** With reasoning correctly separated it was finally
visible how much of it there was: roughly 35 KB of `thinking` per step, and with the agent
configured for up to six steps that is over four minutes to answer a question about a $215
sale. The arithmetic was right. The wait was not survivable, and no prompt change touches it,
because the deliberation is what the model is.

So the tool model is now `llama3.2:3b`: `tools`, no thinking mode, same question answered in
about two seconds.

So the shape of it settled. Gemma keeps the jobs it is genuinely good at — reading items,
writing listings — and the agent loop runs beside it on a tool-capable open model that does
not stop to think about it first:

```ts
// Ollama reports Gemma 3 as `completion, vision` — no tool calling,
// and a reasoning model spends minutes deciding to call one.
model: toolModel(),   // llama3.2:3b
```

Two mechanical details earned their keep along the way. The tool schemas coerce now:
`llama3.2:3b` sends `{"resalePrice":"215"}`, a string where a number belongs, and a strict
`z.number()` turns a perfectly good tool call into a validation error the model then tries to
apologise for. And `think` is read from the model's reported capabilities rather than
hard-coded, because a model with no thinking mode does not ignore the flag — it rejects the
entire request with `"llama3.2:3b" does not support thinking`.

### The model got the numbers right and the answer wrong

That should have been the end of it. The loop worked, the transcript was clean, and I nearly
shipped it — which is when I noticed the same question giving different answers.

A model that small will restate your numbers correctly and then invert the conclusion. Asked
about a $150 snare with a $58.82 ceiling, one run reported that the asking price was *below*
the ceiling and the verdict was BUY — both numbers right, the comparison backwards. Another
said "the item should be bought". Another said PASS. Same tool, same output, three runs,
three verdicts:

```
run 1  PASS. Most I would pay is $58.82.
run 2  The item should be bought.
run 3  The reseller should pass on the snare drum.
```

A number a language model paraphrased is a number you cannot audit, and auditable numbers are
this app's whole claim. So the money sentence is no longer the model's to write. `feeMath`
composes the reply — the verdict, the ceiling, the profit, every figure straight out of the
same `decideVerdict()` the scan screen uses — and the route sends that instead of the model's
version of it. The same question, five times, now produces one answer, character for
character:

```
PASS. Most I would pay is $58.82. At $150 you would make $26.46 if it resells at $215.
```

What is left to the agent is the part it is genuinely good at: understanding the request and
calling the tool with the right arguments. It does that well, and the three-turn transcript in
[`docs/evidence/agent-transcript.json`](docs/evidence/agent-transcript.json) is the proof
rather than the assertion. *"I'm shipping cross-country, so put shipping at $35"* becomes
`shippingCost: 35`, the ceiling moves from $58.82 to $49.82, and the third turn still knows
what the first one was about.

The rule this project started with was *the model reads the item, plain code decides the
price*. Running a small model in a loop is what convinced me to hold the agent loop to it as
well. The advisor picks the tool. It does not get to pick a number.

`GET /capabilities` reports the tool model separately, with
`Run: ollama pull llama3.2:3b (Gemma 3 cannot call tools)` as its detail string when it is
missing, and the advisor route degrades to a deterministic answer built from the same numbers
rather than returning a 500.

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

### Durable work, and a crash I can prove cost nothing

The job nobody watches is the one where durability stops being a slide and starts being a
line item: comps go stale, and re-pricing a few hundred inventory items should not be
something a reseller has to sit and wait for.

`apps/brain/src/durable/` is that job on Temporal. Each item is two activities — refresh
its comps, then apply the new price — with an explicit retry policy on the flaky search
call and a `paceMs` delay between items. **The pacing is not a demo trick.** It is a rate
limit for a paid search API, because a 200-item sweep will otherwise get you throttled;
it also happens to make the crash window wide enough to aim at, which is how the number
below was produced.

So I killed it. Mid-sweep, `SIGKILL`, no cleanup, no graceful shutdown — the way a laptop
dies when someone shuts the lid at a sale:

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

What makes that table worth reading: a second worker replays the workflow history, sees
that the first three activities already completed, and starts at item four. The number
that matters is `items refreshed twice: 0` — no item was priced twice, so the crash cost
wall-clock time and nothing else. `bash scripts/temporal-durability-demo.sh` reproduces the
whole thing, including the kill; the raw worker and client logs are committed in
[`docs/evidence/temporal/`](docs/evidence/temporal/).

### Numbers

Every figure here is measured on the machine described above, and each one is traceable to
a file in the repository.

- **91 unit tests pass** (`pnpm test`, no model, no network). Eighteen live in
  `packages/shared` and cover the parts that decide whether someone makes money: eBay's fee
  arithmetic, the max-offer solve, the verdict thresholds, and trimmed-mean robustness to a
  single seller asking ten times the going rate. The other seventy-three live in `apps/brain`,
  and most of them pin the places this project cannot reach locally: the seams where a model
  meets code — the JSON salvage that stops a prose answer taking a whole scan down, and the
  verdict wrapper — and the exact request sent to each of the four integrations that need a
  key. Every one of those caught something a typecheck, a build and a local scan could not:
  an `_ipg` value SerpApi rejects, a JSON schema sent in an `instructions` field Backboard
  does not define, TabPFN's regression quantiles read on the wrong axis, and a Tiger Data
  `sslmode=require` that silently overrode the code's own TLS settings. Four more pin what
  the local matcher is allowed to count as a comparable, which is how the Woolrich parka
  stopped pricing the Pendleton shirt, and twelve cover the key-checker itself.
- **Four integrations are verified live, not merely wired.** Gemma and Temporal as above;
  **SerpApi** against a real free-tier account, where a scan for a brass narwhal bottle opener
  returned 51 live eBay listings and the raw response is committed at
  `docs/evidence/serpapi-live.json`; and **pgvector** in a local container with no cloud
  account, where 32 items were embedded through the real pipeline and *"something to cook with
  in the kitchen"* came back with Pyrex mixing bowls and a Griswold skillet — no shared
  keywords with the query, which is the entire point of a vector index.

  Pointing real services at this code found three more defects, two of them silent. **Ollama
  0.40 removed `POST /api/embeddings`** in favour of `POST /api/embed`, so `embed()` returned
  null on every single call: every upsert stored a NULL vector, "have I bought this before?"
  quietly degraded to keyword matching, and the vector column stayed empty forever with no
  error raised anywhere. Then a 32-item demo seed, firing all its embeds at once, blew the
  request timeout on every one of them, because Ollama answers one request per model at a
  time — the writes are serialised now. And the comps step logged a *network* call as
  `provider: cache` / `locality: device`, because SerpApi sits behind an on-disk cache that
  describes itself as local; that is the one line in the UI whose job is to tell you whether
  your query left the machine, and it said it had not. It reads the result's own `source` now.
- **Warm identification: 8.3–8.8 seconds median**, depending on the prompt, measured across
  120 real model calls in the eval above. A photo costs roughly 30–40 s, because the vision
  encoder is doing far more work per token. The first scan after a restart pays about 75 s
  of weight loading; the request sets `keep_alive: 30m`, so you pay that once per session
  rather than once per item — which is the difference between usable and not when you scan
  a dozen things in a row at a sale.
- **The advisor answers a money question in about 2 seconds warm.** The three-turn transcript
  — a question, a correction, and a recall — runs in roughly 16 s end to end, and the same
  question asked five times produced the same sentence character for character. That last
  number did not come for free; the section above is what it cost.
- **A listing draft takes ~2 s for the local 1B model**, and 67 ms for the template that
  stands in when no model is running. Both produce a draft the reseller can edit, which is
  the point of the second one existing.
- **Zero bytes uploaded** on a local scan. Photos are downscaled on-device before anything
  else happens, and with live comps off there is nothing to upload *to*. The run log on
  each scan states this as a field rather than a promise.
- **12 items, 3 + 9, 0 duplicates.** A `SIGKILL` mid-sweep in the durable reprice job cost
  the run time and nothing else; the full numbers are in the Temporal section above.

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
that runs on a laptop with no cloud GPU *because* it's open weights: no per-call pricing,
no rate limit, no vendor that can deprecate the model version my prompts depend on, and no
terms of service standing between a user and the file on their own disk.

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

I have split this into two lists on purpose. The challenge rules are clear that a category
has to be genuinely used, and "genuinely used" deserves a sharper definition than "an
import statement exists". So: the first list has evidence behind it in this post — a
measured eval, raw logs, a screenshot you can reproduce. The second list is everything that
is genuinely wired into the running app, appears in the capability registry, and is what the
UI falls back *from* when its key is absent — but which I have not exercised against a live
paid account. Those are different claims and I am not going to blur them to widen a list.

### Demonstrated end to end

- **Best Use of Gemma** — Gemma 3 4B runs locally through Ollama's native API via
  `format: <JSON Schema>` to read items and write listings, with the 1B variant taking the
  cheap text-only paths so a title costs a second rather than a model load. This is the
  core of the product, and its accuracy is measured over 30 labelled items across 4
  configurations in the table above.
- **Best Use of Mastra** — the agent runtime. Five tools wrap the deterministic pipeline
  functions, so the agent physically cannot invent a price it would have to fetch; a sourcing
  advisor runs them with LibSQL-backed memory across turns; a listing-writer agent drafts the
  post; and a four-step typed scan workflow is composed from the same step functions the HTTP
  route calls. The advisor is also where this project's thesis got its hardest test — a small
  model restates the numbers correctly and inverts the conclusion, so the money sentence is
  composed by the tool and the agent's remaining job is choosing the tool and its arguments.
  It does that well enough to turn "put shipping at $35" into `shippingCost: 35` mid-thread.
- **Best Use of Temporal** — the durable reprice workflow above, with an explicit retry
  policy on the flaky search call. Durability is demonstrated rather than asserted: a
  `SIGKILL` mid-sweep, a second worker, 12 items refreshed exactly once, zero duplicates.
- **Best Use of a .tech Domain** — a public landing page, live at
  <https://sourcerer-ochre.vercel.app>, with the headline accuracy and latency numbers read
  out of the eval's own JSON at capture time, so the page cannot drift from the evidence. The
  `.tech` domain itself is on the Hacktoberfest promo list and has not arrived yet, so the
  page is currently served from a `.vercel.app` host.
- **Best Use of SerpApi** — live eBay listing search with the condition filter, free-shipping
  filter, result cap and a JSON restrictor to pull only the fields needed. It is the reason
  `comps.source` can become `live` instead of `local_history`, and it is now verified against
  a real account: a scan for a brass narwhal bottle opener returned **51 real eBay listings**
  for the query `brass bottle opener nautical`, and the raw response is committed at
  [`docs/evidence/serpapi-live.json`](docs/evidence/serpapi-live.json). The scan log names the
  query it actually sent, and the network step is marked `cloud` while the two model steps
  stay `device`.
- **Best Use of Tiger Data** — Postgres + pgvector for "have I bought one of these before?"
  hybrid retrieval, exercised live against **pgvector 0.8.7**: 32 items embedded through the
  real pipeline, then a search for *"something to cook with in the kitchen"* returned Pyrex
  mixing bowls and a Griswold skillet — no shared keywords with the query, which is the whole
  point. The same code talks to Tiger Cloud by connection string; the local container is
  there so the answer to "do I have to hand over a database?" is no.

### Implemented and wired; not yet exercised against a live account

- **Best Use of TabPFN** — a price model fitted on the user's own sold history via the
  Prior Labs REST API, which is what makes the offline number personal rather than
  generic. It predicts price; sale speed is recorded on sold items but is not modelled,
  and the repo says so rather than implying a second model exists.
- **Best Use of Sentry Agent Tracing** — `@sentry/node` spans around identify, comps and
  price, so one scan becomes a waterfall, plus error capture that carries the route it
  came from. genAI input recording is explicitly off, so photos never enter a trace. The
  framework's own `gen_ai.*` spans are *not* wired: that needs `@mastra/observability` and
  a preloaded `Sentry.init`, and I would rather say that than let a span name imply token
  accounting that is not there.
- **Best Use of ElevenLabs** — dictate an item while both hands are full, or hear the
  verdict read back.
- **Best Use of Backboard** — the second brain: the same agents against open-weight models
  through one key, which is what makes a GPU-less hosted demo possible.

**Not entered, and why:** *GitHub Copilot* (a development tool, not an integration — it
does not belong in a product category) and *MongoDB Atlas* (it would have duplicated the
vector memory that Tiger Data already provides, and building both to widen a category list
is exactly the slide-deck thinking I am trying to avoid). *Arduino* was not entered because
there is no hardware here.

[`docs/KEYS.md`](docs/KEYS.md) states the verification status of every integration in one
table, and `GET /capabilities` reports the same thing at runtime — so nothing above has to
be taken on trust.
