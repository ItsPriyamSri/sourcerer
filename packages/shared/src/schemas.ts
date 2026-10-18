import { z } from "zod";

/**
 * Two parallel descriptions of the same shapes, on purpose:
 *
 *  - Zod schemas validate untrusted model output and define Mastra tool inputs.
 *  - JSON Schemas are handed to Ollama's `format` field so the local model is
 *    *constrained* to emit valid JSON instead of us begging it in the prompt.
 *
 * The JSON Schemas are deliberately small and hand-written. A 4B model on a laptop
 * follows a short schema far more reliably than a sprawling one.
 */

export const ConditionZ = z.enum(["new", "like_new", "good", "fair", "poor", "unknown"]);

export const IdentificationZ = z.object({
  title: z.string().min(1),
  brand: z.string().optional(),
  category: z.string().min(1).default("misc"),
  attributes: z.record(z.string(), z.string()).default({}),
  condition: ConditionZ.default("unknown"),
  keywords: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  caveats: z.array(z.string()).optional(),
});

export const MarketplaceZ = z.enum(["ebay", "mercari", "poshmark", "depop", "etsy", "facebook"]);

export const CostModelZ = z.object({
  marketplace: MarketplaceZ.default("ebay"),
  platformFeePct: z.number().min(0).max(0.6).default(0.136),
  paymentFeePct: z.number().min(0).max(0.15).default(0),
  paymentFlat: z.number().min(0).default(0.3),
  shippingCost: z.number().min(0).default(8),
  suppliesCost: z.number().min(0).default(1),
  targetMultiple: z.number().min(1).max(20).default(3),
  minProfit: z.number().min(0).default(10),
});

export const ScanRequestZ = z.object({
  image: z.string().optional(),
  text: z.string().optional(),
  buyPrice: z.number().min(0).optional(),
  cost: CostModelZ.partial().optional(),
  offline: z.boolean().optional(),
  /** Optional: user's own sold history to bias pricing. */
  history: z
    .array(
      z.object({
        title: z.string(),
        category: z.string().optional(),
        brand: z.string().optional(),
        condition: z.string().optional(),
        price: z.number(),
        daysToSell: z.number().optional(),
      }),
    )
    .optional(),
});

export type ScanRequestInput = z.infer<typeof ScanRequestZ>;

export const ListingDraftZ = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  price: z.number().min(0),
  category: z.string().optional(),
  keywords: z.array(z.string()).default([]),
  tips: z.array(z.string()).optional(),
});

/** JSON Schema for Ollama structured output: identification. */
export const IDENTIFY_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Best-guess canonical item name, <=80 chars" },
    brand: { type: "string" },
    category: { type: "string", description: "e.g. denim jacket, ceramic mug, film camera" },
    attributes: {
      type: "object",
      additionalProperties: { type: "string" },
      description: "size, colour, material, era, model number",
    },
    condition: {
      type: "string",
      enum: ["new", "like_new", "good", "fair", "poor", "unknown"],
    },
    keywords: {
      type: "array",
      items: { type: "string" },
      description: "3-6 search terms a reseller would type into eBay",
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    caveats: { type: "array", items: { type: "string" } },
  },
  required: ["title", "category", "condition", "keywords", "confidence"],
} as const;

/** JSON Schema for Ollama structured output: listing draft. */
export const LISTING_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Marketplace title, <=80 characters" },
    description: { type: "string" },
    price: { type: "number" },
    category: { type: "string" },
    keywords: { type: "array", items: { type: "string" } },
    tips: { type: "array", items: { type: "string" } },
  },
  required: ["title", "description", "price", "keywords"],
} as const;

/** Coerce whatever the model said into a safe Identification. Never throws. */
export function normalizeIdentification(raw: unknown): z.infer<typeof IdentificationZ> {
  const parsed = IdentificationZ.safeParse(raw);
  if (parsed.success) return parsed.data;

  const obj = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown, fallback = "") => (typeof v === "string" && v.trim() ? v.trim() : fallback);
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

  const keywords = Array.isArray(obj.keywords)
    ? obj.keywords.filter((k): k is string => typeof k === "string")
    : [];

  const attributes: Record<string, string> = {};
  if (obj.attributes && typeof obj.attributes === "object") {
    for (const [k, v] of Object.entries(obj.attributes as Record<string, unknown>)) {
      if (v != null) attributes[k] = String(v);
    }
  }

  const condition = ConditionZ.safeParse(obj.condition).success ? (obj.condition as z.infer<typeof ConditionZ>) : "unknown";

  return {
    title: str(obj.title, "Unknown item"),
    brand: typeof obj.brand === "string" ? obj.brand : undefined,
    category: str(obj.category, "misc"),
    attributes,
    condition,
    keywords,
    confidence: Math.max(0, Math.min(1, num(obj.confidence, 0.4))),
    caveats: Array.isArray(obj.caveats)
      ? obj.caveats.filter((c): c is string => typeof c === "string")
      : undefined,
  };
}
