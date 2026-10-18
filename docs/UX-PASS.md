# Sourcerer — UI/UX Craft Pass

> A focused, high-craft pass over `apps/web`, run against the design thinking already
> written down in [`DESIGN.md`](./DESIGN.md). No new features, no new dependencies, no
> model inference. The question was never *"what else can this do?"* — it was
> **"does the existing screens actually deliver the promises in §4?"**

Every change below is traceable to a principle in `DESIGN.md §4`, a measured number,
or a user-visible defect. Anything that could not earn its place was cut, and the cuts
are documented in §4 rather than silently dropped.

---

## 1. Empathise → define: the review question

`DESIGN.md` already names the persona (Maya, the weekend flipper, at a rack, no bars)
and the job (`what is this, what will it sell for, should I buy it?` in under ten
seconds). This pass keeps that contract and audits the built app against it, in the
order a user actually meets the screens:

1. **Capture** — the first screen, and the moment before the wait.
2. **Progress** — the wait for local inference, which is the honest cost of the thesis.
3. **Verdict** — the payoff; the one screen that has to work at a glance.
4. **Listings** — the 11pm grind.
5. **Insights** — "did I actually make money?"

The audit below is the raw material; the section numbers are the promises it broke.

---

## 2. Audit — named weaknesses, with evidence

Findings are labelled by *what a user would say*, not by component.

| # | Weakness as experienced | Where | Broke |
|---|---|---|---|
| A1 | *"I typed $40 on the form and the verdict priced it at $0."* The card kept a private copy of the price, initialised to `0`, so the number typed before the scan was discarded. Every verdict was silently computed as if the item were free. | `VerdictCard.tsx` | §4.4 honesty, §5 flow |
| A2 | *"The biggest number on the screen is a claim I can't check."* `Max offer $10.15` sat in a two-column grid at the same weight as its neighbours, with no derivation. | `VerdictCard.tsx` | §4.1/§4.2 |
| A3 | *"No price typed → it says BUY."* With no asking price the shared maths reads `offerRatio = 0` and returns **BUY** — technically "if it were free you'd buy it", useless at a rack, and a false verdict. | `VerdictCard.tsx` | §4.4, §4.7 |
| A4 | *"It announces nothing."* The verdict banner is a live region **mounted with its sentence already inside it**, so screen readers never hear the decision land. | `VerdictCard.tsx` | §4.7 |
| A5 | *"I don't know if it's working or frozen."* Four stages of CPU inference rendered as a flat list with no "you are here". | `StageProgress.tsx` | §4.1 |
| A6 | *"The checkbox is a 44×20 rectangle."* `.tap` forces a 44px min-height onto a 20px glyph, stretching the box and shrinking the label's real hit area. | `Scan.tsx` | §4.3, §4.7 |
| A7 | *"The headings start at h2, and Scan has no heading at all."* The Scan screen opened the outline at `<h2>`; the page had no `h1`. | `Scan.tsx` | §4.7 |
| A8 | *"The queue is a list, not a business."* Listings showed rows but no capital exposure — the thing an estate-sale pro actually manages. | `Listings.tsx` | §4.4 |
| A9 | *"A sold item is still wearing its expectation."* Sold rows rendered the *expected* profit as if it were realised. | `Listings.tsx` | §4.4 |
| A10 | *"The tabs are two buttons."* Queue/Sold had no tablist/tab/tabpanel semantics or `aria-selected`. | `Listings.tsx` | §4.7 |
| A11 | *"Unrealised profit looks like cash."* The Insights tile presented a forecast with the same visual weight as money already banked. | `Insights.tsx` | §4.4 |
| A12 | *"The best flip of the quarter is $6 and I can't tell if that's bad."* Bars (categories) were scaled by raw value with no baseline and no sign treatment. | `Insights.tsx` | §4.4/§4.7 |
| A13 | *"The warning triangle says nothing."* A flag icon carried meaning in an ignored `aria-label`; a screen reader got an unlabelled icon. | `CompsPanel.tsx` | §4.7 |
| A14 | *"14 different font sizes."* Ad-hoc `text-[11px]` / `text-xs` / ad-hoc uppercase tracking let vertical rhythm drift between the three screens. | `styles.css` | §4.6 |
| A15 | *"The scroll parks the verdict under the header."* `scrollIntoView({block:"start"})` put the answer behind the sticky top bar plus status chips. | `Scan.tsx` / `styles.css` | §4.1 |
| A16 | *"`scroll-behavior: auto` doesn't reach my JS."* The reduced-motion CSS override could not affect `scrollIntoView({behavior:"smooth"})`. | `Scan.tsx` | §4.7 |

