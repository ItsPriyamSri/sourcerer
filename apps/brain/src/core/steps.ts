import { nanoid } from "nanoid";
import type {
  CompsResult,
  Identification,
  ListingDraft,
  PriceEstimate,
  RanLogEntry,
  ScanRequest,
  ScanResult,
  ScanStage,
  Verdict,
} from "@sourcerer/shared";
import {
  IDENTIFY_JSON_SCHEMA,
  LISTING_JSON_SCHEMA,
  IDENTIFY_SYSTEM,
  LISTING_SYSTEM,
  identifyUserPrompt,
  listingUserPrompt,
  normalizeIdentification,
  defaultCostModel,
  mergeCostModel,
  decideVerdict,
  maxOfferFor,
  clamp,
  formatMoney,
  round2,
} from "@sourcerer/shared";
import { llmChat } from "../providers/llm.ts";
import {
  CachedCompsProvider,
  LocalHistoryCompsProvider,
  SerpApiCompsProvider,
  applyAskingDiscount,
} from "../providers/comps.ts";
import { ChainedPricingEngine, HeuristicPricingEngine, TabPfnPricingEngine } from "../providers/pricing.ts";
import { persistCompsCache, restoreCompsCache, soldHistory } from "./store.ts";
import { note, withSpan } from "../providers/tracing.ts";

/**
 * The pipeline. Five steps, each with one job:
 *
 *   identify → comps → price → verdict → (later) listing
 *
 * Written as plain functions so they can be unit-tested and reused by both the
 * HTTP route and the Mastra workflow, rather than written twice.
 */

