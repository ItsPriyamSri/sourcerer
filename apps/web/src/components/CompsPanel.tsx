import { formatMoney, type CompsResult } from "@sourcerer/shared";
import { IconCloud, IconDevice, IconSearch, IconWarn } from "./Icons.tsx";

/**
 * The comps table.
 *
 * Two things a reseller must be able to see at a glance: which listings are *asking*
 * prices and which actually *sold*, and where the expected price came from. We tag
 * every row and never mix the two silently.
 */
export function CompsPanel({ comps, expected }: { comps: CompsResult; expected: number }) {
  const s = comps.summary;
  const SourceIcon = comps.source === "live" || comps.source === "cache" ? IconCloud : IconDevice;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 text-xs text-muted">
        <SourceIcon width={14} height={14} className="mt-0.5 shrink-0" />
        <p>
          <strong style={{ color: "var(--ink-2)" }}>{comps.basis}.</strong>{" "}
          {comps.queryUsed ? <>Searched “{comps.queryUsed}”. </> : null}
          {comps.comps.some((c) => c.kind === "asking") ? (
            <>
              Asking prices are discounted by a visible 14% to approximate what things
              actually sell for — treat them as a range, not a promise.
            </>
          ) : null}
        </p>
      </div>

      {s && (
        <dl className="grid grid-cols-4 gap-2 text-center">
          {(
            [
              ["Low", s.low],
              ["Median", s.median],
              ["Mean*", s.mean],
              ["High", s.high],
            ] as const
          ).map(([label, v]) => (
            <div key={label} className="rounded-lg border py-1.5" style={{ borderColor: "var(--line)" }}>
              <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
              <dd className="price text-sm font-semibold">{formatMoney(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      {s && <p className="text-[11px] text-muted">*10% trimmed mean — one chancer asking 10× can't move your number.</p>}

      {comps.comps.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <IconSearch width={16} height={16} /> No comparables found for this query. Widen the keywords or add a brand.
        </p>
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
          {comps.comps.slice(0, 40).map((c, i) => (
            <li key={`${c.url ?? c.title}-${i}`} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm" style={{ color: "var(--ink-2)" }}>
                  {c.title || "(untitled listing)"}
                </p>
                <p className="flex items-center gap-2 text-[11px] text-muted">
                  <span
                    className="rounded px-1 py-px font-semibold"
                    style={
                      c.kind === "sold"
                        ? { background: "var(--buy-soft)", color: "var(--buy)" }
                        : { background: "var(--surface-2)", color: "var(--muted)" }
                    }
                  >
                    {c.kind === "sold" ? "sold" : "asking"}
                  </span>
                  {c.condition && <span>{c.condition}</span>}
                  <span>{c.source}</span>
                </p>
              </div>
              <div className="price shrink-0 text-sm font-semibold">
                {formatMoney(c.price, c.currency)}
                {Math.abs(c.price - expected) / Math.max(1, expected) > 0.6 && (
                  <span className="ml-1 inline-flex items-center align-middle" style={{ color: "var(--maybe)" }}>
                    <IconWarn width={12} height={12} />
                    {/*
                      The icon is aria-hidden by the shared Base, so the meaning it carries
                      ("this comp is well away from the estimate") has to exist as text.
                    */}
                    <span className="sr-only-text">well away from the expected price</span>
                  </span>
                )}
              </div>
              {c.url && (
                <a
                  href={c.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-xs underline decoration-dotted"
                  style={{ color: "var(--amber)" }}
                >
                  open
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted">
        Queried {new Date(comps.queriedAt).toLocaleTimeString()} · source{" "}
        <strong style={{ color: "var(--ink-2)" }}>{comps.source}</strong>
      </p>
    </div>
  );
}
