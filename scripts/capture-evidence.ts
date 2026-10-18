/**
 * Capture the media, from the real app, deterministically.
 *
 * Every screenshot in docs/media/ and the demo video are produced by this script —
 * not staged, not mocked. It drives a real browser against a real brain, and the app
 * it drives has been seeded from the committed fixture so two runs look the same.
 *
 * Run (brain up, web build served on :3000):
 *   pnpm build
 *   pnpm --filter @sourcerer/web preview &
 *   pnpm evidence:capture
 *
 * Requires Chrome (it uses your installed one, so nothing is downloaded).
 *
 * The output names are `<shot>.<theme>.png` on purpose: the README and the post both
 * reference stable paths, and a capture that drifts from the submitted commit is worse
 * than no capture at all.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

const APP = process.env.APP_URL ?? "http://127.0.0.1:3000";
const BRAIN = process.env.BRAIN_URL ?? "http://127.0.0.1:8787";
const LANDING = process.env.LANDING_URL ?? "http://127.0.0.1:4173";
const MEDIA = resolve(process.cwd(), "docs/media");
const VIDEO_DIR = resolve(process.cwd(), "docs/media/.video");

/** The items this capture run will scan. Same items every run, so the frames match. */
const SCANS = [
  { text: "Levi's 501 Big E selvedge denim jacket, size 42, small hole at cuff", asking: "12" },
  { text: "Pyrex 444 Cinderella mixing bowl, green, nesting set of 3", asking: "18" },
  { text: "Pendleton wool board shirt, size L, teal plaid, one button missing", asking: "9" },
  { text: "Griswold cast iron skillet #8, small block logo, seasoned", asking: "40" },
];

const FREEZE_CSS = `*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  caret-color: transparent !important;
}
/* Smooth scrolling is JavaScript-driven, so the transition rules above do not stop it.
   Left alone, a frame shot mid-scroll lands at a slightly different offset each capture,
   which is most of why two runs produced different screenshots. */
html { scroll-behavior: auto !important; }`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function freeze(page: Page) {
  await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {});
}

const shots: string[] = [];

/**
 * The visible text of every frame, keyed by `name.theme`.
 *
 * A screenshot is evidence you have to look at, which means a caption quoting "$35.32" is
 * taken on trust. This is the same evidence in a form that can be grepped, so the numbers
 * in the captions and the alt text can be checked against the frames they describe.
 */
const frames: Record<string, string> = {};

async function shot(page: Page, name: string, theme: "light" | "dark") {
  const file = resolve(MEDIA, `${name}.${theme}.png`);
  await freeze(page);
  // Wait for the scroll to actually stop, and prove it stopped, rather than hoping a fixed
  // timeout was long enough. A frame taken while the page is still moving is the same page
  // at a different offset — visually plausible and not reproducible.
  let y = await page.evaluate(() => window.scrollY);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(75);
    const now = await page.evaluate(() => window.scrollY);
    if (now === y) break;
    y = now;
  }
  await page.screenshot({ path: file, fullPage: false });
  frames[`${name}.${theme}`] = (await page.evaluate(() => document.body.innerText)).trim();
  shots.push(`${name}.${theme}.png`);
  console.log(`  · ${name}.${theme}.png`);
}

async function seed() {
  // `?reset=1` clears inventory and sold history first. Without it, seeding appends, so
  // each capture started with more "already sold" history than the last and the comparable
  // set grew from 10 items to 15 across three runs — the same item, the same fixture, a
  // different answer.
  const res = await fetch(`${BRAIN}/demo/seed?reset=1`, { method: "POST" });
  const body = (await res.json()) as { inventory?: number; seeded?: number };
  console.log(`seeded: ${body.seeded} sold records, ${body.inventory} inventory items`);
}

/**
 * The screenshots only stand as evidence if they are reproducible, and they are not unless
 * the model's sampler is pinned. Without a seed the same description can come back
 * identified as condition `good` in one run and `fair` in the next, which changes the
 * comparable set and moves the price — so the frames below would quietly disagree with the
 * numbers quoted next to them.
 *
 * The brain reports its seed on /health, so this is checked rather than assumed.
 */
