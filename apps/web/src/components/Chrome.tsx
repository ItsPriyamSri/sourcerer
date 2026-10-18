import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { api, brainUrl, setBrainUrl } from "../lib/api.ts";
import { useApp } from "../lib/store.tsx";
import { Sheet, TextInput } from "./Bits.tsx";
import {
  IconCamera,
  IconChart,
  IconCheck,
  IconCloud,
  IconDevice,
  IconGear,
  IconList,
  IconMoon,
  IconRefresh,
  IconShield,
  IconSignalOff,
  IconSparkle,
  IconSun,
  IconX,
} from "./Icons.tsx";

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("sourcerer.theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  };
  return { dark, toggle };
}

export function TopBar() {
  const { online, brainUp, caps, pending } = useApp();
  const { dark, toggle } = useTheme();
  const [settings, setSettings] = useState(false);

  return (
    <>
      <header
        className="sticky top-0 z-30 border-b backdrop-blur"
        style={{ borderColor: "var(--line)", background: "color-mix(in oklab, var(--bg) 88%, transparent)" }}
      >
        <div className="mx-auto flex max-w-xl items-center gap-2 px-4 pt-[max(0.6rem,env(safe-area-inset-top))] pb-2">
          <NavLink to="/" className="flex items-baseline gap-2">
            <span className="display text-xl font-bold tracking-tight">Sourcerer</span>
            <span className="hidden text-[11px] text-muted sm:inline">know what it&apos;s worth · anywhere</span>
          </NavLink>
          <span className="flex-1" />
          <button
            className="tap rounded-full p-2"
            onClick={toggle}
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
          >
            {dark ? <IconSun /> : <IconMoon />}
          </button>
          <button className="tap rounded-full p-2" onClick={() => setSettings(true)} aria-label="Settings and status">
            <IconGear />
          </button>
        </div>

        <StatusStrip online={online} brainUp={brainUp} caps={caps} pending={pending.length} onOpen={() => setSettings(true)} />
      </header>
      <SettingsSheet open={settings} onClose={() => setSettings(false)} />
    </>
  );
}

function StatusStrip({
  online,
  brainUp,
  caps,
  pending,
  onOpen,
}: {
  online: boolean;
  brainUp: boolean | null;
  caps: ReturnType<typeof useApp>["caps"];
  pending: number;
  onOpen: () => void;
}) {
  const local = caps?.brain.local ?? true;
  return (
    <div className="mx-auto flex max-w-xl flex-wrap items-center gap-1.5 px-4 pb-2">
      {/* Offline is a *state*, not an error (principle 5). */}
      <button onClick={onOpen} className="chip" style={!online ? { background: "var(--pass-soft)", color: "var(--pass)" } : undefined}>
        {online ? <IconCloud width={13} height={13} /> : <IconSignalOff width={13} height={13} />}
        {online ? "Online" : "Offline · local only"}
      </button>

      <button
        onClick={onOpen}
        className="chip"
        style={
          brainUp === false
            ? { background: "var(--maybe-soft)", color: "var(--maybe)" }
            : local
              ? { background: "var(--buy-soft)", color: "var(--buy)" }
              : { background: "var(--surface-2)" }
        }
      >
        {brainUp === false ? <IconX width={13} height={13} /> : local ? <IconDevice width={13} height={13} /> : <IconCloud width={13} height={13} />}
        {brainUp === false
          ? "Brain asleep"
          : caps
            ? `${local ? "Local" : "Hosted"} · ${caps.brain.model}`
            : "Checking brain…"}
      </button>

      {caps && !caps.pricing.tabpfn && <span className="chip">heuristic pricing</span>}
      {pending > 0 && (
        <span className="chip" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>
          <IconRefresh width={13} height={13} />
          {pending} to refine
        </span>
      )}
    </div>
  );
}

