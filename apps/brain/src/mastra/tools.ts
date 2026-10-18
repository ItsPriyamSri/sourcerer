import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { Identification } from "@sourcerer/shared";
import { defaultCostModel, formatMoney, maxOfferFor, computeEconomics } from "@sourcerer/shared";
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
    "Returns the most you should pay, and the profit at a given asking price.",
  inputSchema: z.object({
    resalePrice: z.number().describe("Expected resale price"),
    askingPrice: z.number().optional().describe("What the seller is asking; omit to get just the max offer"),
    marketplace: z.enum(["ebay", "mercari", "poshmark", "depop", "etsy", "facebook"]).optional(),
    targetMultiple: z.number().optional().describe("Desired resale-to-cost multiple, default 3"),
    shippingCost: z.number().optional(),
  }),
  outputSchema: z.object({
    maxOffer: z.number(),
    expectedProfit: z.number().optional(),
    netProceeds: z.number(),
    multiple: z.number().optional(),
    roi: z.number().optional(),
    explanation: z.string(),
  }),
  execute: async (input) => {
    const cost = defaultCostModel(input.marketplace ?? "ebay");
    if (input.targetMultiple) cost.targetMultiple = input.targetMultiple;
    if (input.shippingCost != null) cost.shippingCost = input.shippingCost;

    const maxOffer = maxOfferFor(input.resalePrice, cost);
    if (input.askingPrice == null) {
      return {
        maxOffer,
        netProceeds: computeEconomics(0, input.resalePrice, cost).netProceeds,
        explanation: `At a ${formatMoney(input.resalePrice)} resale on ${cost.marketplace} you clear about ${formatMoney(
          computeEconomics(0, input.resalePrice, cost).netProceeds,
        )} after fees and shipping. To keep a ${cost.targetMultiple}× multiple, pay no more than ${formatMoney(maxOffer)}.`,
      };
    }
    const e = computeEconomics(input.askingPrice, input.resalePrice, cost);
    return {
      maxOffer,
      expectedProfit: e.expectedProfit,
      netProceeds: e.netProceeds,
      multiple: e.multiple,
      roi: e.roi,
      explanation:
        `Pay ${formatMoney(input.askingPrice)} and resell at ${formatMoney(input.resalePrice)}: ` +
        `net ${formatMoney(e.netProceeds)}, profit ${formatMoney(e.expectedProfit)}, ${e.multiple.toFixed(1)}× your money. ` +
        `Max offer is ${formatMoney(maxOffer)}.`,
    };
  },
});

export const saveItemTool = createTool({
  id: "saveItem",
  description: "Save an item to the reseller's sourcing queue so they can generate a listing later.",
  inputSchema: z.object({
    title: z.string(),
    buyPrice: z.number().optional(),
    estimatedResale: z.number().optional(),
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
  inputSchema: z.object({ query: z.string(), limit: z.number().optional() }),
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
