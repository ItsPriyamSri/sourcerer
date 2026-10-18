import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { Identification } from "@sourcerer/shared";
import { defaultCostModel, formatMoney, maxOfferFor, computeEconomics, decideVerdict } from "@sourcerer/shared";
import { findComps } from "../core/steps.ts";
import { HeuristicPricingEngine } from "../providers/pricing.ts";
import { similarItems, embed } from "../providers/vector.ts";
import { saveItem, listItems } from "../core/store.ts";

/**
 * Tools for the sourcing advisor agent.
 *
 * These wrap the exact same deterministic functions the pipeline uses — the agent
 * gets the same numbers a human would, and cannot invent its own. Note what none
 * of these tools can do: make up a price. They can only look one up or compute it.
 */

const heuristic = new HeuristicPricingEngine();

/**
 * Small instruct models are sloppy about JSON types in a way that is purely mechanical.
 *
 * `llama3.2:3b` calls `feeMath` correctly and then sends `{"resalePrice":"215"}` — a
 * perfectly good tool call wearing a string where a number belongs. A strict `z.number()`
 * rejects it, the agent gets a validation error back instead of a price, and it improvises:
 * the first version of this produced a reply that was a raw tool-call object printed as
 * prose. None of that is a reasoning failure and none of it is the model's fault. The
 * schema was simply stricter than the wire format deserves.
 *
 * So the inputs coerce. This costs nothing and removes a whole class of behaviour that
 * looks like the model being confused and is actually the types being wrong.
 */
const num = () => z.coerce.number();

/** `"levis, denim, jacket"` where a list belongs is the same problem as the numbers. */
const listOf = () =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : v),
    z.array(z.string()),
  );

/** Note the explicit string handling: `z.coerce.boolean()` reads the string "false" as true. */
const bool = () =>
  z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() === "true" : v), z.boolean());

function toIdentification(raw: {
  title: string;
  brand?: string;
  category?: string;
  condition?: string;
  keywords?: string[];
}): Identification {
  return {
    title: raw.title,
    brand: raw.brand,
    category: raw.category ?? "misc",
    attributes: {},
    condition: (raw.condition as Identification["condition"]) ?? "unknown",
    keywords: raw.keywords ?? raw.title.split(/\s+/).slice(0, 4),
    confidence: 0.6,
  };
}

export const searchCompsTool = createTool({
  id: "searchComps",
  description:
    "Look up what an item is currently selling for. Uses live marketplace listings when online, " +
    "and the reseller's own sold history when offline. Returns the price range and how many listings backed it.",
  inputSchema: z.object({
    title: z.string().describe("Item name, e.g. 'Levi's 501 Big E selvedge denim jacket'"),
    brand: z.string().optional(),
    category: z.string().optional(),
    condition: z
      .enum(["new", "like_new", "good", "fair", "poor", "unknown"])
      .optional()
      .describe("Condition, which changes price a lot"),
    keywords: z.array(z.string()).optional().describe("Marketplace search terms"),
    offline: z.boolean().optional().describe("Force offline mode: use only local data"),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    count: z.number(),
    low: z.number(),
    median: z.number(),
    high: z.number(),
    currency: z.string(),
    basis: z.string(),
    source: z.string(),
  }),
  execute: async (input) => {
    const { comps } = await findComps({ identification: toIdentification(input), offline: input.offline });
    return {
      found: Boolean(comps.summary),
      count: comps.summary?.count ?? 0,
      low: comps.summary?.low ?? 0,
      median: comps.summary?.median ?? 0,
      high: comps.summary?.high ?? 0,
      currency: comps.summary?.currency ?? "USD",
      basis: comps.basis,
      source: comps.source,
    };
  },
});

