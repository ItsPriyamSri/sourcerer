# Captions and alt text

One source for the README, the post, and the landing page. Every image in this folder is
produced by `pnpm evidence:capture`, which drives the real app in a real browser — no
image here is a mockup, and none of the data is typed into a design tool.

Two rules this file exists to enforce:

- **Every figure carries alt text that says what the figure shows**, not "screenshot of
  the app". A reader using a screen reader should get the information the picture carries.
- **A figure is never the only place a number appears.** Images carry pixels; numbers live
  in tables where they can be read, copied and checked. If a number matters, it is in the
  prose or a table as well.

Camera settings, for the record: 390 × 844 CSS pixels at `deviceScaleFactor: 2` for every
phone shot (a 780 × 1688 image), 1440 × 900 at 2× for the two desktop shots (a 2880 × 1800
image), `prefers-reduced-motion: reduce`, animations frozen, locale `en-US`, timezone
`Asia/Kolkata`, and the sample data loaded from the committed fixture.

## What makes these frames reproducible

Three things do, and all three started as bugs that only showed up when the capture was run
twice in a row:

- **The sample data is seeded idempotently** — `POST /demo/seed?reset=1`. Without the reset
  the endpoint appends, so each capture began with a longer sold history than the last: the
  same jacket matched 10, then 12, then 15 comparables over three consecutive runs, and the
  max offer moved with them. Every number in the older screenshots came from that drift.
- **The model's sampler is pinned** — `OLLAMA_SEED=7`. Sampling at temperature 0.1 without a
  seed is not deterministic, and the model's read decides which comparables match: one run
  called the jacket's condition `good` and the next called it `fair`, which moved the resale
  from $133.40 to $108.75. `scripts/capture-evidence.ts` reads the pin off `/health` before
  it starts and says so if it is missing, rather than producing frames that look fine and
  are quietly unrepeatable.
- **The models are warm before the first frame.** Ollama returns marginally different logits
  on the first call after a load than on the call after that — the same description came
  back categorised `Jeans` on a cold call and `Jeans & Jackets` once the model was resident.

With those three, two captures produce the same identification, the same comparables and the
same price. The light and dark BUY shots are two separate scans and they now agree to the
cent. The one thing that still differs between runs is the run log's per-stage millisecond
timings, because those are real measurements of this machine — pretending otherwise would
put the only invented number in the set inside the panel that exists to prove nothing is
invented.

`docs/media/frames.json` archives the visible text of every frame, so a number quoted below
can be checked against the frame it describes instead of being taken on trust.

---

## The three figures used in the README and the post

### `verdict.buy.light.png` — the hero

**Caption.** The verdict card. One dominant signal, the maximum offer in the largest type
on the screen, the resale range it came from, and a chip that says where the number came
from. The asking price is editable, and the whole card re-prices on-device as you type.

**Alt text.** A phone screenshot of Sourcerer's verdict card for a Levi's 501 Big E
Selvedge Denim Jacket. The header chips read Online, Local · gemma3:4b and heuristic
pricing, and the item chips read Jeans and good. A green check and the word BUY sit above
two panels: MAX OFFER $35.32, and RESALE $133.40 with a range from $126.73 to $140.07 —
above "$105.96 net ÷ 3× target = $35.32" and "Asking $12 sits 66% under your ceiling." Below
them a range bar marks the comps median; a chip reads "your sold history", a second reads
"57% confidence", and the basis line reads "6 similar items you have already sold. Real
realised prices, on this device." In the rail beneath, the asking price is $12, the
marketplace is eBay, and the profit at that price is $93.96 (8.8×).

### `ranlog.light.png` — the receipt

**Caption.** What ran where. Every scan records which provider executed each stage, how
long it took, and whether anything left the device. This is what makes the privacy claim
checkable instead of aspirational: it is a field in the response, rendered.

