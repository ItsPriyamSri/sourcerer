import type { ScanStage } from "@sourcerer/shared";
import { IconCheck, IconSparkle, IconTag, IconBolt, IconEye, IconWarn } from "./Icons.tsx";

/**
 * Staged progress.
 *
 * Principle 1: never a blank spinner. The pipeline reports real stages over SSE, so
 * the user watches the actual work happen and knows the app is not stuck. On slow CPU
 * inference this is the difference between "broken" and "thinking".
 *
 * Local inference on a CPU is genuinely slow, so the wait is designed rather than
 * hidden: a connected timeline shows which step is running right now, which have
 * finished with their real millisecond timings, and how far through the four we are.
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

  const doneCount = STEPS.filter(({ stage }) => byStage.get(stage)?.status === "done").length;
  // The active row is the first step that has not resolved. Once every step has, none is.
  const activeIndex = running
    ? STEPS.findIndex(({ stage }) => {
        const s = byStage.get(stage);
        return !s || s.status === "start";
      })
    : -1;

  return (
    <div className="space-y-3">
      {/*
        One concise spoken status per step change. The list below is a live region too,
        but a screen reader re-reading four rows, their detail strings and their timings
        on every tick is noise — this says the thing that changed.
      */}
      <div className="sr-only-text" role="status" aria-atomic="true">
        {running
          ? `Step ${Math.min(doneCount + 1, STEPS.length)} of ${STEPS.length}: ${STEPS[Math.min(doneCount, STEPS.length - 1)]?.label}`
          : `All ${STEPS.length} steps finished.`}
      </div>

      {/* `aria-live` without `role="status"` keeps the list semantics and stops the
          whole list being re-announced atomically on every update. */}
      <ol className="relative" aria-live="polite" aria-label="Scan progress">
        <span
          aria-hidden="true"
          className="absolute bottom-6 top-6 w-px"
          style={{ left: "1.0625rem", background: "var(--line)" }}
        />
        {STEPS.map(({ stage, label, Icon }, idx) => {
          const s = byStage.get(stage);
          const done = s?.status === "done";
          const error = s?.status === "error";
          const active = idx === activeIndex;
          return (
            <li key={stage} className="relative flex items-start gap-3 pb-4 last:pb-0">
              <span
                className={`relative z-10 flex h-[2.125rem] w-[2.125rem] shrink-0 items-center justify-center rounded-full ${
                  active ? "animate-pulse-ring" : ""
                }`}
                style={{
                  background: error ? "var(--maybe-soft)" : done ? "var(--buy-soft)" : "var(--surface-2)",
                  color: error ? "var(--maybe)" : done ? "var(--buy)" : active ? "var(--amber)" : "var(--muted)",
                }}
              >
                {done ? <IconCheck width={18} height={18} /> : error ? <IconWarn width={18} height={18} /> : <Icon width={18} height={18} />}
              </span>
              <span className="min-w-0 flex-1 pt-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold" style={{ color: done || active ? "var(--ink)" : "var(--muted)" }}>
                    {label}
                  </span>
                  {s?.ms !== undefined && <span className="price meta">{s.ms} ms</span>}
                </span>
                {s?.detail && <span className="meta block">{s.detail}</span>}
                {active && (
                  <span className="mt-1.5 block h-0.5 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
                    <span className="animate-sweep block h-full w-1/3 rounded-full" style={{ background: "var(--amber)" }} />
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {running && <p className="meta">The first scan of a session loads the model into memory. The ones after it are quicker.</p>}
    </div>
  );
}

/** A single honest line for the very first moment, before any stage has fired. */
export function WakingUp() {
  return (
    <p className="flex items-start gap-2 rounded-lg p-3 text-sm" style={{ background: "var(--surface-2)", color: "var(--ink-2)" }}>
      <IconSparkle width={16} height={16} className="mt-0.5 shrink-0" style={{ color: "var(--amber)" }} />
      <span>
        Waking the local model. First run loads a few gigabytes into memory — the ones after this are quick.
      </span>
    </p>
  );
}