---

## 3. Ideate — what was considered, then converged

The audit produced far more ideas than changes shipped. Everything is listed here so the
reasoning is inspectable.

**Shipped (mapped to principle):**

| Change | Principle |
|---|---|
| **Max offer promoted to a full-width hero** (`.hero-number`, `clamp(2.75rem, 13vw, 3.75rem)`), shown as arithmetic (`$33.90 net ÷ 3× target = $11.30`) | §4.2 glanceable verdict, §4.4 honest uncertainty |
| **Ceiling reframing** — no-asking-price is not a verdict. `CEILING_STYLE` renders amber + bolt + the words *"Your ceiling"* and the reason *"At your ceiling you'd still clear about $X. Here's what to offer."* | §4.4, §4.7 colour-is-never-alone |
| **Buy-price ownership fixed** — the parent (`Scan.tsx`) owns the value and setter; the card keeps no copy. | §4.4 |
| **Always-mounted `Announcer`** — a polite live region that mounts empty and is filled *after* the result arrives. | §4.7 |
| **Progress rebuilt as a connected timeline** — per-stage millisecond timings, a single active row with a sweep bar, a concise `role="status"` step announcer beside a live `<ol>`. | §4.1, §4.7 |
| **Queue economics header** — Holding / Capital in it / Expected profit, with "if it all sells at target" as the caption on the forecast. | §4.4 |
| **Realised vs expected separated** — sold rows show `+/−` realised instead of expectation; Sold/mark-listed actions hide on sold items. | §4.4 |
| **Proper tablist + tabpanel** (`listings-tab-*` / `listings-panel`, `aria-selected`). | §4.7 |
| **Insights hero = realised profit**, with the second-order tiles demoted to a 4-up grid and **Unrealised** given a dashed border and the words *"expected, on what you still hold"*. | §4.4 |
| **Signed, baselined bars** — scaled by `Math.abs`, hatched for losses, every bar labelled with its value. | §4.4, §4.7 |
| **Named type roles** (`.kicker`, `.meta`) replacing the ad-hoc 14-size drift. | §4.6 |
| **Scroll fixes** — `.scroll-anchor` (`scroll-margin-top: 8.5rem`) plus a `matchMedia` reduced-motion check inside `scrollIntoView`. | §4.1, §4.7 |
| **`sr-only-text` for icon meaning** — the far-from-expected flag and the four progress rows now carry their meaning as text. | §4.7 |
| **Contrast tokens retuned and measured** (see §6). | §4.7 |

**Cut — and why** (this list is the point of the section; each was prototyped or
sketched and rejected on a principle, not on taste):

