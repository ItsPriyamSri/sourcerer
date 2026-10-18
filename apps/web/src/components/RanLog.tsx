import type { RanLogEntry } from "@sourcerer/shared";
import { IconCloud, IconDevice, IconMinus } from "./Icons.tsx";

/**
 * "What ran where" — the receipt for the privacy promise.
 *
 * Principle 8: "your photos never leave this device" must be *provable*, not
 * marketing. Each row says which provider ran, how long it took, and whether any
 * data left the machine. If the user turns on live comps, this log says so plainly.
 */
const LOCALITY = {
  device: { label: "on this device", Icon: IconDevice, color: "var(--buy)", soft: "var(--buy-soft)" },
  cloud: { label: "left the device", Icon: IconCloud, color: "var(--maybe)", soft: "var(--maybe-soft)" },
  none: { label: "did not run", Icon: IconMinus, color: "var(--muted)", soft: "var(--surface-2)" },
} as const;

export function RanLog({ ran, totalMs }: { ran: RanLogEntry[]; totalMs?: number }) {
  const anyCloud = ran.some((r) => r.locality === "cloud" && r.ok);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        {anyCloud
          ? "Some steps used the network (you can see exactly which, below). Turn off live comps to keep everything local."
          : "Nothing in this scan left your device. The photo, the identification and the pricing all ran locally."}
      </p>
      <ul className="space-y-1.5">
        {ran.map((r, i) => {
          const L = LOCALITY[r.locality];
          return (
            <li key={`${r.step}-${i}`} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5" style={{ background: "var(--surface-2)" }}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: L.soft, color: L.color }}>
                <L.Icon width={14} height={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold capitalize">{r.step}</span>
                <span className="block truncate text-[11px] text-muted">
                  {r.provider} · {L.label}
                  {r.detail ? ` · ${r.detail}` : ""}
                </span>
              </span>
              <span className="price shrink-0 text-[11px] text-muted">{r.ok ? `${r.ms} ms` : "failed"}</span>
            </li>
          );
        })}
      </ul>
      {totalMs !== undefined && (
        <p className="price text-right text-[11px] text-muted">total {totalMs} ms</p>
      )}
    </div>
  );
}
