/** Money helpers. All amounts are in the reseller's single operating currency. */

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function formatMoney(n: number, currency = "USD"): string {
  const rounded = Math.round(n);
  const showCents = Math.abs(n - rounded) > 0.004 && Math.abs(n) < 1000;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(n);
}

/** `4.2x` */
export function formatMultiple(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n >= 100 ? Math.round(n) : Math.round(n * 10) / 10}×`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** `$120 – $160` */
export function formatRange(low: number, high: number, currency = "USD"): string {
  return `${formatMoney(low, currency)} – ${formatMoney(high, currency)}`;
}
