import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  formatMoney,
  formatMultiple,
  type CapturedItem,
  type ListingDraft,
} from "@sourcerer/shared";
import { api } from "../lib/api.ts";
import { downloadText, itemsToCsv, listingToText } from "../lib/format.ts";
import { useApp } from "../lib/store.tsx";
import { Shell } from "../components/Shell.tsx";
import { Announcer, Disclosure, EmptyState, MoneyInput, Sheet } from "../components/Bits.tsx";
import { VerdictPill } from "../components/VerdictCard.tsx";
import {
  IconCheck,
  IconCopy,
  IconList,
  IconSearch,
  IconShare,
  IconSparkle,
  IconTag,
  IconTrash,
} from "../components/Icons.tsx";

type Tab = "queue" | "sold";

/**
 * Listings — the "11pm typing grind" killer.
 *
 * Everything captured is here, local-first: you can generate drafts with no network,
 * copy them, export the lot to a spreadsheet, and log sales so the local price model
 * keeps learning.
 */
export default function ListingsPage() {
  const { items, updateItem, removeItem, markSold, toast, brainUp } = useApp();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("queue");
  const [query, setQuery] = useState("");
  const [busyAll, setBusyAll] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [sellFor, setSellFor] = useState<CapturedItem | null>(null);
  const [sellPrice, setSellPrice] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      const matches = !q || `${i.identification.title} ${i.identification.brand ?? ""} ${i.identification.category}`.toLowerCase().includes(q);
      if (!matches) return false;
      if (tab === "sold") return i.status === "sold";
      return i.status === "sourced" || i.status === "bought" || i.status === "listed";
    });
  }, [items, query, tab]);

  const queueCount = items.filter((i) => i.status !== "sold" && i.status !== "passed").length;
  const soldCount = items.filter((i) => i.status === "sold").length;

  /*
    The two numbers a reseller managing a queue actually steers by: cash already tied
    up in stock (which is at risk) and the profit it is expected to return. Both are
    shown as an expected value, never as cash — the profit line says so in words.
  */
  const held = items.filter((i) => i.status === "sourced" || i.status === "bought" || i.status === "listed");
  const capital = held.reduce((s, i) => s + (i.buyPrice ?? 0), 0);
  const expectedProfit = held.reduce((s, i) => s + i.verdict.economics.expectedProfit, 0);

  const applyListing = async (item: CapturedItem): Promise<ListingDraft | null> => {
    try {
      const { listing } = await api.listing({
        identification: item.identification,
        price: item.price,
        comps: item.comps,
        cost: item.cost,
        itemId: item.id,
      });
      await updateItem(item.id, { listing });
      return listing;
    } catch {
      return null;
    }
  };

  const generateAll = async () => {
    const targets = filtered.filter((i) => !i.listing);
    if (targets.length === 0) {
      toast("Every item here already has a draft.", "info");
      return;
    }
    setBusyAll(true);
    setProgress({ done: 0, total: targets.length });
    let ok = 0;
    for (const [i, item] of targets.entries()) {
      const draft = await applyListing(item);
      if (draft) {
        ok++;
        // Copy the freshest draft to the clipboard as we go — a reseller pasting one
        // at a time is the real workflow.
        if (i === 0) void navigator.clipboard.writeText(listingToText(draft)).catch(() => {});
      }
      setProgress({ done: i + 1, total: targets.length });
    }
    setBusyAll(false);
    setProgress(null);
    toast(
      ok === targets.length
        ? `${ok} draft${ok === 1 ? "" : "s"} written. The first is on your clipboard.`
        : `${ok} of ${targets.length} written — start your brain for the rest.`,
      ok ? "good" : "bad",
    );
  };

  return (
    <Shell>
      <Announcer message={busyAll ? `Writing listing drafts, ${progress?.done ?? 0} of ${progress?.total ?? 0} done.` : ""} />

      <header className="mb-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="display text-2xl font-bold">Listings</h1>
            <p className="meta">
              {queueCount} waiting · {soldCount} sold
            </p>
          </div>
          <button
            className="btn btn-ghost text-xs"
            onClick={() => downloadText(`sourcerer-${new Date().toISOString().slice(0, 10)}.csv`, itemsToCsv(items))}
          >
            Export CSV
          </button>
        </div>

        {/* The queue as a position, not just a pile. */}
        {held.length > 0 && (
          <dl className="mt-3 grid grid-cols-3 gap-3 border-t pt-3" style={{ borderColor: "var(--line)" }}>
            <div>
              <dt className="kicker">Holding</dt>
              <dd className="price text-lg font-bold">{held.length}</dd>
            </div>
            <div>
              <dt className="kicker">Capital in it</dt>
              <dd className="price text-lg font-bold">{formatMoney(capital)}</dd>
            </div>
            <div>
              <dt className="kicker">Expected profit</dt>
              <dd className="price text-lg font-bold">{formatMoney(expectedProfit)}</dd>
              <dd className="meta">if it all sells at target</dd>
            </div>
          </dl>
        )}
      </header>

      <div className="mb-3 flex gap-2">
        {/*
          A real tab pair: each tab declares the panel it controls and the panel names the
          tab that labels it, so screen readers hear "Queue, tab, selected" rather than an
          unlabelled pair of buttons.
        */}
        <div className="flex flex-1 rounded-xl p-1 lg:max-w-xs" style={{ background: "var(--surface-2)" }} role="tablist" aria-label="Queue or sold">
          {(["queue", "sold"] as Tab[]).map((t) => (
            <button
              key={t}
              id={`listings-tab-${t}`}
              role="tab"
              aria-selected={tab === t}
              aria-controls="listings-panel"
              tabIndex={tab === t ? 0 : -1}
              className="tap flex-1 rounded-lg text-sm font-semibold capitalize"
              style={tab === t ? { background: "var(--surface)", color: "var(--ink)" } : { color: "var(--muted)" }}
              onClick={() => setTab(t)}
            >
              {t}
              <span className="sr-only-text"> listings</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2 rounded-xl border px-3" style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}>
        <IconSearch width={18} height={18} className="text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name, brand, category"
          className="tap w-full bg-transparent text-base outline-none"
          aria-label="Filter listings"
        />
      </div>

      {filtered.length > 0 && (
        <button className="btn btn-primary mb-3 w-full lg:max-w-md" onClick={() => void generateAll()} disabled={busyAll || brainUp === false}>
          <IconSparkle width={18} height={18} />
          {busyAll
            ? `Writing ${progress?.done ?? 0}/${progress?.total ?? 0}…`
            : brainUp === false
              ? "Start your brain to write listings"
              : `Generate drafts for ${filtered.filter((i) => !i.listing).length || "all"}`}
        </button>
      )}

      <div id="listings-panel" role="tabpanel" aria-labelledby={`listings-tab-${tab}`}>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<IconList />}
            title={tab === "sold" ? "No sales logged yet" : query ? "Nothing matches that" : "Your queue is empty"}
            body={
              tab === "sold"
                ? "Log a sale and Sourcerer learns what your market actually pays. That's the data no cloud service has."
                : query
                  ? "No item in your queue matches that filter."
                  : "Scan something on the Scan tab and it will land here, priced and ready to list."
            }
            action={
              tab === "sold" ? (
                <button className="btn btn-ghost" onClick={() => setTab("queue")}>
                  Back to the queue
                </button>
              ) : query ? (
                <button className="btn btn-ghost" onClick={() => setQuery("")}>
                  Clear the filter
                </button>
              ) : (
                <button className="btn btn-ghost" onClick={() => navigate("/")}>
                  <IconTag width={16} height={16} /> Scan your first item
                </button>
              )
            }
          />
        ) : (
          <ul className="space-y-3">
            {filtered.map((item) => (
              <ListingRow
                key={item.id}
                item={item}
                onGenerate={() => void applyListing(item)}
                onDelete={() => void removeItem(item.id)}
                onToggleListed={() => void updateItem(item.id, { status: item.status === "listed" ? "bought" : "listed" })}
                onSell={() => {
                  setSellFor(item);
                  setSellPrice(item.price.expected);
                }}
              />
            ))}
          </ul>
        )}
      </div>

      <Sheet open={Boolean(sellFor)} onClose={() => setSellFor(null)} title="Log this sale">
        {sellFor && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              {sellFor.identification.title} — expected {formatMoney(sellFor.price.expected)}.
            </p>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">What it sold for</span>
              <MoneyInput value={sellPrice} onChange={setSellPrice} autoFocus />
            </label>
            <button
              className="btn btn-primary w-full"
              onClick={() => {
                void markSold(sellFor.id, sellPrice, undefined);
                setSellFor(null);
              }}
            >
              <IconCheck width={18} height={18} /> Log sale
            </button>
            <p className="text-xs text-muted">
              This is the training signal for your own price model. The more you log, the less
              Sourcerer needs the internet to be right.
            </p>
          </div>
        )}
      </Sheet>
    </Shell>
  );
}

