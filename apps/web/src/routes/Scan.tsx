import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CapturedItem, ScanRequest, ScanResult, ScanStage } from "@sourcerer/shared";
import { loadCost } from "../lib/db.ts";
import { dataUrlBytes, prepareImage } from "../lib/image.ts";
import { listingToText, scanShareText } from "../lib/format.ts";
import { api } from "../lib/api.ts";
import { haptic, smartScan, useApp } from "../lib/store.tsx";
import { runOfflineScan } from "../lib/offline.ts";
import { StageProgress, WakingUp } from "../components/StageProgress.tsx";
import { VerdictCard, VerdictPill } from "../components/VerdictCard.tsx";
import { Shell } from "../components/Shell.tsx";
import { EmptyState, MoneyInput } from "../components/Bits.tsx";
import { IconBolt, IconCamera, IconDevice, IconSignalOff, IconSparkle, IconTag, IconWarn } from "../components/Icons.tsx";

/**
 * The Scan screen.
 *
 * This is where the whole thesis lives: capture → price → decide, with the decision
 * available whether or not there is a network. The primary control is a single large
 * button in the thumb zone.
 */
export default function ScanPage() {
  const { items, caps, brainUp, online, saveScan, cost, toast } = useApp();
  const navigate = useNavigate();

  const [photo, setPhoto] = useState<{ dataUrl: string; width: number; height: number } | null>(null);
  const [text, setText] = useState("");
  const [buyPrice, setBuyPrice] = useState(0);
  const [keepLocal, setKeepLocal] = useState(false);
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<ScanStage[]>([]);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [listing, setListing] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [showRaw, setShowRaw] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const verdictRef = useRef<HTMLDivElement>(null);

  const hasInput = Boolean(photo || text.trim());
  const modelReady = Boolean(caps?.llm.some((l) => l.available));
  const modelDetail = caps?.llm.find((l) => !l.available)?.detail;
  const brainReachable = brainUp === true && modelReady;

  // Keep the user's saved cost model current without a round trip.
  useEffect(() => {
    void loadCost().then((c) => {
      if (Object.keys(c).length) {
        // The scan request will merge these; nothing to render here.
      }
    });
  }, []);

  const onPick = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        const img = await prepareImage(file);
        setPhoto(img);
        setSaved(false);
        setResult(null);
        haptic(8);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Could not read that photo.", "bad");
      }
    },
    [toast],
  );

  const runScan = useCallback(async () => {
    if (!hasInput) return;
    setRunning(true);
    setStages([]);
    setResult(null);
    setError(undefined);
    setListing(undefined);
    setSaved(false);

    const request: ScanRequest = {
      ...(photo ? { image: photo.dataUrl } : {}),
      ...(text.trim() ? { text: text.trim() } : {}),
      ...(buyPrice > 0 ? { buyPrice } : {}),
      ...(Object.keys(cost).length ? { cost } : {}),
      offline: keepLocal || undefined,
    };

    try {
      if (keepLocal || !brainReachable) {
        // No network path at all: identify from text, price from the user's own history.
        const local = runOfflineScan({ ...request, history: items }, (s) => setStages((prev) => [...prev, s]));
        setResult(local);
        if (keepLocal) toast("Priced on-device from your own sold history.", "good");
        else setError("Your brain isn't reachable, so I priced this on-device from your own history.");
      } else {
        const { result: r, usedBrain, error: err } = await smartScan(request, (s) => setStages((prev) => [...prev, s]), items);
        setResult(r);
        if (!usedBrain) setError(err ?? "The brain was unreachable; this is an on-device estimate.");
      }
      haptic(14);
      requestAnimationFrame(() => verdictRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      toast("Scan failed. Your capture is safe — try again.", "bad");
    } finally {
      setRunning(false);
    }
  }, [hasInput, photo, text, buyPrice, cost, keepLocal, brainReachable, items, toast]);

  const doSave = useCallback(async () => {
    if (!result) return;
    const request: ScanRequest = {
      ...(photo ? { image: photo.dataUrl } : {}),
      ...(text.trim() ? { text: text.trim() } : {}),
      ...(buyPrice > 0 ? { buyPrice } : {}),
      ...(Object.keys(cost).length ? { cost } : {}),
      offline: keepLocal || undefined,
    };
    await saveScan(result, request);
    setSaved(true);
    toast("Saved to your queue.", "good");
    haptic(10);
  }, [result, photo, text, buyPrice, cost, keepLocal, saveScan, toast]);

  const doListing = useCallback(async () => {
    if (!result) return;
    try {
      const { listing: draft } = await api.listing({
        identification: result.identification,
        price: result.price,
        comps: result.comps,
        cost: result.cost,
        itemId: saved ? result.id : undefined,
      });
      setListing(listingToText(draft));
      toast("Draft listing written. Check the price before you post.", "good");
    } catch {
      // No brain: build an honest template from what we know, clearly marked as raw.
      setListing(
        [
          result.identification.title,
          "",
          `${result.identification.category} · ${result.identification.condition.replace("_", " ")}`,
          result.identification.attributes && Object.keys(result.identification.attributes).length
            ? Object.entries(result.identification.attributes)
                .map(([k, v]) => `${k}: ${v}`)
                .join("\n")
            : "",
          "",
          "Describe the condition honestly, measure where it matters, and photograph the flaws.",
          "",
          `Price: $${result.price.expected}`,
          `Tags: ${result.identification.keywords.join(", ")}`,
          "",
          "(Generated on-device without the model — start your brain for a written description.)",
        ]
          .filter((l) => l !== undefined)
          .join("\n"),
      );
      toast("Draft made on-device. Start your brain for a full description.", "info");
    }
  }, [result, saved, toast]);

  const reset = () => {
    setResult(null);
    setStages([]);
    setPhoto(null);
    setText("");
    setListing(undefined);
    setError(undefined);
    setSaved(false);
    setBuyPrice(0);
  };

  const recent = items.slice(0, 3);

  return (
    <Shell>
      {/* ── capture ──────────────────────────────────────────────────────── */}
      {!result && !running && (
        <section className="space-y-4">
          {items.length === 0 && <FirstRun onDemo={() => { setText("Levi's 501 Big E selvedge denim jacket, size 42, small hole at cuff"); setBuyPrice(12); }} />}

          <div className="card overflow-hidden">
            <label
              className="relative flex cursor-pointer flex-col items-center justify-center gap-3 px-6 py-10 text-center"
              style={{ background: photo ? "transparent" : "var(--surface-2)" }}
            >
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => void onPick(e.target.files?.[0])}
              />
              {photo ? (
                <>
                  <img src={photo.dataUrl} alt="The item you captured" className="max-h-64 w-full rounded-xl object-contain" />
                  <span className="text-xs text-muted">
                    {photo.width}×{photo.height} · {(dataUrlBytes(photo.dataUrl) / 1024).toFixed(0)} KB, prepared on this device
                  </span>
                  <span className="btn btn-ghost">Retake</span>
                </>
              ) : (
                <>
                  <span className="flex h-16 w-16 items-center justify-center rounded-full" style={{ background: "var(--amber)", color: "var(--bg)" }}>
                    <IconCamera width={30} height={30} />
                  </span>
                  <span className="display text-lg font-semibold">Photograph the item</span>
                  <span className="max-w-xs text-sm text-muted">
                    Point at the label if there is one. The photo is processed on your device.
                  </span>
                </>
              )}
            </label>

            <div className="space-y-3 border-t p-4" style={{ borderColor: "var(--line)" }}>
              <label className="block">
                <span className="mb-1 flex items-baseline justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">Or describe it</span>
                  <span className="text-[11px] text-muted">works with no camera and no signal</span>
                </span>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={2}
                  placeholder="“Levi's 501 Big E selvedge, size 32, small hole at cuff”"
                  className="w-full rounded-xl border p-3 text-base outline-none"
                  style={{ borderColor: "var(--line-strong)", background: "var(--surface)", color: "var(--ink)" }}
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Asking price</span>
                  <MoneyInput value={buyPrice} onChange={setBuyPrice} placeholder="0" aria-label="Asking price" />
                </label>
                <label className="flex items-end gap-2 pb-1">
                  <input
                    type="checkbox"
                    checked={keepLocal}
                    onChange={(e) => setKeepLocal(e.target.checked)}
                    className="tap h-5 w-5 rounded"
                    id="keep-local"
                  />
                  <span className="text-xs leading-tight">
                    <span className="font-semibold">Keep it fully local</span>
                    <span className="block text-muted">skip live market comps</span>
                  </span>
                </label>
              </div>

              {!brainReachable && (
                <p className="flex items-start gap-2 rounded-lg p-2.5 text-xs" style={{ background: "var(--maybe-soft)", color: "var(--maybe)" }}>
                  <IconSignalOff width={16} height={16} className="mt-px shrink-0" />
                  {brainUp === null
                    ? "Looking for your brain…"
                    : brainUp === false
                      ? "Your brain isn't running. I'll price from your own sold history instead — open Settings to point me at it."
                      : `${modelDetail ?? "The local model isn't ready yet."} I'll price from your own sold history until it is.`}
                </p>
              )}
            </div>
          </div>

          <button className="btn btn-primary w-full py-4 text-base" onClick={() => void runScan()} disabled={!hasInput}>
            <IconBolt width={20} height={20} />
            {keepLocal ? "Price it on this device" : "Price it"}
          </button>

          <div className="flex items-center justify-between gap-2 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <IconDevice width={14} height={14} />
              {caps?.brain.local === false ? "Hosted open-weight model" : "Local open-weight model"}
            </span>
            <span className="flex items-center gap-1.5">
              <IconTag width={14} height={14} />
              {online ? "SerpApi comps available" : "no network — local pricing"}
            </span>
          </div>

          {recent.length > 0 && (
            <section aria-label="Recent captures" className="pt-2">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Recent</h2>
              <ul className="space-y-2">
                {recent.map((i) => (
                  <RecentRow key={i.id} item={i} />
                ))}
              </ul>
              <button className="btn btn-ghost mt-2 w-full" onClick={() => navigate("/listings")}>
                See all {items.length} in listings
              </button>
            </section>
          )}
        </section>
      )}

      {/* ── progress ─────────────────────────────────────────────────────── */}
      {running && (
        <section className="card p-5">
          <h2 className="display mb-4 text-lg font-semibold">Working it out…</h2>
          <StageProgress stages={stages} running={running} />
          {stages.length === 0 && <div className="mt-4">{<WakingUp />}</div>}
        </section>
      )}

      {/* ── result ───────────────────────────────────────────────────────── */}
      {result && !running && (
        <div ref={verdictRef} className="animate-rise space-y-4">
          {error && (
            <p className="flex items-start gap-2 rounded-lg p-3 text-xs" style={{ background: "var(--maybe-soft)", color: "var(--maybe)" }}>
              <IconWarn width={16} height={16} className="mt-px shrink-0" />
              {error}
            </p>
          )}

          {photo && (
            <img src={photo.dataUrl} alt="" className="max-h-48 w-full rounded-xl border object-contain" style={{ borderColor: "var(--line)" }} />
          )}

          <VerdictCard
            result={result}
            onSave={() => void doSave()}
            onListing={doListing}
            saved={saved}
            listingText={listing}
          />

          <div className="flex flex-wrap gap-2">
            <button className="btn btn-ghost flex-1" onClick={() => void runScan()}>
              <IconSparkle width={16} height={16} /> Re-price
            </button>
            <button className="btn btn-ghost flex-1" onClick={reset}>
              <IconCamera width={16} height={16} /> Next item
            </button>
          </div>

          <details className="card p-3 text-xs" onToggle={(e) => setShowRaw((e.target as HTMLDetailsElement).open)}>
            <summary className="cursor-pointer font-semibold">Raw identification</summary>
            {showRaw && (
              <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
                {JSON.stringify(result.identification, null, 2)}
              </pre>
            )}
          </details>

          <p className="text-center text-[11px] text-muted">
            {scanShareText(result).split("\n")[1]}
          </p>
        </div>
      )}
    </Shell>
  );
}

function FirstRun({ onDemo }: { onDemo: () => void }) {
  return (
    <div className="card stripe p-1">
      <div className="rounded-xl p-4" style={{ background: "var(--surface)" }}>
        <h2 className="display text-lg font-semibold">Never overpay in a basement again.</h2>
        <p className="mt-1 text-sm text-muted">
          Photograph an item. Sourcerer identifies it with a model running on your own machine, prices
          it against real listings, and tells you the most you should pay — no signal required.
        </p>
        <button className="btn btn-ghost mt-3" onClick={onDemo}>
          <IconSparkle width={16} height={16} /> Try it with a demo item
        </button>
      </div>
    </div>
  );
}

function RecentRow({ item }: { item: CapturedItem }) {
  return (
    <li className="card flex items-center gap-3 p-3">
      {item.thumbnail ? (
        <img src={item.thumbnail} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--surface-2)" }}>
          <IconTag width={18} height={18} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{item.identification.title}</span>
        <span className="flex items-center gap-2 text-[11px] text-muted">
          <VerdictPill verdict={item.verdict} />
          <span className="price">max {`$${Math.round(item.verdict.maxOffer)}`}</span>
        </span>
      </span>
    </li>
  );
}

export { EmptyState };
