import type { CostModel, MarketplaceId } from "./types.ts";

/**
 * Default cost models per marketplace, current as of the 2026 fee schedules.
 *
 * Resellers lose money on fees they forgot about, so these defaults are deliberately
 * conservative (slightly high) — a verdict that is 2% pessimistic is a feature.
 * Every value is editable in the UI; nothing here is hidden from the user.
 */
export const MARKETPLACE_DEFAULTS: Record<MarketplaceId, Omit<CostModel, "targetMultiple" | "minProfit">> = {
  ebay: {
    marketplace: "ebay",
    // Final value fee ~13.6% for most categories + $0.30 per order.
    platformFeePct: 0.136,
    paymentFeePct: 0,
    paymentFlat: 0.3,
    shippingCost: 8,
    suppliesCost: 1,
  },
  mercari: {
    marketplace: "mercari",
    // Mercari moved to a single 10% selling fee paid by the seller.
    platformFeePct: 0.1,
    paymentFeePct: 0.029,
    paymentFlat: 0.5,
    shippingCost: 7.5,
    suppliesCost: 1,
  },
  poshmark: {
    marketplace: "poshmark",
    // 20% on sales >= $15; $2.95 flat under that. We model the common case.
    platformFeePct: 0.2,
    paymentFeePct: 0,
    paymentFlat: 0,
    shippingCost: 7.97,
    suppliesCost: 0,
  },
  depop: {
    marketplace: "depop",
    platformFeePct: 0.1,
    paymentFeePct: 0.039,
    paymentFlat: 0.45,
    shippingCost: 6,
    suppliesCost: 0.5,
  },
  etsy: {
    marketplace: "etsy",
    platformFeePct: 0.065,
    paymentFeePct: 0.03,
    paymentFlat: 0.25,
    shippingCost: 6,
    suppliesCost: 1,
  },
  facebook: {
    marketplace: "facebook",
    // Local pickup: no shipping, no fees. The best margin in flipping.
    platformFeePct: 0,
    paymentFeePct: 0,
    paymentFlat: 0,
    shippingCost: 0,
    suppliesCost: 0,
  },
};

export const MARKETPLACE_LABELS: Record<MarketplaceId, string> = {
  ebay: "eBay",
  mercari: "Mercari",
  poshmark: "Poshmark",
  depop: "Depop",
  etsy: "Etsy",
  facebook: "Facebook Marketplace",
};

export const DEFAULT_TARGET_MULTIPLE = 3;
export const DEFAULT_MIN_PROFIT = 10;

export function defaultCostModel(marketplace: MarketplaceId = "ebay"): CostModel {
  return {
    ...MARKETPLACE_DEFAULTS[marketplace],
    targetMultiple: DEFAULT_TARGET_MULTIPLE,
    minProfit: DEFAULT_MIN_PROFIT,
  };
}

export function mergeCostModel(
  base: CostModel = defaultCostModel(),
  overrides?: Partial<CostModel>,
): CostModel {
  const next = { ...base, ...overrides };
  // Guard against nonsense from a slider or a hand-edited config.
  next.platformFeePct = Math.min(0.6, Math.max(0, next.platformFeePct));
  next.paymentFeePct = Math.min(0.15, Math.max(0, next.paymentFeePct));
  next.shippingCost = Math.max(0, next.shippingCost);
  next.suppliesCost = Math.max(0, next.suppliesCost);
  next.targetMultiple = Math.min(20, Math.max(1, next.targetMultiple));
  next.minProfit = Math.max(0, next.minProfit);
  return next;
}
