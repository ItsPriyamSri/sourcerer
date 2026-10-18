import { useMemo, useState } from "react";
import {
  MARKETPLACE_LABELS,
  computeEconomics,
  decideVerdict,
  defaultCostModel,
  formatMoney,
  formatMultiple,
  formatPercent,
  formatRange,
  mergeCostModel,
  type CapturedItem,
  type CostModel,
  type MarketplaceId,
  type ScanResult,
  type Verdict,
  type VerdictLabel,
} from "@sourcerer/shared";
import { CompsPanel } from "./CompsPanel.tsx";
import { CostPanel } from "./CostPanel.tsx";
import { RanLog } from "./RanLog.tsx";
import { Disclosure, RangeBar, MoneyInput, Select } from "./Bits.tsx";
import {
  IconBolt,
  IconCheck,
  IconChevron,
  IconCloud,
  IconCopy,
  IconDevice,
  IconMinus,
  IconRefresh,
  IconShare,
  IconShield,
  IconSparkle,
  IconTag,
  IconWarn,
} from "./Icons.tsx";

/**
 * The verdict card — the single most important surface in the app.
 *
 * Rules it follows (docs/DESIGN.md §4):
 *  - one dominant signal (BUY / MAYBE / PASS) carried by icon + word + colour
 *  - the max-offer number is the biggest thing on screen
 *  - provenance is always visible ("12 live comps" vs "local model · 71%")
 *  - everything is editable and instantly re-priceable, offline
 */

const VERDICT_STYLE: Record<VerdictLabel, { color: string; soft: string; Icon: typeof IconCheck; word: string }> = {
  BUY: { color: "var(--buy)", soft: "var(--buy-soft)", Icon: IconCheck, word: "Buy it" },
  MAYBE: { color: "var(--maybe)", soft: "var(--maybe-soft)", Icon: IconWarn, word: "Offer less" },
  PASS: { color: "var(--pass)", soft: "var(--pass-soft)", Icon: IconMinus, word: "Pass" },
};

export function useRepriced(price: { expected: number }, cost: CostModel, buyPrice: number, confidence: number) {
  return useMemo(() => decideVerdict(buyPrice, price.expected, cost, confidence), [buyPrice, price.expected, cost, confidence]);
}

