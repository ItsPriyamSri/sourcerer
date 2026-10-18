import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { nanoid } from "nanoid";
import type { CapturedItem, Capabilities, ScanStage } from "@sourcerer/shared";
import {
  ScanRequestZ,
  ListingDraftZ,
  defaultCostModel,
  portfolioStats,
  formatMoney,
  formatMultiple,
} from "@sourcerer/shared";
import { config, modelRoute } from "./env.ts";
import { mastra, sourcingAdvisor } from "./mastra/index.ts";
import { brainSummary } from "./mastra/agents.ts";
import { runScan, writeListing, identify, findComps, estimatePrice } from "./core/steps.ts";
import {
  listItems,
  saveItem,
  patchItem,
  deleteItem,
  soldHistory,
  recordSold,
  savePhoto,
  getItem,
} from "./core/store.ts";
import { hasVectorDb, similarItems, embed, ensureSchema } from "./providers/vector.ts";
import { hasVoice, transcribe, speak } from "./providers/voice.ts";
import { initTracing, tracingEnabled, captureError } from "./providers/tracing.ts";
import { llmProviders } from "./providers/llm.ts";
import { TabPfnPricingEngine } from "./providers/pricing.ts";
import { HeuristicPricingEngine } from "./providers/pricing.ts";

/**
 * The brain's HTTP surface. Thin by design: every route does one thing and calls
 * a function that is also used elsewhere, so behaviour cannot diverge between the
 * app, the workflow and the tests.
 */

const app = new Hono();

app.use(
  "*",
  cors({
    origin: (origin) => (config.allowedOrigins.includes(origin) ? origin : config.allowedOrigins[0] ?? "*"),
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["content-type", "authorization"],
  }),
);

app.onError((err, c) => {
  captureError(err, { path: c.req.path });
  console.error(`[error] ${c.req.method} ${c.req.path}:`, err);
  return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
});

// ── health & capabilities ──────────────────────────────────────────────────

app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString(), tracing: tracingEnabled() }));

app.get("/capabilities", async (c) => {
  const brain = brainSummary();
  const ollamaStatus = await llmProviders.ollama.status();
  const backboardUp = await llmProviders.backboard.available();
  const ollamaUp = ollamaStatus.ready;
  const caps: Capabilities = {
    llm: [
      {
        provider: "ollama",
        model: config.ollama.model,
        local: true,
        available: ollamaUp,
        detail: !ollamaStatus.reachable
          ? "Ollama is not running on this machine."
          : ollamaStatus.missing.length
            ? `Waiting on model pull: ${ollamaStatus.missing.join(", ")}`
            : `Loaded: ${ollamaStatus.models.join(", ")}`,
      },
      {
        provider: "backboard",
        model: config.backboard.model,
        local: false,
        available: backboardUp,
        detail: config.backboard.apiKey ? undefined : "No BACKBOARD_API_KEY set.",
      },
    ],
    comps: [
      {
        provider: "serpapi (live eBay)",
        local: false,
        available: Boolean(config.serpapi.apiKey),
        detail: config.serpapi.apiKey ? undefined : "No SERPAPI_API_KEY set — using your own sold history instead.",
      },
      { provider: "your sold history", local: true, available: true },
    ],
    pricing: { tabpfn: Boolean(config.tabpfn.token), tabpfnLocal: false },
    tracing: { sentry: tracingEnabled() },
    voice: { elevenlabs: hasVoice() },
    durable: { temporal: true },
    vector: { pgvector: hasVectorDb(), provider: config.db.url.includes("timescale") ? "tiger-data" : hasVectorDb() ? "postgres" : undefined },
    privacy: brain.local
      ? "Photos and pricing run on this device. Nothing is uploaded unless you turn on live comps."
      : "Using Backboard for inference (open-weight models). Photos go to your Backboard account only.",
  };
  return c.json({ ...caps, brain });
});

// ── the core scan ──────────────────────────────────────────────────────────