| Cut | Reason |
|---|---|
| **Delete-confirmation modal on queue rows** | Adds a step to a high-frequency action to protect a low-cost mistake. The cost of a mis-delete (one item, retypable) is lower than the cost of a modal at every delete. Rejected on §4.3 thumb-first / speed. |
| **Voice capture UI** | `ElevenLabs` is *implemented, not verified with a live key* (`DESIGN.md §7`). A microphone button that produces nothing is a dead end — §4.6 *"no dead ends"*. The `Note` disclosure stays as the honest manual path. |
| **Animated bar fills on Insights** | Delays reading a number under motion for a purely decorative gain. Rejected on §4.1 speed-is-the-feature and §4.10 delight-with-restraint. |
| **Confetti on BUY** | Namesake of the §4.10 anti-pattern ("No confetti spam"). |
| **Number count-up on the verdict** | Delays truthful comprehension by ~600ms on the single screen where speed *is* the product. Rejected on §4.1. |
| **Google Fonts for the display face** | Breaks offline-first (§4.5) for a cosmetic upgrade. The existing `Iowan Old Style → Palatino → Georgia` stack is already offline and already retro-mercantile. |
| **Dark-mode amber glow / neon accent** | Consumes the accent's attention budget. Amber must mean *attention*; making it ambient decoration weakens the verdict. Rejected on §4.2. |
| **PWA install prompt banner** | Interrupts the first-run coach (§5) to ask for a commitment before value is demonstrated. |
| **Auto-hydrating local IndexedDB from the brain's `/inventory`** | Would make the app "richer" on open, but it breaks the honest first-run state (empty queue → `scan.empty`), and it teaches the user to expect the network. Offline-first means the app must be valuable *before* sync, not because of it. |
| **Reordering the verdict rail (actions above inputs)** | Considered to lift the action row above the fold on phones. Rejected: it breaks the narrative (type the price → see the number move → act) and encourages acting before reading the ceiling. Flagged here as a legitimate future experiment. |

---

## 4. Build — the changes, and the reasoning behind them

### 4.1 The verdict card is now a decision, a rail, and a fine print

`VerdictCard.tsx` was one flat column. It is now three genres on desktop
(`lg:grid-cols-[minmax(0,1fr)_21rem]`, explicit `col-start`/`row-start`):

- **The decision** (left) — identity, the verdict banner, the **hero ceiling number and
  its derivation**, then resale / net / fees as a 3-up `dl`, the range bar where the
  asking price sits, provenance, and the "check before you pay" caveats.
- **The rail** (right) — the two inputs that move the ceiling (asking price,
  marketplace), four re-priced metrics, and the three actions.
- **The fine print** (below) — Assumptions & fees, Comparables, What ran where, Note.

The ordering matters and the comment in the file says why: *the max-offer number is the
biggest thing on screen, it sits alone on its own line, and its colour is always backed
by the words above and below it.*

The hero also carries its own arithmetic:

```
$30.44 net ÷ 3× target = $10.15
```

`netProceeds` does not depend on what you pay, so dividing by the target multiple *is*
the derivation of the ceiling. Showing it turns the largest element on the screen from a
claim into a calculation the user can check — which is the entire §4.4 promise.

### 4.2 The no-price state is a ceiling, not a verdict

With no asking price the shared maths reads `offerRatio = 0` and returns `BUY`. That is
technically "if it were free you'd buy it" and it is a lie at a rack.

`CEILING_STYLE` replaces the whole treatment — amber, a bolt icon, the words **"Your
ceiling"** — and reason becomes *"At your ceiling you'd still clear about $X. Here's what
to offer."* It is not dressed as a verdict because it is not one; it keeps the invariant
that colour is never the only signal because it ships its own icon and its own words.

### 4.3 The wait is designed, not hidden

`StageProgress.tsx` is a connected timeline: a spine, a state per row
(done → emerald check + real `ms`, active → amber ring + sweep bar, error → warn), and a
single concise `role="status"` step announcer (*"Step 3 of 4: Pricing it"*) sitting
beside a live `<ol>` that keeps its list semantics. The `WakingUp` line is now honest
about *why* the first scan is slow: *"First run loads a few gigabytes into memory."*

### 4.4 The queue and the books tell the truth about money

- **Listings** gained a queue-economics header — Holding, Capital in it, Expected profit
  — so the screen answers "how exposed am I?" not just "what did I scan?".
