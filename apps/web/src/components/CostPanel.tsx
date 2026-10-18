import { defaultCostModel, mergeCostModel, type CostModel, type MarketplaceId } from "@sourcerer/shared";
import { MoneyInput } from "./Bits.tsx";
import { IconRefresh } from "./Icons.tsx";

/**
 * Every number the verdict uses is visible and editable here.
 *
 * Principle 4 is "honest uncertainty" — the corollary is that the user can see the
 * assumptions and overrule them. Somebody shipping heavy glass knows their shipping
 * cost better than our default table does.
 */
export function CostPanel({ cost, onChange }: { cost: CostModel; onChange: (c: CostModel) => void }) {
  const set = (patch: Partial<CostModel>) => onChange(mergeCostModel(cost, patch));

  const pct = (label: string, key: keyof CostModel, hint?: string) => (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
        {hint && <span className="font-normal normal-case tracking-normal text-muted">{hint}</span>}
      </span>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={key === "targetMultiple" ? 10 : key === "minProfit" ? 100 : 0.35}
          step={key === "targetMultiple" ? 0.5 : key === "minProfit" ? 1 : 0.005}
          value={Number(cost[key])}
          onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<CostModel>)}
          className="tap w-full accent-[var(--amber)]"
          aria-label={label}
        />
        <span className="price w-16 text-right text-sm font-semibold">
          {key === "targetMultiple"
            ? `${Number(cost[key])}×`
            : key === "minProfit"
              ? `$${cost[key]}`
              : `${(Number(cost[key]) * 100).toFixed(1)}%`}
        </span>
      </div>
    </label>
  );

  return (
    <div className="space-y-3">
      {pct("Platform fee", "platformFeePct")}
      {pct("Payment fee", "paymentFeePct")}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Flat fee / order</span>
          <MoneyInput value={cost.paymentFlat} onChange={(n) => set({ paymentFlat: n })} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Shipping you pay</span>
          <MoneyInput value={cost.shippingCost} onChange={(n) => set({ shippingCost: n })} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Packaging</span>
          <MoneyInput value={cost.suppliesCost} onChange={(n) => set({ suppliesCost: n })} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Min profit</span>
          <MoneyInput value={cost.minProfit} onChange={(n) => set({ minProfit: n })} />
        </label>
      </div>
      {pct("Target multiple", "targetMultiple", "net ÷ cost")}
      <button
        className="btn btn-ghost w-full text-sm"
        onClick={() => onChange(defaultCostModel(cost.marketplace as MarketplaceId))}
      >
        <IconRefresh width={16} height={16} />
        Reset to {cost.marketplace} defaults
      </button>
      <p className="text-[11px] text-muted">
        Defaults are deliberately a little pessimistic. A verdict that is 2% cautious beats one
        that eats your margin.
      </p>
    </div>
  );
}
