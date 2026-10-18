import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { nanoid } from "nanoid";
import type { CapturedItem, Capabilities, Identification, ScanStage } from "@sourcerer/shared";
import {
  ScanRequestZ,
  ListingDraftZ,
  defaultCostModel,
  mergeCostModel,
  portfolioStats,
  formatMoney,
  formatMultiple,
  round2,
} from "@sourcerer/shared";
import { config, modelRoute } from "./env.ts";
import { mastra, sourcingAdvisor } from "./mastra/index.ts";
import { brainSummary, toolModelThinks } from "./mastra/agents.ts";
import { runScan, writeListing, identify, findComps, estimatePrice, makeVerdict } from "./core/steps.ts";
import {
  listItems,
  saveItem,
  patchItem,
  deleteItem,
  soldHistory,
  recordSold,
  savePhoto,
  getItem,
  clearLocalData,
  type SoldRecord,
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

// `seed` is reported so the evidence capture can prove the sampler was pinned before it
// starts: unpinned captures look fine and are silently not reproducible.
app.get("/health", (c) =>
  c.json({
    ok: true,
    ts: new Date().toISOString(),
    tracing: tracingEnabled(),
    seed: config.ollama.seed ?? null,
  }),
);

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
        provider: "ollama (tools)",
        model: config.ollama.toolModel,
        local: true,
        // Ollama reports Gemma 3 as `completion, vision` — no tool calling. The agent
        // loop needs a tool-capable model, and this is the honest report of whether
        // one is installed.
        available: ollamaStatus.models.includes(config.ollama.toolModel),
        detail: ollamaStatus.models.includes(config.ollama.toolModel)
          ? "Powers the advisor's tool loop."
          : `Run: ollama pull ${config.ollama.toolModel} (Gemma 3 cannot call tools).`,
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
    // Filled in by onStepFinish below, whenever the agent asks for the money math. An array
    // rather than a variable because TypeScript will not let a `let` assigned inside a closure
    // keep its narrowed type at the read site, and because "the last money answer of this turn"
    // is the honest description of what we want.
    const moneyAnswers: { answer?: string }[] = [];

    const res = await sourcingAdvisor.generate(message, {
      memory: {
        thread: threadId ?? `thread-${nanoid(8)}`,
        resource: resourceId ?? "local-reseller",
      },
      maxSteps: 6,
      // Ollama's AI SDK provider defaults `think` to false, and for a reasoning model that
      // is the wrong default in a way that is hard to see: Qwen 3 thinks regardless of the
      // flag, and with it off the deliberation comes back inside `content` — so the agent's
      // answer was several paragraphs of the model arguing with itself about what a tool
      // call is, instead of a recommendation. Turning it on lets Ollama put the reasoning
      // in `thinking`, which the provider surfaces separately, and leaves `res.text` as the
      // actual answer.
      //
      // It has to be derived rather than set, because a model with no thinking mode rejects
      // the flag outright, and because the key is matched against the provider id, which is
      // `ollama` — the model object reports `provider: "ollama.responses"`, and using that
      // string here silently does nothing, which is how this stayed broken through a first
      // round of debugging.
      providerOptions: (await toolModelThinks()) ? { ollama: { think: true } } : undefined,

      // A money answer is the tool's own sentence, not the model's retelling of it.
      //
      // `mastra/tools.ts` has the long version of why; the short version is three runs of the
      // same question that produced three different verdicts from one tool result. This catches
      // that sentence as the loop runs and prefers it below. A turn that never calls a money
      // tool — "what was I looking at?" — still answers in the model's own words.
      onStepFinish: (event) => {
        for (const chunk of event.toolResults ?? []) {
          const payload = chunk?.payload;
          if (payload?.toolName === "feeMath" && !payload.isError && payload.result) {
            moneyAnswers.push(payload.result as { answer?: string });
          }
        }
      },
    });
    const moneyAnswer = moneyAnswers.at(-1)?.answer;
    return c.json({
      text: moneyAnswer ?? res.text,
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
  // `?reset=1` clears inventory and sold history first, so the sample dataset is
  // exactly reproducible — which is what makes every number in docs/evidence and the
  // README mean the same thing wherever it is run.
  const reset = c.req.query("reset") === "1";
  if (reset) await clearLocalData();

  // Sample data lives in a committed fixture, not in this file and not in the
  // gitignored data/ dir — so a clean clone can run the whole offline path, and the
  // numbers in the README and the post come from a file anyone can read.
  const fixture = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../../fixtures/sold.json", import.meta.url)), "utf8"),
  ) as { sold: SoldRecord[] };
  const history = fixture.sold;
  for (const h of history) await recordSold(h);

  // Also build a demo inventory, through the *real* deterministic pipeline
  // (your sold history → comps → price → verdict). Deliberately no model call: the
  // point of the demo dataset is that it works on a machine with no Ollama installed,
  // and that is exactly the offline path this app claims to have.
  const seeded: CapturedItem[] = [];
  for (const [i, h] of history.entries()) {
    const compsMedian = h.compsMedian ?? h.price;
    const identification: Identification = {
      title: h.title,
      category: h.category ?? "unknown",
      brand: h.brand,
      attributes: {},
      condition: h.condition as Identification["condition"],
      keywords: h.title.split(/\s+/).slice(0, 4),
      confidence: 0.82,
    };
    const { comps } = await findComps({ identification, offline: true });
    const { price } = await estimatePrice({ identification, comps });
    const cost = mergeCostModel(defaultCostModel("ebay"));
    // Bought at roughly a third of the eventual sale — a margin a person would take,
    // not a number that flatters the portfolio stats.
    const buyPrice = round2(compsMedian * 0.34);
    const item: CapturedItem = {
      id: nanoid(10),
      createdAt: new Date(Date.now() - (history.length - i) * 36 * 3600_000).toISOString(),
      source: "manual",
      identification,
      comps,
      price,
      verdict: makeVerdict({ buyPrice, price, cost }),
      cost,
      buyPrice,
      status: i % 3 === 0 ? "listed" : "bought",
      note: "Seeded demo item — delete it whenever.",
    };
    await saveItem(item);
    seeded.push(item);
  }

  return c.json({
    ok: true,
    seeded: history.length,
    inventory: seeded.length,
    note: "Sold history and inventory seeded through the real pipeline (no model calls). Set TABPFN_TOKEN and POST /train to fit the price model.",
  });
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