export function BottomNav() {
  const { pending, items } = useApp();
  const { pathname } = useLocation();
  const queued = items.filter((i) => i.status === "bought" || i.status === "sourced").length;

  const tabs = [
    { to: "/", label: "Scan", Icon: IconCamera, badge: 0 },
    { to: "/listings", label: "Listings", Icon: IconList, badge: queued },
    { to: "/insights", label: "Insights", Icon: IconChart, badge: 0 },
  ];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur"
      style={{ borderColor: "var(--line)", background: "color-mix(in oklab, var(--bg) 90%, transparent)", paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      <ul className="mx-auto flex max-w-xl">
        {tabs.map((t) => {
          const active = t.to === "/" ? pathname === "/" : pathname.startsWith(t.to);
          return (
            <li key={t.to} className="flex-1">
              <NavLink
                to={t.to}
                className="tap relative flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold"
                style={{ color: active ? "var(--ink)" : "var(--muted)" }}
                aria-current={active ? "page" : undefined}
              >
                <span className="relative">
                  <t.Icon width={22} height={22} />
                  {t.badge > 0 && (
                    <span
                      className="price absolute -right-2 -top-1.5 rounded-full px-1 text-[10px] font-bold"
                      style={{ background: "var(--amber)", color: "var(--bg)" }}
                    >
                      {t.badge}
                    </span>
                  )}
                </span>
                {t.label}
                {active && <span className="absolute inset-x-6 top-0 h-0.5 rounded-full" style={{ background: "var(--amber)" }} />}
              </NavLink>
            </li>
          );
        })}
      </ul>
      {pending.length > 0 && <span className="sr-only">{pending.length} captures waiting to be refined</span>}
    </nav>
  );
}

export function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-rise pointer-events-auto max-w-sm rounded-xl px-4 py-2.5 text-sm shadow-lg"
          style={{
            background: t.tone === "good" ? "var(--buy)" : t.tone === "bad" ? "var(--maybe)" : "var(--ink)",
            color: t.tone === "info" ? "var(--bg)" : "var(--surface)",
          }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { caps, brainUp, checkCaps, toast, pending, retryPending, refresh } = useApp();
  const [url, setUrl] = useState(brainUrl());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (open) setUrl(brainUrl());
  }, [open]);

  const run = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    try {
      const out = await fn();
      toast(typeof out === "string" ? out : `${name} done.`, "good");
    } catch (err) {
      toast(err instanceof Error ? err.message : `${name} failed.`, "bad");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Status & settings">
      <div className="space-y-5">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Brain connection</h3>
          <p className="mb-2 text-sm text-muted">
            Sourcerer&apos;s brain runs on your own machine (Hono + Ollama + Gemma). Point the app at it
            here — the default is your laptop on the local network.
          </p>
          <div className="flex gap-2">
            <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:8787" aria-label="Brain URL" />
            <button
              className="btn btn-primary shrink-0"
              onClick={async () => {
                setBrainUrl(url);
                await checkCaps();
                toast("Brain address saved.", "good");
              }}
            >
              Save
            </button>
          </div>
          <p className="mt-2 text-xs" style={{ color: brainUp === false ? "var(--maybe)" : "var(--buy)" }}>
            {brainUp === false ? "Not reachable right now — scans will use on-device estimates." : brainUp ? "Connected." : "Checking…"}
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">What runs where</h3>
          <ul className="space-y-1.5 text-sm">
            <Row label="Identification" value={caps ? `${caps.llm[0]?.provider} · ${caps.llm[0]?.model}` : "—"} on={Boolean(caps?.llm[0]?.available)} local={Boolean(caps?.llm[0]?.local)} />
            <Row label="Hosted brain" value={caps?.llm[1]?.model ?? "Backboard"} on={Boolean(caps?.llm[1]?.available)} local={false} />
            <Row label="Live market comps" value={caps?.comps.find((c) => !c.local)?.provider ?? "SerpApi"} on={Boolean(caps?.comps.find((c) => !c.local)?.available)} local={false} />
            <Row label="Price model" value={caps?.pricing.tabpfn ? "TabPFN" : "Built-in heuristics"} on={Boolean(caps?.pricing.tabpfn)} local />
            <Row label="Tracing" value="Sentry" on={Boolean(caps?.tracing.sentry)} local={false} />
            <Row label="Voice" value="ElevenLabs" on={Boolean(caps?.voice.elevenlabs)} local={false} />
            <Row label="Vector memory" value={caps?.vector.provider ?? "pgvector"} on={Boolean(caps?.vector.pgvector)} local={false} />
            <Row label="Durable repricing" value="Temporal" on={Boolean(caps?.durable.temporal)} local />
          </ul>
          <p className="mt-2 flex items-start gap-2 rounded-lg p-2.5 text-xs" style={{ background: "var(--buy-soft)", color: "var(--buy)" }}>
            <IconShield width={16} height={16} className="mt-px shrink-0" />
            {caps?.privacy ?? "Photos and pricing run on your device. Nothing is uploaded unless you turn on live comps."}
          </p>
        </section>

        <section className="flex flex-wrap gap-2">
          <button className="btn btn-ghost" onClick={() => run("Connection check", checkCaps)} disabled={busy !== null}>
            <IconRefresh width={16} height={16} /> Recheck
          </button>
          <button
            className="btn btn-ghost"
            onClick={() =>
              run("Demo data", async () => {
                const r = await api.seed();
                await refresh();
                return `Seeded ${r.seeded} past sales.`;
              })
            }
            disabled={busy !== null || brainUp === false}
          >
            <IconSparkle width={16} height={16} /> Seed demo history
          </button>
          <button
            className="btn btn-ghost"
            onClick={() =>
              run("Training", async () => {
                const r = await api.train();
                if (r.trained) return `Price model trained on ${r.rows} sales.`;
                return r.reason ?? "Not enough data yet.";
              })
            }
            disabled={busy !== null || brainUp === false}
          >
            <IconChart width={16} height={16} /> Train price model
          </button>
          {pending.length > 0 && (
            <button className="btn btn-ghost" onClick={() => run("Refining", retryPending)} disabled={busy !== null || brainUp === false}>
              <IconRefresh width={16} height={16} /> Refine {pending.length}
            </button>
          )}
        </section>

        <section className="text-xs text-muted">
          <p>
            Sourcerer is an offline-first tool. Your captures live in this browser&apos;s storage first;
            the brain is a peer, never a gatekeeper. Built for the DEV Hacktoberfest Open-Source AI
            Challenge, Week 2 — with Gemma, Mastra, SerpApi, TabPFN, Sentry, Temporal, Tiger Data,
            ElevenLabs and Backboard.
          </p>
        </section>
      </div>
    </Sheet>
  );
}

function Row({ label, value, on, local }: { label: string; value: string; on: boolean; local: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
        style={{ background: on ? "var(--buy-soft)" : "var(--surface-2)", color: on ? "var(--buy)" : "var(--muted)" }}
      >
        {on ? <IconCheck width={12} height={12} /> : <IconX width={12} height={12} />}
      </span>
      <span className="flex-1 text-muted">{label}</span>
      <span className="truncate text-xs" style={{ color: "var(--ink-2)" }}>
        {value}
      </span>
      <span className="chip" style={{ padding: "0 0.35rem" }}>
        {local ? <IconDevice width={12} height={12} /> : <IconCloud width={12} height={12} />}
      </span>
    </li>
  );
}
