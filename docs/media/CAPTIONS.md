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

One honest caveat about reproducibility. The fixture is fixed and the fee, verdict and
max-offer arithmetic is deterministic, but the *local model's read of an item varies a
little between runs* — and that read decides which comparables match. This capture matched
six sold comps for the Levi's jacket; an earlier run of the same script matched four on one
pass and five on the next, which moved the max offer between $28.22 and $35.32. The frames
below therefore state the numbers **this** run produced. A re-capture will look the same in
shape and can differ in the third decimal of a price; the tables in the README are where
the numbers are meant to be read.

---

## The three figures used in the README and the post

### `verdict.buy.light.png` — the hero

**Caption.** The verdict card. One dominant signal, the maximum offer in the largest type
on the screen, the resale range it came from, and a chip that says where the number came
from. The asking price is editable, and the whole card re-prices on-device as you type.

**Alt text.** A phone screenshot of Sourcerer's verdict card for a Levi's 501 Big E
Selvedge Denim Jacket. The header chips read Online, Local · gemma3:4b and heuristic
pricing. A green check and the word BUY sit above two panels: MAX OFFER $35.32, and
EST. RESALE $133.40 with a range from $126.73 to $140.07. Below them a range bar marks the
comps median; a chip reads "your sold history", a second reads "60% confidence", and the
basis line reads "6 similar items you have already sold. Real realised prices, on this
device." In the rail beneath, the asking price is $12, the marketplace is eBay, and the
profit at that price is $93.96 (8.8×).

### `ranlog.light.png` — the receipt

**Caption.** What ran where. Every scan records which provider executed each stage, how
long it took, and whether anything left the device. This is what makes the privacy claim
checkable instead of aspirational: it is a field in the response, rendered.

**Alt text.** A phone screenshot of an expanded panel headed "What ran where" (total
4648 ms), reading "Nothing in this scan left your device. The photo, the identification and
the pricing all ran locally." Under it, three rows — Identify (ollama:gemma3:1b, on this
device, 4646 ms), Comps (local_history, on this device, 6 listings, 1 ms) and Price
(comps_median, on this device, $133.40, 0 ms) — each marked with a monitor icon rather than
a cloud.

### `listings.queue.light.png` — the other half of the loop

**Caption.** The queue. Every capture lands here priced and ready to list; one tap writes
the title, description, tags and price with the local model, and the lot exports to CSV.

**Alt text.** A phone screenshot of the Listings queue with three captured items, each
carrying its verdict pill and numbers: Pendleton Wool Board Shirt (PASS, max $8.13, resale
$39, 2.7×), Pyrex 444 Cinderella Mixing Bowl (MAYBE, max $18.35, resale $74.48) and Levi's
501 Big E Selvedge Denim Jacket (BUY, max $35.32, resale $133.40, 8.8×), above buttons to
write a draft, mark listed, or log a sale.

---

## The rest of the set