app.post("/scan", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = ScanRequestZ.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid request", detail: parsed.error.issues }, 400);

  const accept = c.req.header("accept") ?? "";
  if (accept.includes("text/event-stream")) {
    return streamSSE(c, async (stream) => {
      try {
        const result = await runScan(parsed.data, async (stage: ScanStage) => {
          await stream.writeSSE({ event: "stage", data: JSON.stringify(stage) });
        });
        await stream.writeSSE({ event: "result", data: JSON.stringify(result) });
      } catch (err) {
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ message: err instanceof Error ? err.message : String(err) }),
        });
      }
    });
  }

  return c.json(await runScan(parsed.data));
});

// ── individual steps, for the UI's "re-price" and "identify only" paths ────

app.post("/identify", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { image?: string; text?: string };
  const out = await identify({ image: body.image, text: body.text });
  return c.json(out);
});

app.post("/comps", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { identification: never; offline?: boolean };
  const out = await findComps({ identification: body.identification, offline: body.offline });
  return c.json(out);
});

app.post("/price", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { identification: never; comps: never };
  const out = await estimatePrice({ identification: body.identification, comps: body.comps });
  return c.json(out);
});

app.post("/listing", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    identification: never;
    price: never;
    comps: never;
    cost?: { marketplace: string };
    itemId?: string;
  };
  const { listing, ran } = await writeListing(body);
  if (body.itemId) await patchItem(body.itemId, { listing });
  return c.json({ listing, ran });
});

// ── the advisor agent (Mastra, with tools, with memory) ────────────────────

const AdvisorBody = z.object({
  message: z.string().min(1),
  threadId: z.string().optional(),
  resourceId: z.string().optional(),
  scan: z.any().optional(),
});

app.post("/advisor", async (c) => {
  const parsed = AdvisorBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid request" }, 400);
  const { message, threadId, resourceId } = parsed.data;

  try {
    const res = await sourcingAdvisor.generate(message, {
      memory: {
        thread: threadId ?? `thread-${nanoid(8)}`,
        resource: resourceId ?? "local-reseller",
      },
      maxSteps: 6,
    });
    return c.json({
      text: res.text,
      threadId: threadId ?? null,
      agent: "sourcing-advisor",
      model: brainSummary(),
    });
  } catch (err) {
    // The advisor is an enhancement, never a dependency. If the local model cannot
    // tool-call, answer deterministically from the same numbers instead of 500ing.
    captureError(err, { route: "advisor" });
    const scan = parsed.data.scan as
      | { verdict?: { label: string; maxOffer: number; reason: string }; price?: { expected: number }; identification?: { title: string } }
      | undefined;
    if (scan?.verdict) {
      return c.json({
        text: `${scan.identification?.title ?? "This item"}: ${scan.verdict.label}. ${scan.verdict.reason} Do not pay more than ${formatMoney(
          scan.verdict.maxOffer,
        )}.`,
        degraded: true,
        agent: "sourcing-advisor",
      });
    }
    return c.json(
      { text: "The local model is not available right now. Scan an item and I will price it locally.", degraded: true },
      200,
    );
  }
});

// ── inventory ──────────────────────────────────────────────────────────────

app.get("/inventory", async (c) => c.json({ items: await listItems() }));

app.post("/inventory", async (c) => {
  const item = (await c.req.json().catch(() => null)) as CapturedItem | null;
  if (!item?.id) return c.json({ error: "item with id required" }, 400);
  await saveItem(item);
  if (hasVectorDb()) {
    const text = `${item.identification.title} ${item.identification.brand ?? ""} ${item.identification.category}`;
    void ensureSchema().then(() => embed(text)).then((v) =>
      import("./providers/vector.ts").then(({ upsertItem }) =>
        upsertItem({
          id: item.id,
          title: item.identification.title,
          brand: item.identification.brand,
          category: item.identification.category,
          condition: item.identification.condition,
          soldFor: item.soldFor,
          embedding: v,
        }),
      ),
    );
  }
  return c.json({ ok: true });
});