export function VerdictBanner({ verdict, compact = false }: { verdict: Verdict; compact?: boolean }) {
  const s = VERDICT_STYLE[verdict.label];
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl px-4 ${compact ? "py-2.5" : "py-4"}`}
      style={{ background: s.soft, border: `1px solid color-mix(in oklab, ${s.color} 35%, transparent)` }}
      role="status"
      aria-live="polite"
    >
      <span
        className={`flex items-center justify-center rounded-full ${compact ? "h-8 w-8" : "h-11 w-11"}`}
        style={{ background: s.color, color: "var(--surface)" }}
      >
        <s.Icon width={compact ? 18 : 24} height={compact ? 18 : 24} />
      </span>
      <div className="min-w-0">
        <div className={`display font-bold leading-none ${compact ? "text-lg" : "text-2xl"}`} style={{ color: s.color }}>
          {verdict.label}
        </div>
        {!compact && (
          <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
            {verdict.reason}
          </p>
        )}
        {compact && <p className="truncate text-xs" style={{ color: "var(--ink-2)" }}>{verdict.reason}</p>}
      </div>
    </div>
  );
}

export function VerdictCard({
  result,
  item,
  onSave,
  onListing,
  onNote,
  saved,
  listingText,
}: {
  result: ScanResult;
  item?: CapturedItem;
  onSave: () => void;
  onListing: () => void;
  onNote?: (note: string) => void;
  saved: boolean;
  listingText?: string;
}) {
  const [cost, setCostLocal] = useState<CostModel>(item?.cost ?? result.cost);
  const [buyPrice, setBuyPrice] = useState<number>(item?.buyPrice ?? 0);
  const [busyListing, setBusyListing] = useState(false);

  const verdict = useRepriced(result.price, cost, buyPrice, result.price.confidence);
  const econ = useMemo(() => computeEconomics(buyPrice, result.price.expected, cost), [buyPrice, result.price.expected, cost]);

  const s = VERDICT_STYLE[verdict.label];
  const basisIsLive = result.comps.source === "live" || result.comps.source === "cache";

  return (
    <section className="space-y-3" aria-label="Verdict">
      {/* ── the headline: item + verdict + max offer ─────────────────────── */}
      <div className="card overflow-hidden">
        <div className="stripe h-1.5 w-full" />
        <div className="space-y-3 p-4">
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="display text-lg font-semibold leading-snug">{result.identification.title}</h2>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                {result.identification.brand && <span className="chip">{result.identification.brand}</span>}
                <span className="chip">{result.identification.category}</span>
                <span className="chip">{result.identification.condition.replace("_", " ")}</span>
              </p>
            </div>
          </header>

          <VerdictBanner verdict={verdict} />

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border p-3" style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">Max offer</div>
              <div className="price text-3xl font-bold" style={{ color: s.color }}>
                {formatMoney(verdict.maxOffer)}
              </div>
              <div className="text-xs text-muted">
                {buyPrice > 0 ? (
                  <>
                    asking {formatMoney(buyPrice)} · {econ.multiple >= 1 ? `${formatPercent(verdict.offerRatio - 1)} over` : `${formatPercent(1 - verdict.offerRatio)} under`}
                  </>
                ) : (
                  "Your ceiling at the asking price you type"
                )}
              </div>
            </div>
            <div className="rounded-xl border p-3" style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">Est. resale</div>
              <div className="price text-2xl font-bold">{formatMoney(result.price.expected)}</div>
              <div className="price text-xs text-muted">{formatRange(result.price.low, result.price.high)}</div>
            </div>
          </div>

          {/* Range bar: where the expected price sits in the observed spread. */}
          <div className="px-1">
            <RangeBar low={result.price.low} mid={result.price.expected} high={result.price.high} marker={buyPrice > 0 ? buyPrice : undefined} />
            <div className="mt-1 flex justify-between text-[11px] text-muted">
              <span className="price">{formatMoney(result.price.low)}</span>
              <span className="flex items-center gap-1">
                {result.price.method === "tabpfn" ? <IconSparkle width={12} height={12} /> : <IconTag width={12} height={12} />}
                {result.price.method.replace("_", " ")}
              </span>
              <span className="price">{formatMoney(result.price.high)}</span>
            </div>
          </div>

          {/* ── provenance: never launder an estimate as a comp ──────────── */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="chip" style={basisIsLive ? { background: "var(--buy-soft)", color: "var(--buy)" } : undefined}>
              {basisIsLive ? <IconCloud width={13} height={13} /> : <IconDevice width={13} height={13} />}
              {result.comps.source === "live" ? "live comps" : result.comps.source === "cache" ? "cached comps" : result.comps.source === "local_history" ? "your sold history" : "estimate"}
            </span>
            <span className="chip">{result.comps.basis}</span>
            <span className="chip">
              <IconShield width={13} height={13} />
              {formatPercent(result.price.confidence)} confidence
            </span>
          </div>
          {result.identification.caveats?.length ? (
            <ul className="space-y-1 text-xs" style={{ color: "var(--maybe)" }}>
              {result.identification.caveats.map((c) => (
                <li key={c} className="flex gap-1.5">
                  <IconWarn width={14} height={14} className="mt-px shrink-0" />
                  {c}
                </li>
              ))}
            </ul>
          ) : null}

          {/* ── what you pay: the only input the verdict really needs ────── */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Asking price</span>
              <MoneyInput value={buyPrice} onChange={setBuyPrice} aria-label="Asking price" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Marketplace</span>
              <Select
                value={cost.marketplace}
                aria-label="Marketplace"
                onChange={(v) => {
                  const m = v as MarketplaceId;
                  // Switching marketplace pulls that marketplace's real fee schedule
                  // instead of silently keeping eBay's numbers.
                  setCostLocal(
                    mergeCostModel(defaultCostModel(m), {
                      marketplace: m,
                      targetMultiple: cost.targetMultiple,
                      minProfit: cost.minProfit,
                    }),
                  );
                }}
                options={(Object.keys(MARKETPLACE_LABELS) as MarketplaceId[]).map((m) => ({ value: m, label: MARKETPLACE_LABELS[m] }))}
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span>
              Profit <strong className="price">{formatMoney(econ.expectedProfit)}</strong>
            </span>
            <span>
              Net <strong className="price">{formatMoney(econ.netProceeds)}</strong>
            </span>
            <span>
              Multiple <strong className="price">{formatMultiple(econ.multiple)}</strong>
            </span>
            <span className="text-muted">
              Fees <strong className="price">{formatMoney(econ.feesTotal)}</strong>
            </span>
          </div>

          {/* ── progressive disclosure: the numbers behind the number ────── */}
          <div className="space-y-2">
            <Disclosure summary="Assumptions & fees" hint={MARKETPLACE_LABELS[cost.marketplace]}>
              <CostPanel cost={cost} onChange={setCostLocal} />
            </Disclosure>
            <Disclosure summary={`Comparables (${result.comps.comps.length})`} hint={result.comps.source}>
              <CompsPanel comps={result.comps} expected={result.price.expected} />
            </Disclosure>
            <Disclosure summary="What ran where" hint={`${result.totalMs} ms`}>
              <RanLog ran={result.ran} totalMs={result.totalMs} />
            </Disclosure>
          </div>

          {onNote && (
            <Disclosure summary="Note">
              <textarea
                defaultValue={item?.note ?? ""}
                onChange={(e) => onNote(e.target.value)}
                rows={2}
                placeholder="Label partly torn. Check the zipper pull."
                className="w-full rounded-xl border p-3 text-sm outline-none"
                style={{ borderColor: "var(--line-strong)", background: "var(--surface)", color: "var(--ink)" }}
              />
            </Disclosure>
          )}
        </div>
      </div>

      {/* ── the actions: thumb-reachable, never more than three ─────────── */}
      <div className="grid grid-cols-3 gap-2">
        <button className="btn btn-primary col-span-1" onClick={onSave} disabled={saved}>
          <IconCheck width={18} height={18} />
          {saved ? "Saved" : "Save"}
        </button>
        <button
          className="btn btn-ghost"
          onClick={async () => {
            setBusyListing(true);
            try {
              await onListing();
            } finally {
              setBusyListing(false);
            }
          }}
          disabled={busyListing}
        >
          <IconSparkle width={18} height={18} />
          {busyListing ? "Writing…" : "Listing"}
        </button>
        <button
          className="btn btn-ghost"
          onClick={async () => {
            const text =
              listingText ??
              `${result.identification.title}\n${verdict.label} — max offer ${formatMoney(verdict.maxOffer)}\nEst. resale ${formatMoney(result.price.expected)} (${result.comps.basis})`;
            try {
              if (navigator.share) await navigator.share({ title: result.identification.title, text });
              else await navigator.clipboard.writeText(text);
            } catch {
              /* user cancelled */
            }
          }}
        >
          <IconShare width={18} height={18} />
          Share
        </button>
      </div>

      {listingText && <ListingPreview text={listingText} />}
    </section>
  );
}

function ListingPreview({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <IconSparkle width={16} height={16} /> Draft listing
        </h3>
        <button
          className="btn btn-ghost !min-h-0 !px-2 !py-1 text-xs"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? <IconCheck width={14} height={14} /> : <IconCopy width={14} height={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed" style={{ color: "var(--ink-2)" }}>
        {text}
      </pre>
    </div>
  );
}

/** A compact one-line verdict for list rows. */
export function VerdictPill({ verdict }: { verdict: Verdict }) {
  const s = VERDICT_STYLE[verdict.label];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold"
      style={{ background: s.soft, color: s.color }}
    >
      <s.Icon width={12} height={12} />
      {verdict.label}
    </span>
  );
}

export { IconChevron, IconRefresh, IconBolt };