function ListingRow({
  item,
  onGenerate,
  onDelete,
  onToggleListed,
  onSell,
}: {
  item: CapturedItem;
  onGenerate: () => void;
  onDelete: () => void;
  onToggleListed: () => void;
  onSell: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const text = item.listing ? listingToText(item.listing) : "";
  const isSold = item.status === "sold";
  const realised = isSold && item.soldFor != null ? item.soldFor - (item.buyPrice ?? 0) : null;

  return (
    <li className="card p-3">
      <div className="flex gap-3">
        {item.thumbnail ? (
          <img src={item.thumbnail} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
        ) : (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--surface-2)" }}>
            <IconTag width={20} height={20} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{item.identification.title}</p>
          <p className="meta mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <VerdictPill verdict={item.verdict} />
            {/* A sold row answers a different question from a queued one: what it made,
                not what it should. Never show the expectation and the result as one line. */}
            {realised !== null ? (
              <>
                <span className="price">sold {formatMoney(item.soldFor ?? 0)}</span>
                <span className="price font-semibold" style={{ color: realised >= 0 ? "var(--buy)" : "var(--maybe)" }}>
                  {realised >= 0 ? "+" : ""}
                  {formatMoney(realised)}
                </span>
              </>
            ) : (
              <>
                <span className="price">max {formatMoney(item.verdict.maxOffer)}</span>
                <span className="price">resale {formatMoney(item.price.expected)}</span>
                {/* No "·" separators: as separate spans they stranded a lone middot on
                    its own wrapped line at 390px. Gap spacing separates them instead. */}
                <span className="price">{formatMultiple(item.verdict.economics.multiple)}</span>
              </>
            )}
            {item.status === "listed" && (
              <span className="chip" style={{ padding: "0 0.4rem" }}>
                listed
              </span>
            )}
          </p>
        </div>
      </div>

      {item.listing && (
        <Disclosure summary={item.listing.title} hint={`${formatMoney(item.listing.price)}`}>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs" style={{ color: "var(--ink-2)" }}>
            {text}
          </pre>
        </Disclosure>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!item.listing && !isSold && (
          <button className="btn btn-ghost text-xs" onClick={onGenerate}>
            <IconSparkle width={15} height={15} /> Write draft
          </button>
        )}
        {item.listing && (
          <button
            className="btn btn-ghost text-xs"
            onClick={async () => {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <IconCheck width={15} height={15} /> : <IconCopy width={15} height={15} />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
        {item.listing && (
          <button
            className="btn btn-ghost text-xs"
            onClick={async () => {
              try {
                if (navigator.share) await navigator.share({ title: item.identification.title, text });
                else await navigator.clipboard.writeText(text);
              } catch {
                /* cancelled */
              }
            }}
          >
            <IconShare width={15} height={15} /> Share
          </button>
        )}
        {!isSold && (
          <button className="btn btn-ghost text-xs" onClick={onToggleListed}>
            {item.status === "listed" ? "Un-list" : "Mark listed"}
          </button>
        )}
        {!isSold && (
          <button className="btn btn-ghost text-xs" onClick={onSell}>
            <IconCheck width={15} height={15} /> Sold
          </button>
        )}
        <button className="btn btn-ghost text-xs ml-auto" onClick={onDelete} aria-label={`Delete ${item.identification.title}`}>
          <IconTrash width={15} height={15} />
        </button>
      </div>
    </li>
  );
}
