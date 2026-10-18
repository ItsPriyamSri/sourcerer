import { useMemo } from "react";
import { portfolioStats, formatMoney, formatMultiple, formatPercent } from "@sourcerer/shared";
import { useApp } from "../lib/store.tsx";
import { Shell } from "../components/Shell.tsx";
import { EmptyState } from "../components/Bits.tsx";
import { IconChart, IconSparkle, IconTrend } from "../components/Icons.tsx";
import { api } from "../lib/api.ts";

/**
 * Insights — the tally a reseller never usually keeps.
 *
 * Computed in the browser from local data with the *same* pure functions the brain
 * uses, so the numbers here and the numbers the agent quotes can never disagree.
 */
export default function InsightsPage() {
  const { items, brainUp, toast } = useApp();

  const stats = useMemo(
    () =>
      portfolioStats(
        items.map((i) => ({ status: i.status, buyPrice: i.buyPrice, soldFor: i.soldFor, economics: i.verdict.economics })),
      ),
    [items],
  );

  const sold = items.filter((i) => i.status === "sold" && i.soldFor);
  const bought = items.filter((i) => i.buyPrice);

  const byCategory = useMemo(() => {
    const map = new Map<string, { count: number; profit: number }>();
    for (const i of bought) {
      const k = i.identification.category || "misc";
      const entry = map.get(k) ?? { count: 0, profit: 0 };
      entry.count++;
      entry.profit += i.soldFor ? i.soldFor - (i.buyPrice ?? 0) : i.verdict.economics.expectedProfit;
      map.set(k, entry);
    }
    return [...map.entries()].sort((a, b) => b[1].profit - a[1].profit).slice(0, 6);
  }, [bought]);

  const bestFlips = useMemo(
    () =>
      sold
        .map((i) => ({ item: i, profit: (i.soldFor ?? 0) - (i.buyPrice ?? 0) }))
        .sort((a, b) => b.profit - a.profit)
        .slice(0, 5),
    [sold],
  );

  const maxCat = Math.max(1, ...byCategory.map(([, v]) => v.profit));
  const accuracy = useMemo(() => {
    if (sold.length === 0) return null;
    const err =
      sold.reduce((s, i) => s + Math.abs((i.soldFor ?? 0) - i.price.expected) / Math.max(1, i.price.expected), 0) /
      sold.length;
    return 1 - err;
  }, [sold]);

  if (items.length === 0) {
    return (
      <Shell>
        <h1 className="display mb-4 text-2xl font-bold">Insights</h1>
        <EmptyState
          icon={<IconChart />}
          title="No numbers yet"
          body="Scan a few items and log what they sell for. Sourcerer turns that into your real profit, your sell-through rate, and a price model of your own."
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="mb-4">
        <h1 className="display text-2xl font-bold">Insights</h1>
        <p className="text-sm text-muted">Everything here is computed on this device from your own records.</p>
      </header>

      <section className="mb-4 grid grid-cols-2 gap-3" aria-label="Portfolio summary">
        <Stat label="Realised profit" value={formatMoney(stats.realisedProfit)} tone={stats.realisedProfit >= 0 ? "good" : "bad"} />
        <Stat label="Unrealised" value={formatMoney(stats.unrealisedProfit)} hint="expected, on what you hold" />
        <Stat label="Spent" value={formatMoney(stats.spent)} hint={`${bought.length} buys`} />
        <Stat label="Revenue" value={formatMoney(stats.revenue)} hint={`${stats.soldCount} sold`} />
        <Stat label="Sell-through" value={formatPercent(stats.sellThrough)} hint="sold ÷ captured" />
        <Stat
          label="Forecast accuracy"
          value={accuracy === null ? "—" : formatPercent(accuracy)}
          hint={accuracy === null ? "log a sale" : "vs. what actually sold"}
        />
      </section>

      {bestFlips.length > 0 && (
        <section className="card mb-4 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <IconTrend width={16} height={16} /> Best flips
          </h2>
          <ul className="space-y-2">
            {bestFlips.map(({ item, profit }) => (
              <li key={item.id} className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{item.identification.title}</span>
                  <span className="price block text-[11px] text-muted">
                    bought {formatMoney(item.buyPrice ?? 0)} → sold {formatMoney(item.soldFor ?? 0)}
                  </span>
                </span>
                <span className="price shrink-0 text-sm font-bold" style={{ color: profit >= 0 ? "var(--buy)" : "var(--maybe)" }}>
                  {profit >= 0 ? "+" : ""}
                  {formatMoney(profit)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {byCategory.length > 0 && (
        <section className="card mb-4 p-4">
          <h2 className="mb-3 text-sm font-semibold">Where the money is</h2>
          <ul className="space-y-2.5">
            {byCategory.map(([cat, v]) => (
              <li key={cat}>
                <div className="mb-1 flex items-baseline justify-between text-xs">
                  <span className="capitalize">{cat}</span>
                  <span className="price text-muted">
                    {v.count} · {formatMoney(v.profit)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.max(4, (v.profit / maxCat) * 100)}%`, background: v.profit >= 0 ? "var(--buy)" : "var(--maybe)" }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-muted">
            Unrealised profit uses the expected resale from each item&apos;s comps — treat it as a
            hypothesis, not cash.
          </p>
        </section>
      )}

      <section className="card p-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <IconSparkle width={16} height={16} /> Your own price model
        </h2>
        <p className="text-sm text-muted">
          {sold.length < 6
            ? `${6 - sold.length} more logged sale${6 - sold.length === 1 ? "" : "s"} and it's worth training a TabPFN model on your history — that's what makes the offline number sharp instead of generic.`
            : `You have ${sold.length} logged sales. Train the model and Sourcerer will price offline from your actual market, not a generic median.`}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, (sold.length / 6) * 100)}%`, background: "var(--amber)" }} />
          </div>
          <span className="price text-xs text-muted">{Math.min(sold.length, 6)}/6</span>
        </div>
        <button
          className="btn btn-ghost mt-3 w-full"
          disabled={brainUp === false}
          onClick={async () => {
            try {
              const r = await api.train();
              toast(r.trained ? `Model trained on ${r.rows} sales.` : (r.reason ?? "Not enough data yet."), r.trained ? "good" : "info");
            } catch (err) {
              toast(err instanceof Error ? err.message : "Training failed.", "bad");
            }
          }}
        >
          {brainUp === false ? "Start your brain to train" : "Train on my sold history"}
        </button>
      </section>
    </Shell>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <div className="card p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div
        className="price mt-0.5 text-xl font-bold"
        style={{ color: tone === "good" ? "var(--buy)" : tone === "bad" ? "var(--maybe)" : "var(--ink)" }}
      >
        {value}
      </div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

export { formatMultiple };