app.get("/inventory/:id", async (c) => {
  const item = await getItem(c.req.param("id"));
  return item ? c.json(item) : c.json({ error: "not found" }, 404);
});

app.patch("/inventory/:id", async (c) => {
  const patch = (await c.req.json().catch(() => ({}))) as Partial<CapturedItem>;
  const item = await patchItem(c.req.param("id"), patch);
  return item ? c.json(item) : c.json({ error: "not found" }, 404);
});

app.delete("/inventory/:id", async (c) => {
  const ok = await deleteItem(c.req.param("id"));
  return ok ? c.json({ ok }) : c.json({ error: "not found" }, 404);
});

/** Mark an item sold. This is the event that teaches the local price model. */
app.post("/inventory/:id/sold", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { soldFor?: number; daysToSell?: number };
  const item = await getItem(c.req.param("id"));
  if (!item) return c.json({ error: "not found" }, 404);
  if (!body.soldFor) return c.json({ error: "soldFor required" }, 400);

  await patchItem(item.id, { status: "sold", soldFor: body.soldFor, soldAt: new Date().toISOString() });
  await recordSold({
    title: item.identification.title,
    category: item.identification.category,
    brand: item.identification.brand,
    condition: item.identification.condition,
    price: body.soldFor,
    daysToSell: body.daysToSell,
    compsMedian: item.comps.summary?.median,
    compsCount: item.comps.summary?.count,
  });

  if (hasVectorDb() && item) {
    void embed(item.identification.title).then((v) =>
      import("./providers/vector.ts").then(({ upsertItem }) =>
        upsertItem({
          id: item.id,
          title: item.identification.title,
          brand: item.identification.brand,
          category: item.identification.category,
          condition: item.identification.condition,
          soldFor: body.soldFor,
          embedding: v,
        }),
      ),
    );
  }

  return c.json({ ok: true, learned: true });
});

app.get("/insights", async (c) => {
  const items = await listItems();
  return c.json(portfolioStats(items.map((i) => ({ status: i.status, buyPrice: i.buyPrice, soldFor: i.soldFor, economics: i.verdict.economics }))));
});

app.get("/similar", async (c) => {
  const q = c.req.query("q") ?? "";
  if (!q) return c.json({ items: [] });
  return c.json({ items: await similarItems(q, await embed(q), Number(c.req.query("limit") ?? 5)) });
});

// ── training the local price model ─────────────────────────────────────────

app.post("/train", async (c) => {
  const rows = await soldHistory();
  if (!config.tabpfn.token) {
    return c.json({
      trained: false,
      rows: rows.length,
      reason: "TABPFN_TOKEN not set. Set it to train a real model on your sold history.",
      fallback: "Heuristic pricing (condition-adjusted comps) is active.",
    });
  }
  try {
    const engine = new TabPfnPricingEngine();
    const result = await engine.train(rows);
    return c.json({ trained: true, ...result });
  } catch (err) {
    return c.json({ trained: false, rows: rows.length, reason: err instanceof Error ? err.message : String(err) });
  }
});

// ── voice ──────────────────────────────────────────────────────────────────

app.post("/transcribe", async (c) => {
  if (!hasVoice()) return c.json({ error: "ELEVENLABS_API_KEY not set" }, 501);
  const form = await c.req.formData();
  const file = form.get("audio");
  if (!(file instanceof File)) return c.json({ error: "audio file required" }, 400);
  return c.json({ text: await transcribe(file, file.name || "note.webm") });
});

app.post("/speak", async (c) => {
  if (!hasVoice()) return c.json({ error: "ELEVENLABS_API_KEY not set" }, 501);
  const { text } = (await c.req.json().catch(() => ({ text: "" }))) as { text?: string };
  if (!text) return c.json({ error: "text required" }, 400);
  const audio = await speak(text);
  return c.body(new Uint8Array(audio), 200, { "content-type": "audio/mpeg" });
});

// ── photos ─────────────────────────────────────────────────────────────────