export const estimatePriceTool = createTool({
  id: "estimatePrice",
  description:
    "Estimate the realistic resale price for an item given its condition, using the on-device model " +
    "and any market data available. Works with no network at all.",
  inputSchema: z.object({
    title: z.string(),
    brand: z.string().optional(),
    category: z.string().optional(),
    condition: z.enum(["new", "like_new", "good", "fair", "poor", "unknown"]).optional(),
    keywords: z.array(z.string()).optional(),
    offline: z.boolean().optional(),
  }),
  outputSchema: z.object({
    expected: z.number(),
    low: z.number(),
    high: z.number(),
    method: z.string(),
    confidence: z.number(),
    note: z.string().optional(),
  }),
  execute: async (input) => {
    const identification = toIdentification(input);
    const { comps } = await findComps({ identification, offline: input.offline });
    const price = await heuristic.predict({ identification, comps });
    return {
      expected: price.expected,
      low: price.low,
      high: price.high,
      method: price.method,
      confidence: price.confidence,
      note: price.note,
    };
  },
});

export const feeMathTool = createTool({
  id: "feeMath",
  description:
    "The real money math for a flip: platform fees, payment fees, shipping and supplies. " +
    "Give it the expected resale price and, if the reseller said it, what the seller is asking. " +
    "It returns the verdict (BUY / MAYBE / PASS), the most they should pay (maxOffer), the profit, " +
    "and a written explanation. " +
    "LEAVE shippingCost, targetMultiple and marketplace OUT unless the reseller states them — the " +
    "tool already knows their saved defaults, and inventing a value here silently changes the answer.",
  inputSchema: z.object({
    resalePrice: num().describe("Expected resale price"),
    askingPrice: num().optional().describe("What the seller is asking; omit to get just the max offer"),
    marketplace: z.enum(["ebay", "mercari", "poshmark", "depop", "etsy", "facebook"]).optional(),
    targetMultiple: num().optional().describe("Desired resale-to-cost multiple, default 3"),
    shippingCost: num().optional().describe("Only if the reseller states one; otherwise omit"),
  }),
  outputSchema: z.object({
    maxOffer: z.number(),
    verdict: z.enum(["BUY", "MAYBE", "PASS"]).optional(),
    reason: z.string().optional(),
    assumptions: z.string(),
    expectedProfit: z.number().optional(),
    netProceeds: z.number(),
    multiple: z.number().optional(),
    roi: z.number().optional(),
    /** The finished sentence. The advisor route sends this, not the model's paraphrase. */
    answer: z.string(),
    explanation: z.string(),
  }),
  execute: async (input) => {
    const cost = defaultCostModel(input.marketplace ?? "ebay");
    if (input.targetMultiple) cost.targetMultiple = input.targetMultiple;
    if (input.shippingCost != null) cost.shippingCost = input.shippingCost;

    // Stated in every reply, because the surprising thing about a fee model is which
    // assumptions it made — and because a reseller who disagrees with the shipping estimate
    // needs to see the number the answer was built on before they trust it.
    const assumptions =
      `${cost.marketplace}: ${(cost.platformFeePct * 100).toFixed(1)}% + ${formatMoney(cost.paymentFlat)} platform fees, ` +
      `${formatMoney(cost.shippingCost)} shipping, ${formatMoney(cost.suppliesCost)} supplies, ${cost.targetMultiple}× target.`;

    const maxOffer = maxOfferFor(input.resalePrice, cost);
    if (input.askingPrice == null) {
      const net = computeEconomics(0, input.resalePrice, cost).netProceeds;
      const answer = `At a ${formatMoney(input.resalePrice)} resale on ${cost.marketplace} you clear about ${formatMoney(net)}. Most I would pay is ${formatMoney(maxOffer)}.`;
      return {
        maxOffer,
        assumptions,
        netProceeds: net,
        answer,
        explanation: `${answer} (Assumes ${assumptions})`,
      };
    }
    const e = computeEconomics(input.askingPrice, input.resalePrice, cost);

    // The verdict is decided here, in code, by exactly the function the scan route uses — and
    // so is the sentence, for a reason that took a few runs to accept.
    //
    // Letting the model write the reply after the tool ran produced answers whose numbers were
    // right and whose recommendation was backwards. Asked about the $150 snare with a $58.82
    // ceiling, one run said "the asking price ($150) is below maxOffer ($58.82), the verdict is
    // BUY"; another said "the item should be bought"; another got it right. Three runs, three
    // different verdicts, all from the same tool output. A number a language model paraphrased
    // is a number you cannot audit, and this app's entire claim is that its numbers are
    // auditable. So the money sentence is composed here and sent as the reply; the model's job
    // is the part it is actually good at, which is understanding "shipping cross-country, put
    // it at $35" and calling this function with the right arguments.
    const v = decideVerdict(input.askingPrice, input.resalePrice, cost, 0.75);
    const profitWord = e.expectedProfit >= 0 ? "make" : "lose";
    const answer =
      `${v.label}. Most I would pay is ${formatMoney(maxOffer)}. ` +
      `At ${formatMoney(input.askingPrice)} you would ${profitWord} ${formatMoney(Math.abs(e.expectedProfit))} ` +
      `if it resells at ${formatMoney(input.resalePrice)}.`;

    return {
      maxOffer,
      verdict: v.label,
      reason: v.reason,
      assumptions,
      expectedProfit: e.expectedProfit,
      netProceeds: e.netProceeds,
      multiple: e.multiple,
      roi: e.roi,
      answer,
      explanation: `${answer} ${v.reason} (Assumes ${assumptions})`,
    };
  },
});

