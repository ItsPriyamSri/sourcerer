import type { ScanStage } from "@sourcerer/shared";
import { IconCheck, IconSparkle, IconTag, IconBolt, IconEye, IconWarn } from "./Icons.tsx";

/**
 * Staged progress.
 *
 * Principle 1: never a blank spinner. The pipeline reports real stages over SSE, so
 * the user watches the actual work happen and knows the app is not stuck. On slow CPU
 * inference this is the difference between "broken" and "thinking".
 */

const STEPS: { stage: ScanStage["stage"]; label: string; Icon: typeof IconEye }[] = [
  { stage: "identify", label: "Reading the item", Icon: IconEye },
  { stage: "comps", label: "Checking the market", Icon: IconTag },
  { stage: "price", label: "Pricing it", Icon: IconBolt },
  { stage: "verdict", label: "Deciding", Icon: IconSparkle },
];

export function StageProgress({ stages, running }: { stages: ScanStage[]; running: boolean }) {
  const byStage = new Map<ScanStage["stage"], ScanStage>();
  for (const s of stages) {
    const prev = byStage.get(s.stage);
    if (!prev || s.status !== "start") byStage.set(s.stage, s);
  }

  return (
    <ol className="space-y-2" aria-label="Scan progress" role="status" aria-live="polite">
      {STEPS.map(({ stage, label, Icon }) => {
        const s = byStage.get(stage);
        const done = s?.status === "done";
        const active = running && !done && !s;
        const error = s?.status === "error";
        return (
          <li key={stage} className="flex items-center gap-3">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${active ? "animate-pulse-ring" : ""}`}
              style={{
                background: error ? "var(--maybe-soft)" : done ? "var(--buy-soft)" : "var(--surface-2)",
                color: error ? "var(--maybe)" : done ? "var(--buy)" : "var(--muted)",
              }}
            >
              {done ? <IconCheck width={18} height={18} /> : error ? <IconWarn width={18} height={18} /> : <Icon width={18} height={18} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold" style={{ color: done || active ? "var(--ink)" : "var(--muted)" }}>
                  {label}
                </span>
                {s?.ms !== undefined && <span className="price text-[11px] text-muted">{s.ms} ms</span>}
              </span>
              {s?.detail && <span className="block truncate text-xs text-muted">{s.detail}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** A single honest line for the very first moment, before any stage has fired. */
export function WakingUp() {
  return (
    <p className="text-center text-sm text-muted">
      Waking the local model. First run loads a few gigabytes into memory — the ones after this are quick.
    </p>
  );
}