app.post("/photo", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { id?: string; dataUrl?: string };
  if (!body.id || !body.dataUrl) return c.json({ error: "id and dataUrl required" }, 400);
  const b64 = body.dataUrl.includes("base64,") ? body.dataUrl.split("base64,")[1]! : body.dataUrl;
  const path = await savePhoto(body.id, Buffer.from(b64, "base64"));
  await patchItem(body.id, { imagePath: path });
  return c.json({ path });
});

// ── a small demo helper so a judge can see it work in one click ────────────

app.post("/demo/seed", async (c) => {
  const history = [
    { title: "Levi's 501 Big E selvedge denim jacket", category: "denim jacket", brand: "Levi's", condition: "good", price: 145, daysToSell: 21, compsMedian: 150, compsCount: 18 },
    { title: "Pyrex 444 Cinderella mixing bowl set", category: "glassware", brand: "Pyrex", condition: "good", price: 68, daysToSell: 9, compsMedian: 72, compsCount: 31 },
    { title: "Nikon FM2 35mm film camera body", category: "film camera", brand: "Nikon", condition: "like_new", price: 230, daysToSell: 14, compsMedian: 240, compsCount: 12 },
    { title: "Pendleton wool board shirt", category: "shirt", brand: "Pendleton", condition: "good", price: 52, daysToSell: 11, compsMedian: 55, compsCount: 25 },
    { title: "Ludwig Acrolite snare drum", category: "drum", brand: "Ludwig", condition: "fair", price: 180, daysToSell: 33, compsMedian: 210, compsCount: 8 },
    { title: "Cast iron Griswold #8 skillet", category: "cookware", brand: "Griswold", condition: "good", price: 88, daysToSell: 6, compsMedian: 92, compsCount: 40 },
    { title: "Polaroid SX-70 folding camera", category: "camera", brand: "Polaroid", condition: "like_new", price: 195, daysToSell: 19, compsMedian: 205, compsCount: 15 },
    { title: "Stetson Open Road 7 1/4 straw hat", category: "hat", brand: "Stetson", condition: "good", price: 64, daysToSell: 13, compsMedian: 70, compsCount: 22 },
    { title: "Sony Walkman WM-EX674 cassette player", category: "audio", brand: "Sony", condition: "good", price: 95, daysToSell: 24, compsMedian: 105, compsCount: 9 },
    { title: "MCM teak serving tray Denmark", category: "homeware", brand: "unknown", condition: "good", price: 34, daysToSell: 8, compsMedian: 38, compsCount: 27 },
    { title: "Fender Princeton Reverb amp chassis", category: "amplifier", brand: "Fender", condition: "fair", price: 420, daysToSell: 41, compsMedian: 470, compsCount: 6 },
    { title: "Woolrich 60/40 mountain parka", category: "coat", brand: "Woolrich", condition: "good", price: 78, daysToSell: 16, compsMedian: 85, compsCount: 20 },
  ];
  for (const h of history) await recordSold(h);
  return c.json({ ok: true, seeded: history.length, note: "Sold history seeded. Set TABPFN_TOKEN and POST /train to fit the price model." });
});

/** Kick off the durable reprice workflow (Temporal). */
app.post("/reprice", async (c) => {
  const { startReprice } = await import("./durable/client.ts");
  try {
    const out = await startReprice();
    return c.json(out);
  } catch (err) {
    return c.json({
      started: false,
      reason: err instanceof Error ? err.message : String(err),
      hint: "Start Temporal with: temporal server start-dev — and run the worker: pnpm --filter @sourcerer/brain worker",
    });
  }
});

// ── boot ───────────────────────────────────────────────────────────────────

const tracing = initTracing();
console.log(`[sourcerer] tracing: ${tracing ? "Sentry on" : "off (no SENTRY_DSN)"}`);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[sourcerer] brain listening on http://127.0.0.1:${info.port}`);
  console.log(`[sourcerer] model route: ${brainSummary().provider} / ${brainSummary().model} (local=${brainSummary().local})`);
});

export { app };
export type App = typeof app;