export const saveItemTool = createTool({
  id: "saveItem",
  description: "Save an item to the reseller's sourcing queue so they can generate a listing later.",
  inputSchema: z.object({
    title: z.string(),
    buyPrice: num().optional(),
    estimatedResale: num().optional(),
    verdict: z.enum(["BUY", "MAYBE", "PASS"]).optional(),
    note: z.string().optional(),
  }),
  outputSchema: z.object({ saved: z.boolean(), id: z.string(), queueSize: z.number() }),
  execute: async (input) => {
    const id = `q_${Math.random().toString(36).slice(2, 10)}`;
    const resale = input.estimatedResale ?? 0;
    const cost = defaultCostModel("ebay");
    await saveItem({
      id,
      createdAt: new Date().toISOString(),
      source: "voice",
      identification: {
        title: input.title,
        category: "misc",
        attributes: {},
        condition: "unknown",
        keywords: input.title.split(/\s+/).slice(0, 4),
        confidence: 0.5,
      },
      comps: { comps: [], summary: null, source: "estimate", basis: "Added by the advisor agent.", queriedAt: new Date().toISOString() },
      price: { expected: resale, low: resale * 0.8, high: resale * 1.2, method: "heuristic", confidence: 0.4 },
      verdict: {
        label: input.verdict ?? "MAYBE",
        maxOffer: maxOfferFor(resale, cost),
        offerRatio: 1,
        economics: computeEconomics(input.buyPrice ?? 0, resale, cost),
        reason: input.note ?? "Saved from a conversation with the advisor.",
        confidence: 0.4,
      },
      cost,
      buyPrice: input.buyPrice,
      note: input.note,
      status: "sourced",
    });
    const all = await listItems();
    return { saved: true, id, queueSize: all.length };
  },
});

export const similarItemsTool = createTool({
  id: "similarItems",
  description:
    "Search the reseller's own inventory and sold history for similar items — 'have I bought one of these before, and what did it sell for?'",
  inputSchema: z.object({ query: z.string(), limit: num().optional() }),
  outputSchema: z.object({
    found: z.number(),
    items: z.array(
      z.object({ title: z.string(), soldFor: z.number().optional(), score: z.number(), category: z.string().optional() }),
    ),
    note: z.string(),
  }),
  execute: async (input) => {
    const embedding = await embed(input.query);
    const hits = await similarItems(input.query, embedding, input.limit ?? 5);
    return {
      found: hits.length,
      items: hits.map((h) => ({ title: h.title, soldFor: h.soldFor, score: h.score, category: h.category })),
      note: embedding
        ? "Hybrid keyword + vector search over your inventory."
        : "Keyword search only (no embedding model configured).",
    };
  },
});

export const advisorTools = {
  searchComps: searchCompsTool,
  estimatePrice: estimatePriceTool,
  feeMath: feeMathTool,
  saveItem: saveItemTool,
  similarItems: similarItemsTool,
};