**Alt text.** A phone screenshot of an expanded panel headed "What ran where", reading
"Nothing in this scan left your device. The photo, the identification and the pricing all
ran locally." Under it, three rows — Identify (ollama:gemma3:1b, on this device, 6047 ms),
Comps (local_history, on this device, 6 listings, 2 ms) and Price (comps_median, on this
device, $133.40 at 0.57 confidence, 1 ms) — each marked with a monitor icon rather than a
cloud, and a total of 6051 ms. Above the panel the rail records the same run: asking price
$12, profit $93.96, multiple 8.8×, net $105.96, fees $18.44.

### `listings.queue.light.png` — the other half of the loop

**Caption.** The queue. Every capture lands here priced and ready to list; one tap writes
the title, description, tags and price with the local model, and the lot exports to CSV.

**Alt text.** A phone screenshot of the Listings queue reading "4 waiting · 0 sold", with
$79 of capital in it and a projected $156.76 of profit if it all sells at target. Four
cards carry their verdict pill and numbers: Griswold Cast Iron Skillet #8 (PASS, max
$20.22, resale $80.96), Pendleton Wool Board Shirt (PASS, max $8.13, resale $39), Pyrex
444 Cinderella Mixing Bowl (PASS, max $14.92, resale $62.56) and Levi's 501 Big E Selvedge
Denim Jacket (BUY, max $35.32, resale $133.40), each above buttons to write a draft, mark
listed, or log a sale.

---

## The rest of the set

| File | What it shows | Alt text |
|---|---|---|
| `scan.empty.light.png` | First run, nothing captured yet | The Scan screen before anything is entered: a first-run card headed "Never overpay in a basement again." listing the three steps of the loop, above the capture card with a large photo target, a describe field and an asking-price field. |
| `scan.empty.dark.png` | The same screen in the dark theme | The Scan screen on the ink-dark theme, same layout, with the header chips Online, Local · gemma3:4b and heuristic pricing, and recent captures reading Griswold Cast Iron Skillet #8 PASS max $20, max $8 and max $15. |
| `scan.progress.light.png` | The pipeline mid-run | A card headed "Working it out…" with four named stages — Reading the item (active, with a progress sweep), Checking the market, Pricing it, Deciding — and the note that the first scan of a session loads the model into memory. |
| `verdict.buy.dark.png` | The BUY verdict in dark theme | A second scan of the same jacket, read on the dark theme: BUY, max offer $35.32 ("$105.96 net ÷ 3× target = $35.32"), est. resale $133.40 over $126.73–$140.07, net $105.96, fees $27.44, condition good, and chips reading "your sold history" and 57% confidence. The same numbers as the light hero, because both are reproducible scans. |
| `verdict.pass.light.png` | **It says no.** The same item with a $999 tag price | The same jacket with the asking price set to $999: the signal has flipped to a grey PASS reading "You would need it at $35.32 or less. At $999 this is someone else's flip.", the max offer is unchanged at $35.32, the profit is −$893.04 at 0.1×, and the sub-line reads "Asking $999 sits 2728% over your ceiling." |
| `verdict.pass.dark.png` | The refusal, dark theme | The PASS verdict at $999 on the dark theme, the same numbers: max offer unchanged at $35.32 and the sub-line reading "Asking $999 sits 2728% over your ceiling." |
| `comps.expanded.light.png` | The comparables, expanded, each comp tagged | An expanded Comparables panel headed "Comparables (6)": all six are the user's own sold history, each row tagged `sold`, priced from $136 to $155, under summary tiles reading low $139, median $145, mean $145.17 and high $151.50, with a note that the mean is trimmed 10%. The panel states "6 similar items you have already sold. Real realised prices, on this device." and records that it searched "Levi's 501 Big E". |
| `comps.expanded.dark.png` | The same panel, dark theme | The expanded Comparables panel on the dark theme, the same six sold comps at $136, $142, $145, $145, $148 and $155. |
| `ranlog.dark.png` | The run log, dark theme | The expanded "What ran where" panel on the dark theme, taken with an asking price of $999 (profit −$893.04, 0.1×), total 6189 ms: Identify (ollama:gemma3:1b, 6187 ms), Comps (local_history, 6 listings) and Price (comps_median, $133.40 at 0.57), all on this device. |
| `listings.sold.light.png` | The queue after logging two sales | The Listings header after two sales: "2 waiting · 2 sold", holding 2, capital in it $30, expected profit $120.71 "if it all sells at target", with the Pyrex bowl (PASS, max $14.92) and the Levi's jacket (BUY, max $35.32) still queued. |
| `listings.queue.dark.png` | The queue, dark theme | The Listings queue on the dark theme, showing the Pyrex bowl (PASS, max $14.92, resale $62.56) and the Levi's jacket (BUY, max $35.32, resale $133.40). |
| `listings.desktop.light.png` | Listings on a wide screen | The Listings screen at 1440 × 900: holding 2, capital in it $30, expected profit $120.71, with each item's actions laid out inline instead of stretched from a phone. |
| `insights.light.png` | Real numbers, computed locally | The Insights screen: realised profit $70.96 from 2 sales, spend $79 across 4 buys, revenue $119.96, an unrealised tile showing $0 on a dashed border, sell-through 50%, and best flips listing the Griswold skillet (bought $40, sold $80.96, +$40.96) and the Pendleton shirt (bought $9, sold $39, +$30). |
| `insights.dark.png` | Insights, dark theme | The Insights screen on the dark theme, showing "Where the money is" (Jeans 1 item · $93.96, Kitchenware 2 items · $67.71, Clothing 1 item · $30) and the price-model panel: forecast accuracy 100%, 2 logged sales, and "4 more logged sales and it's worth training a TabPFN model". |
| `insights.desktop.light.png` | Insights on a wide screen | The Insights screen at 1440 × 900, with the summary tiles in a single row and the category bars full width. |
| `offline.shell.dark.png` | **Network genuinely off.** The chip says so, and the app still boots | A dark-theme phone screenshot taken with the browser's network disabled: the header chips read "Offline · local only" and "Brain asleep", the app says "Your brain isn't running. I'll price from your own sold history instead — open Settings to point me at it.", and the capture screen — photograph, describe, asking price — is fully rendered from the service-worker cache. |
| `offline.verdict.dark.png` | A scan with no network at all | A PASS verdict produced offline for the Pyrex bowl: max offer $11.30 from a $50 category estimate ("$33.90 net ÷ 3× target = $11.30"), a chip reading `estimate`, 25% confidence, the basis line "No matching history yet — category heuristic only", and a caveat stating it was priced offline from heuristics with no live comps. The header chips still read Offline · local only and Brain asleep. |
| `landing.light.png` | The public landing page for the `.tech` category | The Sourcerer landing page: the headline "Know what it's worth. Anywhere.", a framed phone showing the BUY verdict card, a stats row reading 0 photos uploaded, 0 API keys, 8.3 s per identification and 100% items read correctly, and the honest-limits section. |

