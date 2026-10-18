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
}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function freeze(page: Page) {
  await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {});
}

const shots: string[] = [];

async function shot(page: Page, name: string, theme: "light" | "dark") {
  const file = resolve(MEDIA, `${name}.${theme}.png`);
  await freeze(page);
  await page.screenshot({ path: file, fullPage: false });
  shots.push(`${name}.${theme}.png`);
  console.log(`  · ${name}.${theme}.png`);
}

async function seed() {
  const res = await fetch(`${BRAIN}/demo/seed`, { method: "POST" });
  const body = (await res.json()) as { inventory?: number; seeded?: number };
  console.log(`seeded: ${body.seeded} sold records, ${body.inventory} inventory items`);
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
  const again = page.getByRole("button", { name: /Scan another|New scan|Scan something else/ }).first();
  if (await again.count()) {
    await again.click();
    await page.waitForTimeout(500);
    return;
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
}

async function expand(page: Page, pattern: RegExp) {
  const el = page.getByText(pattern).first();
  if (await el.count()) {
    await el.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function main() {
  if (!existsSync(MEDIA)) mkdirSync(MEDIA, { recursive: true });
  if (existsSync(VIDEO_DIR)) rmSync(VIDEO_DIR, { recursive: true, force: true });
  mkdirSync(VIDEO_DIR, { recursive: true });

  await seed();

  const browser = await chromium.launch({ channel: "chrome", headless: true });

  const mkContext = (opts: { width: number; height: number; dark?: boolean; record?: boolean }) =>
    browser.newContext({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: 2,
      locale: "en-US",
      timezoneId: "Asia/Kolkata",
      reducedMotion: "reduce",
      colorScheme: opts.dark ? "dark" : "light",
      recordVideo: opts.record ? { dir: VIDEO_DIR, size: { width: opts.width, height: opts.height } } : undefined,
    });

  // ── pass 1: the core loop, light theme, mobile ─────────────────────────────
  console.log("\npass 1 — mobile, light");
  const ctx = await mkContext({ width: 390, height: 844, record: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  [page error] ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`  [console] ${m.text().slice(0, 140)}`);
  });

  await page.goto(APP, { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(2000);
  await shot(page, "scan.empty", "light");

  // ① the verdict card. ② the offline/local chips. ⑥ staged progress on the way.
  console.log("\n  scan 1 — the BUY verdict");
  await scan(page, SCANS[0]!.text, SCANS[0]!.asking);
  await page.waitForTimeout(2500);
  await shot(page, "scan.progress", "light");
  await waitVerdict(page);
  await shot(page, "verdict.buy", "light");

  // ④ the run log, which is what makes the privacy claim checkable.
  await expand(page, /^What ran where/);
  await shot(page, "ranlog", "light");
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);

  // ⑤ comps, expanded.
  await expand(page, /^Comparables/);
  await shot(page, "comps.expanded", "light");
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);

  // ③ a PASS. Editing the tag price re-prices offline, instantly — no model call.
  console.log("\n  same item, an absurd tag price → PASS (offline re-price)");
  const priceInput = page.locator('section[aria-label="Verdict"] input[aria-label="Asking price"]').first();
  await priceInput.fill("999");
  await page.waitForTimeout(900);
  await freeze(page);
  await shot(page, "verdict.pass", "light");

  // Put it back and save, so the queue is populated for the later shots.
  await priceInput.fill(SCANS[0]!.asking);
  await page.waitForTimeout(600);
  const save = page.getByRole("button", { name: /^Save$/ }).first();
  if (await save.count()) {
    await save.click();
    await page.waitForTimeout(1000);
  }

  // ── a queue worth screenshotting ───────────────────────────────────────────
  console.log("\n  three more scans so the queue and the tallies are real");
  for (const s of SCANS.slice(1)) {
    await resetToCapture(page);
    await scan(page, s.text, s.asking);
    await waitVerdict(page);
    const sv = page.getByRole("button", { name: /^Save$/ }).first();
    if (await sv.count()) {
      await sv.click().catch(() => {});
      await page.waitForTimeout(900);
    }
  }

  // ⑦ the listings queue.
  console.log("\n  listings");
  await page.getByRole("link", { name: "Listings" }).click();
  await page.waitForTimeout(1500);
  await shot(page, "listings.queue", "light");

  // Log one sale so Insights has a sold row and a sell-through number.
  const sold = page.getByRole("button", { name: /^Sold$/ }).first();
  if (await sold.count()) {
    await sold.click();
    await page.waitForTimeout(800);
    const logSale = page.getByRole("button", { name: /Log sale/ }).first();
    if (await logSale.count()) {
      await logSale.click();
      await page.waitForTimeout(900);
    }
  }

  // ⑧ insights.
  console.log("\n  insights");
  await page.getByRole("link", { name: "Insights" }).click();
  await page.waitForTimeout(1500);
  await shot(page, "insights", "light");

  // ── pass 2: dark theme ─────────────────────────────────────────────────────
  console.log("\npass 2 — mobile, dark");
  await page.getByRole("link", { name: "Scan" }).click();
  await page.waitForTimeout(600);
  const toggle = page.getByRole("button", { name: /Switch to dark theme/ }).first();
  if (await toggle.count()) {
    await toggle.click();
    await page.waitForTimeout(900);
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await shot(page, "scan.empty", "dark");

  await scan(page, SCANS[2]!.text, SCANS[2]!.asking);
  await waitVerdict(page);
  await shot(page, "verdict.buy", "dark");
  const priceInputDark = page.locator('section[aria-label="Verdict"] input[aria-label="Asking price"]').first();
  await priceInputDark.fill("400");
  await page.waitForTimeout(900);
  await freeze(page);
  await shot(page, "verdict.pass", "dark");

  await expand(page, /^What ran where/);
  await shot(page, "ranlog", "dark");
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
  await expand(page, /^Comparables/);
  await shot(page, "comps.expanded", "dark");

  // ── pass 3: genuinely offline ──────────────────────────────────────────────
  // This is the thesis shot: the chip says offline, and the app still answers.
  console.log("\npass 3 — network actually off");
  await ctx.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(2500);
  await shot(page, "offline.shell", "dark");

  await page.getByRole("link", { name: "Scan" }).click().catch(() => {});
  await page.waitForTimeout(800);
  await resetToCapture(page);
  await scan(page, SCANS[1]!.text, SCANS[1]!.asking);
  await page.waitForTimeout(6000);
  await shot(page, "offline.verdict", "dark");
  await ctx.setOffline(false);

  await ctx.close();
  const video = await page.video();
  const videoPath = video ? await video.path() : null;
  if (videoPath && existsSync(videoPath)) {
    const dest = resolve(MEDIA, "sourcerer-demo.webm");
    renameSync(videoPath, dest);
    console.log(`\nvideo: sourcerer-demo.webm (${(statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`);
  }

  // ── pass 4: desktop, for two-up spreads ────────────────────────────────────
  console.log("\npass 4 — desktop");
  const ctx2 = await mkContext({ width: 1440, height: 900 });
  const page2 = await ctx2.newPage();
  await page2.goto(`${APP}/insights`, { waitUntil: "networkidle", timeout: 90_000 });
  await page2.waitForTimeout(2000);
  await shot(page2, "insights", "light"); // overwrites mobile; desktop is the better frame here
  await page2.goto(`${APP}/listings`, { waitUntil: "networkidle" });
  await page2.waitForTimeout(1500);
  await shot(page2, "listings.queue", "light");
  await ctx2.close();

  // ── pass 5: the landing page, for the .tech category ──────────────────────
  console.log("\npass 5 — landing page");
  const ctx3 = await mkContext({ width: 1440, height: 900 });
  const page3 = await ctx3.newPage();
  const landingUp = await page3
    .goto(LANDING, { waitUntil: "networkidle", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (landingUp) await shot(page3, "landing", "light");
  else console.log("  (landing not served — skipping; run: pnpm landing)");
  await ctx3.close();

  await browser.close();

  // ── feed the landing page and the README ──────────────────────────────────
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
    console.log(`landing/evidence.json ← ${best.id}: ${Math.round(best.combinedRate * 100)}%, ${(best.medianMs / 1000).toFixed(1)}s`);
  }

  writeFileSync(resolve(MEDIA, "captured.json"), JSON.stringify({ at: new Date().toISOString(), app: APP, shots }, null, 2));
  console.log(`\n${shots.length} screenshots + video → docs/media/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