- **Sold rows** show realised `+/−` and drop the Sold/mark-listed actions.
- **Insights** leads with realised profit (actual cash in hand, with the sum shown:
  *revenue − cost of goods sold*). Unrealised profit is a dashed **hypothesis** tile that
  says so in words. Category bars are signed, scaled by magnitude, hatched for losses,
  and every bar is labelled with its value.

### 4.5 The first screen states the loop, in order

`FirstRun` replaces a paragraph of prose with the three steps in the order they happen
(*Photograph it → the model reads it on your machine → you get your ceiling*). The reason
is in the code comment: **the wait for local inference is the part people misread as
"broken" if nobody warned them.**

### 4.6 Inputs and headings

- The privacy checkbox's hit area moved to the label (`min-h-11`) so the glyph can be
  `h-5 w-5` without being stretched; the field is labelled **Privacy** with the plain
  promise *"Keep it fully local · skip live market comps"*.
- Scan gained a `sr-only-text` `<h1>Scan</h1>` so the heading outline opens correctly on
  every screen.
- The capture photo now travels *inside* the verdict card as a 56px thumbnail — evidence
  beside the claim (§4.4) instead of a full-width image pushing the number below the fold
  (§4.2).

### 4.7 Motion

- CSS: `prefers-reduced-motion` zeroes animations, transitions and `scroll-behavior`.
- JS: `scrollIntoView`'s `behavior` is chosen from `matchMedia("(prefers-reduced-motion:
  reduce)")`, because a CSS `scroll-behavior` override cannot reach it.

---

## 5. Verify

| Check | Result |
|---|---|
| `pnpm --filter @sourcerer/web typecheck` | passes (`noUnusedLocals`/`noUnusedParameters` on) |
| `pnpm build` | passes · 17 precache entries (589.46 KiB) · `dist/assets/index-CdjPh60h.css` 27.18 kB · `index-BYpBewF7.js` 440.00 kB |
| PWA | `vite-plugin-pwa` service worker + manifest + icons still emitted and precached |
| Screens reviewed | 390×844 and 1440×900, light + dark: empty scan, verdict, zero-price, PASS, progress, ran-log, comps, listings queue, listings sold, log-sale sheet, insights |
| Model inference during review | **none** — `brainUp` forced false via a dead brain URL, so the pure-client `runOfflineScan` produced every verdict |

### Automation contract (unchanged)

Verified intact after the pass, because `scripts/capture-evidence.ts` depends on them:

- `textarea` (first on Scan) — unchanged, and still the only one on the capture screen.
- `input[aria-label="Asking price"]` — unchanged; still **two** (capture form + verdict rail).
- Button accessible name starting `Price it` — unchanged.
- `section[aria-label="Verdict"]`, `<summary>` starting `What ran where`,
  `<summary>` starting `Comparables` — unchanged.
- Button named exactly `Save`, `saved ? "Saved" : "Save"` — unchanged.
- Nav `Scan` / `Listings` / `Insights`, theme toggle `Switch to dark theme` /
  `Switch to light theme`, buttons `Sold` and `Log sale` — unchanged.

**No selector and no accessible name was altered.** New panels introduce *additional*
ids (`listings-tab-*`, `listings-panel`) but nothing the capture script matches was
renamed or removed.

### Pre-existing defect found (not fixed here — out of scope)

`scripts/capture-evidence.ts` pass 4 opens a **fresh `browser.newContext()`** for the
1440×900 desktop shots before visiting `/insights` and `/listings`. The new context has
an empty IndexedDB, so both committed desktop shots
(`docs/media/insights.light.png`, `docs/media/listings.queue.light.png`) capture the
**empty state** rather than the populated screens. The brain's `POST /demo/seed` seeds
the brain, not browser storage, so it does not help. The fix belongs in the capture
script — reuse the mobile context, or seed IndexedDB via `context.addInitScript` — and
was deliberately left out of this UI-only pass.

---

## 6. Accessibility

### Measured contrast (WCAG 2.1, sRGB relative luminance)

**Light theme**