async function checkSampler() {
  const res = await fetch(`${BRAIN}/health`).catch(() => null);
  const body = res?.ok ? ((await res.json()) as { seed?: number | null }) : {};
  if (body.seed == null) {
    console.log(
      "  ! the brain has no OLLAMA_SEED pinned — frames will not match the committed ones.",
    );
    console.log("    Restart it with OLLAMA_SEED=7 to reproduce them.");
  } else {
    console.log(`sampler pinned: OLLAMA_SEED=${body.seed}`);
  }
}

/** Fill the capture form and run one scan, then save it. */
async function scan(page: Page, text: string, asking: string) {
  await page.locator("textarea").first().fill(text);
  await page.locator('input[aria-label="Asking price"]').first().fill(asking);
  await freeze(page);
  await page.getByRole("button", { name: /^Price it/ }).click();
}

async function waitVerdict(page: Page) {
  await page.locator('section[aria-label="Verdict"]').waitFor({ state: "visible", timeout: 600_000 });
  await page.waitForTimeout(900);
}

async function resetToCapture(page: Page) {
  // "Next item" is the app's own reset: it clears the result and the capture form but
  // leaves the queue in IndexedDB alone, which is exactly what the next screenshot needs.
  const next = page.getByRole("button", { name: /Next item/ }).first();
  if (await next.count()) {
    await next.click();
    await page.waitForTimeout(600);
    return;
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
}

/** Save the current scan to the queue, so Listings and Insights have something real. */
async function save(page: Page) {
  const btn = page.getByRole("button", { name: /^Save$/ }).first();
  if (await btn.count()) {
    await btn.click().catch(() => {});
    await page.waitForTimeout(1300);
  }
}

/** Close whatever disclosure is open, so the next shot is not taken through a panel. */
async function collapse(page: Page) {
  const open = page.locator("details[open]").first();
  if (await open.count()) {
    await open.locator("summary").first().click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(350);
  }
}

async function expand(page: Page, pattern: RegExp) {
  const el = page.getByText(pattern).first();
  if (await el.count()) {
    await el.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

/**
 * Bring the top of the verdict card back into frame.
 *
 * Opening and collapsing the two disclosures under "The fine print" grows and shrinks
 * the page, which leaves the scroll position parked next to the rail instead of the
 * banner. The PASS shot is a picture of the refusal — the banner and the ceiling — so it
 * has to be framed there rather than wherever the last disclosure left the viewport.
 */
async function focusVerdictTop(page: Page) {
  await page
    .locator('section[aria-label="Verdict"]')
    .first()
    .evaluate((el) => el.scrollIntoView({ block: "start" }))
    .catch(() => {});
  await page.waitForTimeout(350);
}

/** Toasts auto-dismiss after 4.2 s; wait past that so they do not sit over a screenshot. */
async function clearToasts(page: Page) {
  if (await page.locator('[role="status"] >> text=/Logged|Saved|written|draft/').count()) {
    await page.waitForTimeout(4600);
  }
}

/**
 * Load the models before the first screenshot.
 *
 * This is not only about speed. Ollama returns marginally different logits on the first
 * call after a load than on the call after that — the same description came back
 * categorised `Jeans` on a cold call and `Jeans & Jackets` once the model was resident —
 * so a capture that starts cold is not comparable with one that starts warm, and two
 * captures could disagree about the price for a reason that has nothing to do with the
 * product. The throwaway scan and listing pay for the load; every frame that follows comes
 * from the same settled state.
 */
async function warmModels() {
  const t0 = Date.now();
  const scan = await fetch(`${BRAIN}/scan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Warm-up item, discarded. Nothing here is captured.", askingPrice: 1 }),
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (scan) {
    await fetch(`${BRAIN}/listing`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identification: scan.identification,
        price: scan.price,
        comps: scan.comps,
      }),
    }).catch(() => null);
  }
  console.log(`models warm (${Date.now() - t0} ms)`);
}

async function main() {
  if (!existsSync(MEDIA)) mkdirSync(MEDIA, { recursive: true });
  if (existsSync(VIDEO_DIR)) rmSync(VIDEO_DIR, { recursive: true, force: true });
  mkdirSync(VIDEO_DIR, { recursive: true });

  await checkSampler();
  await warmModels();
  await seed();

  const browser = await chromium.launch({ channel: "chrome", headless: true });

  const mkContext = (opts: { width: number; height: number; record?: boolean }) =>
    browser.newContext({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: 2,
      locale: "en-US",
      timezoneId: "Asia/Kolkata",
      reducedMotion: "reduce",
      colorScheme: "light",
      recordVideo: opts.record ? { dir: VIDEO_DIR, size: { width: opts.width, height: opts.height } } : undefined,
    });

  /**
   * One context for every screenshot, deliberately.
   *
   * The first version of this script gave the desktop pass its own context, which
   * meant an empty IndexedDB, which meant the Insights screenshot said "No numbers
   * yet". Captured items live in the browser, not on the server, so every screenshot
   * has to come from the same browser. The viewport is resized instead, and the video
   * gets its own short context so it stays a clean phone-shaped demo.
   */
  console.log("\npass 1 — mobile, light");
  const ctx = await mkContext({ width: 390, height: 844 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  [page error] ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`  [console] ${m.text().slice(0, 140)}`);
  });

  await page.goto(APP, { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(2500);
  await shot(page, "scan.empty", "light");

  // ① the verdict card. ⑥ staged progress on the way there.
  console.log("\n  scan 1 — the BUY verdict");
  await scan(page, SCANS[0]!.text, SCANS[0]!.asking);
  await page.waitForTimeout(2500);
  await shot(page, "scan.progress", "light");
  await waitVerdict(page);
  await shot(page, "verdict.buy", "light");

  // ④ the run log, which is what makes the privacy claim checkable.
  await expand(page, /^What ran where/);
  await shot(page, "ranlog", "light");
  await collapse(page);
  await page.waitForTimeout(400);

  // ⑤ comps, expanded.
  await expand(page, /^Comparables/);
  await shot(page, "comps.expanded", "light");
  await collapse(page);
  await page.waitForTimeout(400);

  // ③ a PASS. Editing the tag price re-prices offline, instantly — no model call.
  console.log("\n  same item, an absurd tag price → PASS (offline re-price)");
  const priceInput = page.locator('section[aria-label="Verdict"] input[aria-label="Asking price"]').first();
  await priceInput.fill("999");
  await page.waitForTimeout(900);
  await focusVerdictTop(page);
  await freeze(page);
  await shot(page, "verdict.pass", "light");

  // Put it back to the number a person would actually pay, then save, so the queue
  // holds items with a real buy price and the Insights profit numbers mean something.
  await priceInput.fill(SCANS[0]!.asking);
  await page.waitForTimeout(700);
  await save(page);

  // ── a queue worth screenshotting ───────────────────────────────────────────
  console.log("\n  three more scans so the queue and the tallies are real");
  for (const s of SCANS.slice(1)) {
    await resetToCapture(page);
    await scan(page, s.text, s.asking);
    await waitVerdict(page);
    await save(page);
  }

  // ⑦ the listings queue.
  console.log("\n  listings");
  await page.getByRole("link", { name: "Listings" }).click();
  await page.waitForTimeout(1800);
  await clearToasts(page);
  await shot(page, "listings.queue", "light");

  // Log two sales so Insights has realised profit and a sell-through number.
  for (let i = 0; i < 2; i++) {
    const sold = page.getByRole("button", { name: /^Sold$/ }).first();
    if (!(await sold.count())) break;
    await sold.click();
    await page.waitForTimeout(900);
    const logSale = page.getByRole("button", { name: /Log sale/ }).first();
    if (await logSale.count()) {
      await logSale.click();
      await page.waitForTimeout(1100);
    }
  }
  await clearToasts(page);
  await shot(page, "listings.sold", "light");

  // ⑧ insights.
  console.log("\n  insights");
  await page.getByRole("link", { name: "Insights" }).click();
  await page.waitForTimeout(2000);
  await clearToasts(page);
  await page.mouse.wheel(0, 0);
  await shot(page, "insights", "light");

  // ── pass 2: dark theme, same browser, same data ────────────────────────────
  console.log("\npass 2 — mobile, dark");
  await page.getByRole("link", { name: "Scan" }).click();
  await page.waitForTimeout(700);
  const toggle = page.getByRole("button", { name: /Switch to dark theme/ }).first();
  if (await toggle.count()) {
    await toggle.click();
    await page.waitForTimeout(900);
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await shot(page, "scan.empty", "dark");

  // Same item as the light pair, so the dark "BUY" frame is a BUY.
  //
  // This shot used to scan the Pendleton shirt. That shirt prices close enough to its
  // ceiling that a small change in the model's read flips it to PASS (asking $9 against a
  // max offer of $8.13) — and a file called verdict.buy that shows a PASS is exactly the
  // mislabelling this capture set is meant to avoid. The Levi's jacket clears its ceiling
  // by a wide margin, so its BUY is not a coin toss.
  await scan(page, SCANS[0]!.text, SCANS[0]!.asking);
  await waitVerdict(page);
  await shot(page, "verdict.buy", "dark");
  const priceDark = page.locator('section[aria-label="Verdict"] input[aria-label="Asking price"]').first();
  await priceDark.fill("999");
  await page.waitForTimeout(900);
  await focusVerdictTop(page);
  await freeze(page);
  await shot(page, "verdict.pass", "dark");
  await collapse(page);
  await expand(page, /^What ran where/);
  await shot(page, "ranlog", "dark");
  await collapse(page);
  await expand(page, /^Comparables/);
  await shot(page, "comps.expanded", "dark");
  await collapse(page);

  await page.getByRole("link", { name: "Insights" }).click();
  await page.waitForTimeout(1800);
  await shot(page, "insights", "dark");
  await page.getByRole("link", { name: "Listings" }).click();
  await page.waitForTimeout(1500);
  await shot(page, "listings.queue", "dark");

  // ── pass 3: genuinely offline ──────────────────────────────────────────────
  // This is the thesis shot: the chip says offline, and the app still answers.
  console.log("\npass 3 — network actually off");
  await ctx.setOffline(true);
  await page.getByRole("link", { name: "Scan" }).click().catch(() => {});
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(3000);
  await shot(page, "offline.shell", "dark");
  await scan(page, SCANS[1]!.text, SCANS[1]!.asking);
  await page.waitForTimeout(7000);
  await shot(page, "offline.verdict", "dark");
  await ctx.setOffline(false);

  // ── pass 4: desktop, same browser, so the data is still there ─────────────
  console.log("\npass 4 — desktop");
  await page.getByRole("button", { name: /Switch to light theme/ }).first().click().catch(() => {});
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${APP}/insights`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(2200);
  await shot(page, "insights.desktop", "light");
  await page.goto(`${APP}/listings`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  await shot(page, "listings.desktop", "light");
  await page.setViewportSize({ width: 390, height: 844 });
  await ctx.close();

  // ── pass 5: the demo video, its own clean phone-shaped context ────────────
  // Recorded last and recorded briefly: one uninterrupted run, photo-less (the
  // description path) but the real thing end to end.
  console.log("\npass 5 — recording the demo run");
  const vctx = await mkContext({ width: 390, height: 844, record: true });
  const vpage = await vctx.newPage();
  await vpage.goto(APP, { waitUntil: "networkidle", timeout: 90_000 });
  await vpage.waitForTimeout(2500);
  await scan(vpage, SCANS[3]!.text, SCANS[3]!.asking);
  await waitVerdict(vpage);
  const vprice = vpage.locator('section[aria-label="Verdict"] input[aria-label="Asking price"]').first();
  await vprice.fill("60");
  await vpage.waitForTimeout(1600);
  await expand(vpage, /^What ran where/);
  await vpage.waitForTimeout(2200);
  await collapse(vpage);
  // Save here, in the video's own context, before leaving for Insights.
  //
  // The video is recorded in its own browser context, so it starts with an empty
  // IndexedDB. Without a capture saved, the closing Insights screen reads "No numbers
  // yet" — the last thing a viewer sees, and a wrong one, because the product does have
  // this item. Saving one capture makes the closing screen show real local numbers.
  await save(vpage);
  await clearToasts(vpage);
  await vpage.getByRole("link", { name: "Insights" }).click().catch(() => {});
  await vpage.waitForTimeout(3000);
  await vctx.close();
  const video = await vpage.video();
  const videoPath = video ? await video.path() : null;
  if (videoPath && existsSync(videoPath)) {
    const dest = resolve(MEDIA, "sourcerer-demo.webm");
    renameSync(videoPath, dest);
    console.log(`  video: sourcerer-demo.webm (${(statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`);
  }

  // ── pass 6: the landing page, for the .tech category ──────────────────────
  // Copy the captures in first: the landing page embeds them, and a hero with broken
  // image placeholders is a worse screenshot than no screenshot.
  const imgDir = resolve(process.cwd(), "landing/img");
  mkdirSync(imgDir, { recursive: true });
  for (const [src, dest] of [
    ["scan.empty.light", "01-scan-empty"],
    ["scan.progress.light", "02-scan-filled"],
    ["verdict.buy.light", "03-verdict"],
    ["ranlog.light", "04-provenance"],
    ["listings.queue.light", "05-listings"],
    ["insights.light", "06-insights"],
    ["verdict.pass.light", "07-pass"],
    ["offline.shell.dark", "08-offline"],
  ] as const) {
    const from = resolve(MEDIA, `${src}.png`);
    if (existsSync(from)) copyFileSync(from, resolve(imgDir, `${dest}.png`));
  }

  // The landing page reads its two headline numbers from here, so the page cannot
  // drift away from the evidence the way a hand-typed statistic would.
  const evalPath = resolve(process.cwd(), "docs/evidence/identify-results.json");
  if (existsSync(evalPath)) {
    const ev = JSON.parse(readFileSync(evalPath, "utf8")) as {
      variants: { id: string; combinedRate: number; medianMs: number }[];
    };
    const best = ev.variants.at(-1)!;
    writeFileSync(
      resolve(process.cwd(), "landing/evidence.json"),
      JSON.stringify(
        {
          accuracy: `${Math.round(best.combinedRate * 100)}%`,
          speed: `${(best.medianMs / 1000).toFixed(1)}s`,
          source: `docs/evidence/identify-results.json (${best.id})`,
        },
        null,
        2,
      ),
    );
    console.log(`\nlanding/evidence.json ← ${best.id}: ${Math.round(best.combinedRate * 100)}%, ${(best.medianMs / 1000).toFixed(1)}s`);
  }

  console.log("\npass 6 — landing page");
  const lctx = await mkContext({ width: 1440, height: 900 });
  const lpage = await lctx.newPage();
  const landingUp = await lpage
    .goto(LANDING, { waitUntil: "networkidle", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (landingUp) await shot(lpage, "landing", "light");
  else console.log("  (landing not served — skipping; run: pnpm landing)");
  await lctx.close();

  await browser.close();

  writeFileSync(resolve(MEDIA, "captured.json"), JSON.stringify({ at: new Date().toISOString(), app: APP, shots }, null, 2));
  // The same evidence the screenshots carry, in text, so a number quoted in a caption can be
  // checked against the frame it describes.
  writeFileSync(resolve(MEDIA, "frames.json"), JSON.stringify(frames, null, 2));
  console.log(`\n${shots.length} screenshots + video → docs/media/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