/** Models like to wrap JSON in prose or fences. Dig it out. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? trimmed;
  const start = candidate.search(/[{[]/);
  if (start < 0) throw new Error("model returned no JSON");
  const open = candidate[start]!;
  const close = open === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(close);
  if (end <= start) throw new Error("model returned truncated JSON");
  return JSON.parse(candidate.slice(start, end + 1));
}

// ── step 1: identify ───────────────────────────────────────────────────────

export async function identify(input: {
  image?: string;
  text?: string;
  signal?: AbortSignal;
}): Promise<{ identification: Identification; ran: RanLogEntry }> {
  const t0 = Date.now();
  const hasImage = Boolean(input.image);
  try {
    const res = await withSpan(
      "sourcerer.identify",
      "gen_ai.request",
      { "sourcerer.has_image": hasImage, "sourcerer.has_text": Boolean(input.text) },
      () =>
        llmChat({
          messages: [
            { role: "system", content: IDENTIFY_SYSTEM },
            { role: "user", content: identifyUserPrompt(input.text) },
          ],
          images: input.image ? [input.image] : undefined,
          jsonSchema: IDENTIFY_JSON_SCHEMA as unknown as Record<string, unknown>,
          capability: hasImage ? "vision" : "text",
          temperature: 0.1,
          maxTokens: 420,
          signal: input.signal,
        }),
    );

    let raw: unknown;
    try {
      raw = extractJson(res.text);
    } catch {
      // Text-only fallback: the model answered in prose. Keep the prose as a
      // best-effort title rather than blowing up the scan.
      raw = { title: res.text.trim().slice(0, 80), category: "misc", condition: "unknown", keywords: [], confidence: 0.25 };
    }

    const identification = normalizeIdentification(raw);
    if (!identification.keywords.length) {
      identification.keywords = [identification.brand, identification.category, identification.title]
        .filter(Boolean)
        .join(" ")
        .split(/\s+/)
        .slice(0, 4);
    }

    return {
      identification,
      ran: {
        step: "identify",
        provider: `${res.provider}:${res.model}`,
        locality: res.local ? "device" : "cloud",
        ms: Date.now() - t0,
        ok: true,
        detail: `${identification.title} (conf ${identification.confidence.toFixed(2)})`,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      identification: {
        title: input.text?.slice(0, 80) || "Unknown item",
        category: "misc",
        attributes: {},
        condition: "unknown",
        keywords: input.text?.split(/\s+/).slice(0, 4) ?? [],
        confidence: 0.1,
        caveats: ["Model unavailable — identification is a guess from your description."],
      },
      ran: { step: "identify", provider: "none", locality: "none", ms: Date.now() - t0, ok: false, detail: msg },
    };
  }
}

// ── step 2: comps ──────────────────────────────────────────────────────────

function buildCompsChain(offline: boolean) {
  const local = new LocalHistoryCompsProvider(() => soldHistory());
  const serpapi = new CachedCompsProvider(
    new SerpApiCompsProvider(),
    6 * 60 * 60 * 1000,
    persistCompsCache,
    restoreCompsCache,
  );
  return offline ? [local] : [serpapi, local];
}

export async function findComps(input: {
  identification: Identification;
  offline?: boolean;
  signal?: AbortSignal;
}): Promise<{ comps: CompsResult; ran: RanLogEntry }> {
  const t0 = Date.now();
  const chain = buildCompsChain(Boolean(input.offline));
  const errors: string[] = [];

  for (const provider of chain) {
    if (!(await provider.available())) {
      errors.push(`${provider.id}: not configured`);
      continue;
    }
    try {
      const raw = await withSpan(
        "sourcerer.comps",
        "gen_ai.tool",
        { "sourcerer.provider": provider.id },
        () => provider.search({ identification: input.identification, signal: input.signal }),
      );
      if (raw.summary && raw.summary.count > 0) {
        const comps = raw.comps[0]?.kind === "asking" ? applyAskingDiscount(raw) : raw;
        return {
          comps,
          ran: {
            step: "comps",
            provider: provider.id,
            locality: provider.local ? "device" : "cloud",
            ms: Date.now() - t0,
            ok: true,
            detail: `${comps.summary?.count ?? 0} listings`,
          },
        };
      }
      errors.push(`${provider.id}: no results`);
    } catch (err) {
      errors.push(`${provider.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    comps: {
      comps: [],
      summary: null,
      source: "estimate",
      basis: input.offline
        ? "Offline and nothing comparable in your sold history yet."
        : "No market data found. Try a broader description.",
      queriedAt: new Date().toISOString(),
    },
    ran: {
      step: "comps",
      provider: "none",
      locality: "none",
      ms: Date.now() - t0,
      ok: false,
      detail: errors.join("; ").slice(0, 200),
    },
  };
}

// ── step 3: price ──────────────────────────────────────────────────────────

const tabpfn = new TabPfnPricingEngine();
const heuristic = new HeuristicPricingEngine();
const pricing = new ChainedPricingEngine(tabpfn, heuristic);
let lastTrain: { rows: number; at: number } | null = null;

export async function estimatePrice(input: {
  identification: Identification;
  comps: CompsResult;
}): Promise<{ price: PriceEstimate; ran: RanLogEntry }> {
  const t0 = Date.now();
  // Refit at most once every 15 minutes, and only when TabPFN is configured.
  if (tabpfn.available()) {
    const stale = !lastTrain || Date.now() - lastTrain.at > 15 * 60 * 1000;
    if (stale) {
      try {
        const rows = await soldHistory();
        await pricing.train(rows);
        lastTrain = { rows: rows.length, at: Date.now() };
      } catch (err) {
        note("tabpfn train skipped", { reason: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  const price = await withSpan(
    "sourcerer.price",
    "gen_ai.request",
    { "sourcerer.method": tabpfn.available() ? "tabpfn-first" : "heuristic" },
    () => pricing.predict({ identification: input.identification, comps: input.comps }),
  );

  return {
    price,
    ran: {
      step: "price",
      provider: price.method,
      locality: price.method === "tabpfn" ? "cloud" : "device",
      ms: Date.now() - t0,
      ok: price.expected > 0,
      detail: `${formatMoney(price.expected)} · conf ${price.confidence.toFixed(2)}`,
    },
  };
}

// ── step 4: verdict ────────────────────────────────────────────────────────

export function makeVerdict(input: {
  buyPrice?: number;
  price: PriceEstimate;
  cost: ReturnType<typeof defaultCostModel>;
}): Verdict {
  const maxOffer = maxOfferFor(input.price.expected, input.cost);
  // No asking price yet? Show the verdict *at our recommended offer*, which is the
  // number the user actually needs walking up to the counter.
  const buy = input.buyPrice ?? maxOffer;
  const confidence = clamp(input.price.confidence, 0.1, 0.95);
  return decideVerdict(buy, input.price.expected, input.cost, confidence);
}

// ── the whole scan ─────────────────────────────────────────────────────────

export async function runScan(req: ScanRequest, onStage?: (s: ScanStage) => void): Promise<ScanResult> {
  const started = Date.now();
  const stages: ScanStage[] = [];
  const ran: RanLogEntry[] = [];
  const cost = mergeCostModel(defaultCostModel(req.cost?.marketplace ?? "ebay"), req.cost);
  const emit = (s: ScanStage) => {
    stages.push(s);
    onStage?.(s);
  };

  emit({ stage: "identify", status: "start" });
  const idStep = await identify({ image: req.image, text: req.text });
  ran.push(idStep.ran);
  emit({ stage: "identify", status: "done", ms: idStep.ran.ms, detail: idStep.identification.title });

  emit({ stage: "comps", status: "start" });
  const compsStep = await findComps({
    identification: idStep.identification,
    offline: req.offline,
  });
  ran.push(compsStep.ran);
  emit({
    stage: "comps",
    status: compsStep.ran.ok ? "done" : "error",
    ms: compsStep.ran.ms,
    detail: compsStep.comps.basis,
  });

  emit({ stage: "price", status: "start" });
  const priceStep = await estimatePrice({ identification: idStep.identification, comps: compsStep.comps });
  ran.push(priceStep.ran);
  emit({
    stage: "price",
    status: "done",
    ms: priceStep.ran.ms,
    detail: `${priceStep.price.method} · ${formatMoney(priceStep.price.expected)}`,
  });

  emit({ stage: "verdict", status: "start" });
  const verdict = makeVerdict({ buyPrice: req.buyPrice, price: priceStep.price, cost });
  emit({
    stage: "verdict",
    status: "done",
    ms: 0,
    detail: `${verdict.label} · max ${formatMoney(verdict.maxOffer)}`,
  });

  return {
    id: nanoid(10),
    createdAt: new Date().toISOString(),
    identification: idStep.identification,
    comps: compsStep.comps,
    price: priceStep.price,
    verdict,
    cost,
    stages,
    ran,
    totalMs: Date.now() - started,
  };
}

// ── step 5: listing ────────────────────────────────────────────────────────

export async function writeListing(input: {
  identification: Identification;
  price: PriceEstimate;
  comps: CompsResult;
  cost?: { marketplace: string };
  signal?: AbortSignal;
}): Promise<{ listing: ListingDraft; ran: RanLogEntry }> {
  const t0 = Date.now();
  const res = await llmChat({
    messages: [
      { role: "system", content: LISTING_SYSTEM },
      { role: "user", content: listingUserPrompt(input) },
    ],
    jsonSchema: LISTING_JSON_SCHEMA as unknown as Record<string, unknown>,
    capability: "text",
    temperature: 0.5,
    maxTokens: 700,
    signal: input.signal,
  });

  let listing: ListingDraft;
  try {
    const raw = extractJson(res.text) as Partial<ListingDraft>;
    listing = {
      title: String(raw.title ?? input.identification.title).slice(0, 80),
      description: String(raw.description ?? "").trim(),
      price: Number(raw.price) || round2(input.price.expected),
      category: raw.category,
      keywords: (raw.keywords ?? []).filter((k): k is string => typeof k === "string"),
      tips: (raw.tips ?? []).filter((t): t is string => typeof t === "string"),
      generatedBy: `${res.provider}:${res.model}`,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    listing = {
      title: input.identification.title.slice(0, 80),
      description: `Item draft. Price: ${formatMoney(input.price.expected)}.`,
      price: round2(input.price.expected),
      keywords: input.identification.keywords,
      generatedBy: `${res.provider}:${res.model}`,
      generatedAt: new Date().toISOString(),
    };
  }

  return {
    listing,
    ran: {
      step: "listing",
      provider: `${res.provider}:${res.model}`,
      locality: res.local ? "device" : "cloud",
      ms: Date.now() - t0,
      ok: listing.description.length > 0,
      detail: listing.title,
    },
  };
}