| Pair | Ratio | Verdict |
|---|---|---|
| `--ink` `#17150f` on surface `#fffdf7` | 17.94:1 | AAA |
| `--ink-2` `#4a4437` on surface | 9.50:1 | AAA |
| `--muted` `#6b6355` on surface | 5.83:1 | AA |
| `--muted` on surface-2 `#f1eadb` | 4.95:1 | AA |
| buy `#0a6b45` on surface / on `--buy-soft` | 6.45 / 5.59:1 | AA |
| maybe `#96600a` on surface / on `--maybe-soft` | 5.19 / 4.59:1 | AA |
| pass `#575f6d` on surface / on `--pass-soft` | 6.33 / 5.30:1 | AA |
| amber `#a75d07` on surface / on bg | 4.90 / 4.50:1 | AA |
| control border `--line-strong` `#94845f` on surface / bg / surface-2 | 3.61 / 3.31 / 3.06:1 | 1.4.11 (non-text) |

**Dark theme**

| Pair | Ratio | Verdict |
|---|---|---|
| `--ink` `#f4efe4` on surface `#1d1a14` | 15.13:1 | AAA |
| `--ink-2` `#d3cbba` on surface | 10.76:1 | AAA |
| `--muted` `#a89f8f` on surface / on surface-2 | 6.63 / 6.16:1 | AA |
| buy `#5ad9a0` on surface / on `--buy-soft` | 9.81 / 8.73:1 | AAA |
| maybe `#f5c455` on surface / on `--maybe-soft` | 10.67 / 9.26:1 | AAA |
| pass `#9fabbc` on surface / on `--pass-soft` | 7.46 / 6.78:1 | AA |
| amber `#f0b45a` on surface / on bg | 9.41 / 10.14:1 | AAA |
| control border `--line-strong` `#776a52` on surface / surface-2 | 3.28 / 3.05:1 | 1.4.11 (non-text) |

Two deliberate distinctions:

- **`--line` is decorative** (card separation) and is held to "visible but quiet" (light
  1.45:1 / dark 1.50:1 on their backgrounds, up from ~1.28:1).
- **`--line-strong` is load-bearing** — it is the border that makes an input look like an
  input — so it is held to WCAG **1.4.11 non-text contrast** (≥3:1), met in both themes.

The verdict chip fills were checked as text backgrounds too: paper `#fffdf7` on buy /
maybe / pass / amber fills = 6.45 / 5.19 / 6.33 / 4.90:1.

### Touch targets

Every interactive target is ≥44px: `.btn` (`min-height: 44px`), `.tap`, and the previously
stretched checkbox, which now has its 44px hit area on the label.

### ARIA

- Verdict decision announced once from a mount-only effect via the always-mounted
  `Announcer` (`role="status"`, `aria-live="polite"`, `aria-atomic`) — not on every
  keystroke.
- Progress: concise `role="status"` step announcer + live `<ol>` with `aria-label="Scan progress"`.
- Listings: `role="tablist"` / `role="tab"` with `aria-selected` and
  `aria-controls="listings-panel"`; the panel is `role="tabpanel"` with
  `aria-labelledby="listings-tab-{tab}"`. Tab labels include `<span class="sr-only-text">
  listings</span>` so "Queue" and "Sold" are disambiguated out of context.
- Meaning carried by icons (far-from-expected flag, progress rows) is exposed via
  `sr-only-text` instead of an ignored `aria-label`.
- `Sheet` retains `role="dialog"`, `aria-modal="true"`, Escape-to-close, focus-on-open,
  and body scroll lock.
- Scan now opens the outline with an `h1`.

### Motion

`prefers-reduced-motion` is honoured in both CSS and JS; see §4.7.

---

## 7. One-line summary

**The verdict card went from a report to a decision:** the number that answers the
question is now the biggest thing on the screen, it shows the arithmetic that produced it,
it refuses to call "no price typed" a BUY, and it says its answer out loud — while every
other screen was brought onto the same rhythm, the same measured contrast, and the same
rule that colour is never the only signal.
