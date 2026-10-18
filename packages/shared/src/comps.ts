import type { Comp, CompsSummary } from "./types.ts";
import { round2 } from "./money.ts";

/** Statistics for a pile of comps. Kept separate from any provider so it is testable. */

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo]!;
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/**
 * Trimmed mean: drop the top and bottom 10% before averaging. One seller asking
 * 10x the going rate should not move the number a reseller bets money on.
 */
export function trimmedMean(xs: number[], trim = 0.1): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const cut = Math.floor(s.length * trim);
  const kept = s.slice(cut, s.length - cut);
  const use = kept.length ? kept : s;
  return use.reduce((a, b) => a + b, 0) / use.length;
}

export function summariseComps(comps: Comp[]): CompsSummary | null {
  const prices = comps
    .map((c) => c.price)
    .filter((p) => Number.isFinite(p) && p > 0);
  if (prices.length === 0) return null;
  return {
    count: prices.length,
    low: round2(quantile(prices, 0.1)),
    median: round2(median(prices)),
    high: round2(quantile(prices, 0.9)),
    mean: round2(trimmedMean(prices)),
    currency: comps[0]?.currency ?? "USD",
  };
}

/** Condition multipliers applied when we only have a general comps median. */
export const CONDITION_MULTIPLIER: Record<string, number> = {
  new: 1.15,
  like_new: 1.0,
  good: 0.92,
  fair: 0.75,
  poor: 0.5,
  unknown: 0.92,
};

export function conditionAdjusted(price: number, condition: string): number {
  return round2(price * (CONDITION_MULTIPLIER[condition] ?? 0.92));
}