### One defect this capture surfaced, recorded rather than smoothed over

The Insights "Unrealised" tile reads **$0** while the Listings "Expected profit" tile
(`listings.sold.light.png`, `listings.desktop.light.png`) reads **$120.71** — from the same
two items. The two screens define "held" differently: `Listings` counts items whose status is
`sourced | bought | listed`, while `portfolioStats` in `packages/shared/src/economics.ts`
counts only `bought | listed` for unrealised. The tile's own label, "expected, on what you
still hold", does not match the rollup's definition. This is a defect in the rollup, not a
design decision, and it is left unfixed here because the fix is outside this change.

---

## The demo video

`docs/media/sourcerer-demo.webm` — one uninterrupted run, recorded from the real app in a
390 × 844 context: the capture screen, a scan through all four stages, the verdict arriving
(PASS, max offer $20.22 with the asking price at $40), the asking price edited by hand to $60
and the verdict re-priced on-device with no model call (profit $0.65, 1×), the run log
opened, the scan saved to the queue, and the screen ending on Insights. The video runs in its
own clean browser context, so Insights reflects only the one item this run saved — it reads
"Kitchenware · $20.65" under "Where the money is" with no realised sales, rather than the
seeded numbers the screenshots show.

Recorded by `pnpm evidence:capture` alongside the screenshots, so the video cannot drift
from the frames.
