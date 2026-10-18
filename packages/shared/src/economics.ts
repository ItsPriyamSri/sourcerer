import type { CostModel, Economics, Verdict, VerdictLabel } from "./types.ts";
import { round2 } from "./money.ts";

/**
 * The money math. This is the heart of the product and it is intentionally boring:
 * deterministic, dependency-free, and covered by tests. A model never gets to
 * decide what a flip costs — it only estimates the resale number we feed in here.
 */

export function computeEconomics(
  buyPrice: number,
  expectedResale: number,
  cost: CostModel,
): Economics {
  const feesTotal =
    expectedResale * cost.platformFeePct +
    expectedResale * cost.paymentFeePct +
    cost.paymentFlat;

  const netProceeds = expectedResale - feesTotal - cost.shippingCost - cost.suppliesCost;
  const expectedProfit = netProceeds - buyPrice;

  return {
    buyPrice: round2(buyPrice),
    expectedResale: round2(expectedResale),
    netProceeds: round2(netProceeds),
    expectedProfit: round2(expectedProfit),
    multiple: buyPrice > 0 ? round2(netProceeds / buyPrice) : Number.POSITIVE_INFINITY,
    roi: buyPrice > 0 ? round2(expectedProfit / buyPrice) : Number.POSITIVE_INFINITY,
    feesTotal: round2(feesTotal),
  };
}

/**
 * The most we should pay for an item so that net proceeds are `targetMultiple`
 * times the buy price. Solving  netProceeds / buy = targetMultiple  for buy:
 *
 *   buy = netProceeds / targetMultiple
 *
 * where netProceeds depends only on the resale price and the fixed costs.
 */
export function maxOfferFor(expectedResale: number, cost: CostModel): number {
  const e = computeEconomics(0, expectedResale, cost);
  if (cost.targetMultiple <= 1) return Math.max(0, round2(e.netProceeds));
  return Math.max(0, round2(e.netProceeds / cost.targetMultiple));
}

export interface VerdictOptions {
  /** Below this ratio to maxOffer we are confidently BUY (default 0.7). */
  buyAt?: number;
  /** Above this ratio we are confidently PASS (default 1.0). */
  passAbove?: number;
  /** If the model is unsure (< this), never say BUY (default 0.5). */
  minConfidenceForBuy?: number;
}

export function decideVerdict(
  buyPrice: number,
  expectedResale: number,
  cost: CostModel,
  confidence = 0.7,
  opts: VerdictOptions = {},
): Verdict {
  const buyAt = opts.buyAt ?? 0.7;
  const passAbove = opts.passAbove ?? 1;
  const minConf = opts.minConfidenceForBuy ?? 0.5;

  const maxOffer = maxOfferFor(expectedResale, cost);
  const economics = computeEconomics(buyPrice, expectedResale, cost);
  const offerRatio = maxOffer > 0 ? round2(buyPrice / maxOffer) : Number.POSITIVE_INFINITY;

  let label: VerdictLabel;
  if (maxOffer <= 0 || economics.expectedProfit < cost.minProfit) {
    label = "PASS";
  } else if (offerRatio <= buyAt && confidence >= minConf) {
    label = "BUY";
  } else if (offerRatio <= passAbove) {
    label = "MAYBE";
  } else {
    label = "PASS";
  }

  // A confident BUY that is only marginally above cost is really a MAYBE.
  if (label === "BUY" && economics.expectedProfit < cost.minProfit * 1.5) {
    label = "MAYBE";
  }

  return {
    label,
    maxOffer,
    offerRatio,
    economics,
    reason: verdictReason(label, buyPrice, maxOffer, economics.expectedProfit, cost, confidence),
    confidence,
  };
}

function verdictReason(
  label: VerdictLabel,
  buyPrice: number,
  maxOffer: number,
  profit: number,
  cost: CostModel,
  confidence: number,
): string {
  const money = (n: number) => `$${Math.abs(n) < 1000 ? Math.round(n * 100) / 100 : Math.round(n)}`;
  if (maxOffer <= 0) {
    return `After fees and shipping this resells for about what it costs to ship. Not a flip.`;
  }
  switch (label) {
    case "BUY":
      return `At ${money(buyPrice)} you clear about ${money(profit)} after fees on ${cost.marketplace}. Buy it.`;
    case "MAYBE":
      return confidence < 0.5
        ? `The price works, but I am not sure what this item is. Offer ${money(maxOffer)} or less.`
        : `Thin margin at ${money(buyPrice)}. Offer ${money(maxOffer)} to keep your ${cost.targetMultiple}× target.`;
    case "PASS":
      return `You would need it at ${money(maxOffer)} or less. At ${money(buyPrice)} this is someone else's flip.`;
  }
}

/** Per-item profit rollup for the insights screen. */
export function portfolioStats(items: { status: string; buyPrice?: number; soldFor?: number; economics: Economics }[]) {
  const spent = items.reduce((s, i) => s + (i.buyPrice ?? 0), 0);
  const sold = items.filter((i) => i.status === "sold");
  const revenue = sold.reduce((s, i) => s + (i.soldFor ?? 0), 0);
  const costOfSold = sold.reduce((s, i) => s + (i.buyPrice ?? 0), 0);
  const unrealised = items
    .filter((i) => i.status === "bought" || i.status === "listed")
    .reduce((s, i) => s + Math.max(0, i.economics.expectedProfit), 0);
  return {
    itemCount: items.length,
    spent: round2(spent),
    soldCount: sold.length,
    revenue: round2(revenue),
    realisedProfit: round2(revenue - costOfSold),
    unrealisedProfit: round2(unrealised),
    sellThrough: items.length ? round2(sold.length / items.length) : 0,
  };
}
