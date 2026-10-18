import { useEffect, useMemo, useRef, useState } from "react";
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
import { scanShareText } from "../lib/format.ts";
import { Announcer, Disclosure, RangeBar, MoneyInput, SectionHead, Select } from "./Bits.tsx";
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

/**
 * The no-asking-price state is not a verdict, and dressing it as one is a lie.
 *
 * With no tag price typed, the shared verdict maths reads offerRatio = 0 and returns
 * BUY — technically "if it were free you'd buy it", which is useless at a rack. That
 * state is really "here is your ceiling, go and offer": a neutral, amber, bolt-marked
 * framing that carries no buy/pass claim. It keeps the invariant that colour is never
 * the only signal, because it ships its own icon and its own words.
 */
const CEILING_STYLE = { color: "var(--amber)", soft: "var(--amber-soft)", Icon: IconBolt, label: "Your ceiling" };

type BannerStyle = { color: string; soft: string; Icon: typeof IconCheck; label: string };

export function useRepriced(price: { expected: number }, cost: CostModel, buyPrice: number, confidence: number) {
  return useMemo(() => decideVerdict(buyPrice, price.expected, cost, confidence), [buyPrice, price.expected, cost, confidence]);
}

export function VerdictBanner({
  verdict,
  compact = false,
  override,
  reason,
}: {
  verdict: Verdict;
  compact?: boolean;
  /** Swap the whole treatment (icon + colour + word). Used for the ceiling state. */
  override?: BannerStyle;
  reason?: string;
}) {
  const s = VERDICT_STYLE[verdict.label];
  const style: BannerStyle = override ?? { ...s, label: verdict.label };
  const text = reason ?? verdict.reason;
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl px-4 ${compact ? "py-2.5" : "py-4"}`}
      style={{ background: style.soft, border: `1px solid color-mix(in oklab, ${style.color} 45%, transparent)` }}
      role="status"
      aria-live="polite"
    >
      <span
        className={`flex shrink-0 items-center justify-center rounded-full ${compact ? "h-8 w-8" : "h-11 w-11"}`}
        style={{ background: style.color, color: "var(--surface)" }}
      >
        <style.Icon width={compact ? 18 : 24} height={compact ? 18 : 24} />
      </span>
      <div className="min-w-0">
        <div className={`display font-bold leading-none ${compact ? "text-lg" : "text-2xl"}`} style={{ color: style.color }}>
          {style.label}
        </div>
        {!compact && (
          <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>
            {text}
          </p>
        )}
        {compact && (
          <p className="truncate text-xs" style={{ color: "var(--ink-2)" }}>
            {text}
          </p>
        )}
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
  buyPrice: buyPriceProp,
  onBuyPrice,
  photoUrl,
}: {
  result: ScanResult;
  item?: CapturedItem;
  onSave: () => void;
  onListing: () => void;
  onNote?: (note: string) => void;
  saved: boolean;
  listingText?: string;
  /**
   * The asking price you typed on the capture form, hoisted into this card.
   *
   * This was a real bug: the card used to keep its own copy of the price, initialised
   * to zero, so the number you typed before the scan was silently discarded and the
   * verdict came back computed at $0. Whoever owns the input has to own the number, so
   * the parent passes both the value and the setter and this card keeps no copy.
   */
  buyPrice?: number;
  onBuyPrice?: (n: number) => void;
  /** The capture itself, shown as a thumbnail in the header. Evidence beside the claim. */
  photoUrl?: string;
}) {
  const [cost, setCostLocal] = useState<CostModel>(item?.cost ?? result.cost);
  const [localBuyPrice, setLocalBuyPrice] = useState<number>(item?.buyPrice ?? buyPriceProp ?? 0);
  const buyPrice = buyPriceProp ?? localBuyPrice;
  const setBuyPrice = onBuyPrice ?? setLocalBuyPrice;
  const [busyListing, setBusyListing] = useState(false);

  const verdict = useRepriced(result.price, cost, buyPrice, result.price.confidence);
  const econ = useMemo(() => computeEconomics(buyPrice, result.price.expected, cost), [buyPrice, result.price.expected, cost]);
  /**
   * The same economics re-run *at the ceiling*. netProceeds does not depend on what
   * you pay, so dividing it by the target multiple is the whole derivation of the max
   * offer — and showing it as arithmetic ("$111.66 net ÷ 3× target") is what turns the
   * biggest number on the screen from a claim into a calculation you can check.
   */
  const econAtCeiling = useMemo(
    () => computeEconomics(verdict.maxOffer, result.price.expected, cost),
    [verdict.maxOffer, result.price.expected, cost],
  );

  const s = VERDICT_STYLE[verdict.label];
  const basisIsLive = result.comps.source === "live" || result.comps.source === "cache";

  const noPrice = buyPrice <= 0;
  // Only reframe when there is a ceiling to talk about; a genuine "not a flip"
  // (maxOffer 0) keeps its own, accurate reason.
  const showCeiling = noPrice && verdict.maxOffer > 0;
  const reason = showCeiling
    ? `At your ceiling you'd still clear about ${formatMoney(econAtCeiling.expectedProfit)}. Here's what to offer.`
    : verdict.reason;
  const headline = showCeiling ? CEILING_STYLE.label : verdict.label;
  const accent = showCeiling ? CEILING_STYLE.color : s.color;

  /*
    Announce the decision once, not on every keystroke.

    The banner is a live region but it mounts *with* its sentence already inside, so
    it announces nothing. This node mounts empty and is filled a tick later, which is
    a real change a screen reader will read. It fires from a mount-only effect so
    re-pricing at the rack does not machine-gun the user.
  */
  const [announcement, setAnnouncement] = useState("");
  const announced = useRef(false);
  useEffect(() => {
    if (announced.current) return;
    announced.current = true;
    setAnnouncement(`${headline}. ${reason} Max offer ${formatMoney(verdict.maxOffer)}.`);
    // Mount-only by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const feesAndShipping = econ.feesTotal + cost.shippingCost + cost.suppliesCost;
  const feePct = cost.platformFeePct + cost.paymentFeePct;
  const fixedCosts = cost.paymentFlat + cost.shippingCost + cost.suppliesCost;

  return (
    <section
      className="scroll-anchor space-y-3 lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start lg:gap-5 lg:space-y-0"
      aria-label="Verdict"
    >
      <Announcer message={announcement} />

      {/* ── 1. the decision ───────────────────────────────────────────────── */}
      <div className="card overflow-hidden lg:col-start-1 lg:row-start-1">
        <div className="stripe h-1.5 w-full" />
        <div className="space-y-4 p-4 sm:p-5">
          <header className="flex items-start gap-3">
            {photoUrl && (
              // Decorative: the title beside it is the identity, and the user just took it.
              <img src={photoUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg border object-cover" style={{ borderColor: "var(--line)" }} />
            )}
            <div className="min-w-0 flex-1">
              <h2 className="display text-lg font-semibold leading-snug sm:text-xl">{result.identification.title}</h2>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                {result.identification.brand && <span className="chip">{result.identification.brand}</span>}
                <span className="chip">{result.identification.category}</span>
                <span className="chip">{result.identification.condition.replace("_", " ")}</span>
              </p>
            </div>
          </header>

          <VerdictBanner verdict={verdict} override={showCeiling ? CEILING_STYLE : undefined} reason={reason} />

          {/*
            The ceiling. This is the single most important number in the product, so it
            is the only element that gets the hero scale, it sits alone on its own line
            (never squeezed into half of a two-column grid), and its colour is always
            backed by the words above and below it.
          */}
          <div>
            <p className="kicker">Max offer · don&apos;t pay more than</p>
            <p className="hero-number mt-1" style={{ color: accent }}>
              {formatMoney(verdict.maxOffer)}
            </p>
            {verdict.maxOffer > 0 && cost.targetMultiple > 1 ? (
              <p className="price meta mt-2">
                {formatMoney(econ.netProceeds)} net ÷ {cost.targetMultiple}× target = {formatMoney(verdict.maxOffer)}
              </p>
            ) : (
              <p className="meta mt-2">{formatMoney(econ.netProceeds)} net after fees — nothing left to target.</p>
            )}
            {!noPrice && (
              <p className="meta mt-1">
                Asking {formatMoney(buyPrice)} sits{" "}
                <strong style={{ color: accent }}>
                  {verdict.offerRatio <= 1 ? `${formatPercent(1 - verdict.offerRatio)} under` : `${formatPercent(verdict.offerRatio - 1)} over`}
                </strong>{" "}
                your ceiling.
              </p>
            )}
          </div>

          {/* ── why that number: resale, the deduction, and what's left ───── */}
          <dl className="grid grid-cols-3 gap-3 border-t pt-3" style={{ borderColor: "var(--line)" }}>
            <div>
              <dt className="kicker">Resale</dt>
              <dd className="price text-base font-bold">{formatMoney(result.price.expected)}</dd>
              <dd className="price meta">{formatRange(result.price.low, result.price.high)}</dd>
            </div>
            <div>
              <dt className="kicker">Net</dt>
              <dd className="price text-base font-bold">{formatMoney(econ.netProceeds)}</dd>
              <dd className="meta">after fees &amp; ship</dd>
            </div>
            <div>
              <dt className="kicker">Fees + ship</dt>
              <dd className="price text-base font-bold">{formatMoney(feesAndShipping)}</dd>
              <dd className="price meta">
                {formatPercent(feePct)} + {formatMoney(fixedCosts)}
              </dd>
            </div>
          </dl>

          {/* Range bar: where the expected price sits in the observed spread. */}
          <div className="px-1">
            <RangeBar low={result.price.low} mid={result.price.expected} high={result.price.high} marker={buyPrice > 0 ? buyPrice : undefined} />
            <div className="meta mt-1 flex justify-between">
              <span className="price">{formatMoney(result.price.low)}</span>
              <span className="flex items-center gap-1">
                {result.price.method === "tabpfn" ? <IconSparkle width={12} height={12} /> : <IconTag width={12} height={12} />}
                {result.price.method.replace("_", " ")}
              </span>
              <span className="price">{formatMoney(result.price.high)}</span>
            </div>
          </div>

          {/* ── provenance: never launder an estimate as a comp ──────────── */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip" style={basisIsLive ? { background: "var(--buy-soft)", color: "var(--buy)" } : undefined}>
                {basisIsLive ? <IconCloud width={13} height={13} /> : <IconDevice width={13} height={13} />}
                {result.comps.source === "live" ? "live comps" : result.comps.source === "cache" ? "cached comps" : result.comps.source === "local_history" ? "your sold history" : "estimate"}
              </span>
              <span className="chip">
                <IconShield width={13} height={13} />
                {formatPercent(result.price.confidence)} confidence
              </span>
            </div>
            {/* The basis is a sentence, not a badge — as a pill it wrapped to a second
                full-width line and pushed the caveats down. */}
            <p className="meta">{result.comps.basis}</p>
          </div>

          {result.identification.caveats?.length ? (
            <div className="rounded-xl p-3" style={{ background: "var(--maybe-soft)" }}>
              <p className="kicker" style={{ color: "var(--maybe)" }}>
                Check before you pay
              </p>
              <ul className="mt-1.5 space-y-1 text-sm" style={{ color: "var(--maybe)" }}>
                {result.identification.caveats.map((c) => (
                  <li key={c} className="flex gap-1.5">
                    <IconWarn width={15} height={15} className="mt-0.5 shrink-0" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      {/* ── 2. the rail: the one input, the pay-off, and the actions ──────── */}
      <div className="space-y-3 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <div className="card space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="kicker mb-1 block">Asking price</span>
              <MoneyInput value={buyPrice} onChange={setBuyPrice} aria-label="Asking price" />
            </label>
            <label className="block">
              <span className="kicker mb-1 block">Marketplace</span>
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

          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-3" style={{ borderColor: "var(--line)" }}>
            <div>
              <dt className="kicker">Profit</dt>
              {/* A negative profit is a warning, and the minus sign already carries it —
                  colour is the second signal, never the only one. */}
              <dd className="price font-bold" style={econ.expectedProfit < 0 ? { color: "var(--maybe)" } : undefined}>
                {formatMoney(econ.expectedProfit)}
              </dd>
            </div>
            <div>
              <dt className="kicker">Multiple</dt>
              <dd className="price font-bold">{formatMultiple(econ.multiple)}</dd>
            </div>
            <div>
              <dt className="kicker">Net</dt>
              <dd className="price font-bold">{formatMoney(econ.netProceeds)}</dd>
            </div>
            <div>
              <dt className="kicker">Fees</dt>
              <dd className="price font-bold">{formatMoney(econ.feesTotal)}</dd>
            </div>
          </dl>
          <p className="meta">
            Profit, net and multiple are computed at the asking price you typed. Edit it and the ceiling moves instantly —
            no model, no network.
          </p>
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
              // One canonical share string, built by the same helper the rest of the app uses.
              const text = listingText ?? scanShareText(result);
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
      </div>

      {/* ── 3. the fine print: the numbers behind the number ─────────────── */}
      <div className="space-y-2 lg:col-start-1 lg:row-start-2">
        <SectionHead title="The fine print" hint="everything is editable" />
        <Disclosure summary="Assumptions & fees" hint={MARKETPLACE_LABELS[cost.marketplace]}>
          <CostPanel cost={cost} onChange={setCostLocal} />
        </Disclosure>
        <Disclosure summary={`Comparables (${result.comps.comps.length})`} hint={result.comps.source}>
          <CompsPanel comps={result.comps} expected={result.price.expected} />
        </Disclosure>
        <Disclosure summary="What ran where" hint={`${result.totalMs} ms`}>
          <RanLog ran={result.ran} totalMs={result.totalMs} />
        </Disclosure>
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

      {listingText && (
        <div className="lg:col-span-2 lg:col-start-1 lg:row-start-3">
          <ListingPreview text={listingText} />
        </div>
      )}
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