| File | What it shows | Alt text |
|---|---|---|
| `scan.empty.light.png` | First run, nothing captured yet | The Scan screen before anything is entered: a first-run card headed "Never overpay in a basement again." listing the three steps of the loop, above the capture card with a large photo target, a describe field and an asking-price field. |
| `scan.empty.dark.png` | The same screen in the dark theme | The Scan screen on the ink-dark theme, same layout, with the header chips Online, Local · gemma3:4b and heuristic pricing, and a recent capture reading Griswold Cast Iron Skillet #8, PASS, max $20. |
| `scan.progress.light.png` | The pipeline mid-run | A card headed "Working it out…" with four named stages — Reading the item (active, with a progress sweep), Checking the market, Pricing it, Deciding — and the note that the first scan of a session loads the model into memory. |
| `verdict.buy.dark.png` | The BUY verdict in dark theme | The same Levi's 501 verdict card on the dark theme: BUY, max offer $35.32, est. resale $133.40, "your sold history", 60% confidence. |
| `verdict.pass.light.png` | **It says no.** The same item with a $999 tag price | The same jacket with the asking price set to $999: the signal has flipped to a grey PASS reading "You would need it at $35.32 or less. At $999 this is someone else's flip.", the max offer is unchanged at $35.32, and the sub-line reads "Asking $999 sits 2728% over your ceiling." |
| `verdict.pass.dark.png` | The refusal, dark theme | The PASS verdict at $999 on the dark theme, max offer unchanged at $35.32. |
| `comps.expanded.light.png` | The comparables, expanded, each comp tagged | An expanded Comparables panel headed "Comparables (6)": the six comps are the user's own sold history, each row tagged `sold` with a price of $145, under summary tiles reading low/median/mean/high $145 and a note that the mean is trimmed 10%. The panel states "6 similar items you have already sold. Real realised prices, on this device." |
| `comps.expanded.dark.png` | The same panel, dark theme | The expanded Comparables panel on the dark theme, same six sold comps at $145. |
| `ranlog.dark.png` | The run log, dark theme | The expanded "What ran where" panel on the dark theme, taken with an asking price of $999: Identify (ollama:gemma3:1b, 3522 ms), Comps (local_history, 6 listings) and Price (comps_median, $133.40), all on this device. |
| `listings.sold.light.png` | The queue after logging two sales | The Listings header after two sales: "2 waiting · 2 sold", holding 2, capital in it $30, expected profit $131.01 "if it all sells at target", with the Pyrex bowl and the Levi's jacket still queued. |
| `listings.queue.dark.png` | The queue, dark theme | The Listings queue on the dark theme, showing the Pyrex bowl (MAYBE, max $18.35) and the Levi's jacket (BUY, max $35.32). |
| `listings.desktop.light.png` | Listings on a wide screen | The Listings screen at 1440 × 900: holding 2, capital in it $30, expected profit $131.01, with each item's actions laid out inline instead of stretched from a phone. |
| `insights.light.png` | Real numbers, computed locally | The Insights screen: realised profit $70.96 from 2 logged sales, spend $79 across 4 buys, revenue $119.96, an unrealised tile showing $0 on a dashed border, sell-through 50%, and best flips listing the Griswold skillet (+$40.96) and the Pendleton shirt (+$30). |
| `insights.dark.png` | Insights, dark theme | The Insights screen on the dark theme, showing "Where the money is" (Jeans $93.96, Kitchenware $78.01, Clothing-Shirts-Men's $30) and the price-model panel: forecast accuracy 100%, 2 logged sales, 2/6 toward the training threshold. |
| `insights.desktop.light.png` | Insights on a wide screen | The Insights screen at 1440 × 900, with the summary tiles in a single row and the category bars full width. |
| `offline.shell.dark.png` | **Network genuinely off.** The chip says so, and the app still boots | A dark-theme phone screenshot taken with the browser's network disabled: the header chips read "Offline · local only" and "Brain asleep", and the capture screen — photograph, describe, asking price — is fully rendered from the service-worker cache. |
| `offline.verdict.dark.png` | A scan with no network at all | A PASS verdict produced offline for the Pyrex bowl: max offer $11.30 from a $50 category estimate, a chip reading `estimate`, 25% confidence, the basis line "No matching history yet — category heuristic only", and a caveat stating it was priced offline from heuristics with no live comps. The header chips still read Offline · local only and Brain asleep. |
| `landing.light.png` | The public landing page for the `.tech` category | The Sourcerer landing page: the headline "Know what it's worth. Anywhere.", a framed phone showing the BUY verdict card, a stats row reading 0 photos uploaded, 0 API keys, 8.3 s per identification and 100% items read correctly, and the honest-limits section. |

---

## The demo video

`docs/media/sourcerer-demo.webm` — one uninterrupted run, recorded from the real app in a
390 × 844 context: the capture screen, a scan through all four stages, the verdict
arriving, the asking price changed by hand and the verdict re-priced on-device with no
model call, the run log opened, and the screen ending on Insights.

Recorded by `pnpm evidence:capture` alongside the screenshots, so the video cannot drift
from the frames.
