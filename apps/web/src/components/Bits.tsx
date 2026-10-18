import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconChevron, IconX } from "./Icons.tsx";

/** Small, unopinionated UI primitives used across the three screens. */

export function Sheet({
  open,
  onClose,
  title,
  children,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    // Focus the sheet so keyboard and screen-reader users land inside it.
    const t = setTimeout(() => ref.current?.focus(), 30);
    document.body.style.overflow = "hidden";
    return () => {
      removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        aria-label="Close"
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className="animate-rise relative w-full max-w-xl rounded-t-2xl sm:rounded-2xl outline-none"
        style={{ background: "var(--surface)", border: "1px solid var(--line)" }}
      >
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--line)" }}>
          <h2 className="display text-lg font-semibold">{title}</h2>
          <button className="btn btn-ghost !min-h-0 !px-2 !py-1" onClick={onClose} aria-label="Close">
            <IconX width={18} height={18} />
          </button>
        </header>
        <div className="max-h-[75vh] overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  hint,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  hint?: string;
}) {
  return (
    <details open={defaultOpen} className="group rounded-xl border" style={{ borderColor: "var(--line)" }}>
      <summary className="tap flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold">
        <span className="flex items-center gap-2">
          <IconChevron className="transition-transform group-open:rotate-90" width={16} height={16} />
          {summary}
        </span>
        {hint && <span className="meta font-normal">{hint}</span>}
      </summary>
      <div className="border-t px-3 py-3 text-sm" style={{ borderColor: "var(--line)" }}>
        {children}
      </div>
    </details>
  );
}

/**
 * The announcement channel.
 *
 * Why this exists: a live region only announces content that *arrives* while it is
 * already on screen. The verdict banner is mounted with its text already inside it,
 * so a screen reader would hear nothing when the answer lands. This node is mounted
 * once per screen and its message is updated *after* the result arrives, so the
 * decision is spoken the moment it exists. `aria-atomic` keeps it to one clean
 * sentence instead of a stream of fragments.
 */
export function Announcer({ message }: { message: string }) {
  return (
    <div className="sr-only-text" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}

/** A genre shift: a small label over a hairline. Separates decision → math → fine print. */
export function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3 border-t pt-3" style={{ borderColor: "var(--line)" }}>
      <h3 className="kicker">{title}</h3>
      {hint && <span className="meta">{hint}</span>}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </span>
      {children(id)}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="tap w-full rounded-xl border px-3 text-base outline-none"
      style={{ borderColor: "var(--line-strong)", background: "var(--surface)", color: "var(--ink)" }}
    />
  );
}

export function MoneyInput({
  value,
  onChange,
  ...rest
}: { value: number; onChange: (n: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <div
      className="tap flex items-center gap-1 rounded-xl border px-3"
      style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}
    >
      <span className="price text-muted">$</span>
      <input
        {...rest}
        inputMode="decimal"
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="price w-full bg-transparent py-2 text-base outline-none"
        style={{ color: "var(--ink)" }}
      />
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">) {
  return (
    <select
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="tap w-full rounded-xl border px-3 text-base outline-none"
      style={{ borderColor: "var(--line-strong)", background: "var(--surface)", color: "var(--ink)" }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="card mx-auto mt-6 max-w-md px-6 py-10 text-center">
      <div
        className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: "var(--surface-2)", color: "var(--amber)" }}
      >
        {icon}
      </div>
      <h3 className="display text-lg font-semibold">{title}</h3>
      {/* Cap the measure: an empty-state sentence spread across a 1152px desktop card
          is unreadable even though it is only one line. */}
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl ${className}`}
      style={{ background: "var(--surface-2)" }}
      aria-hidden="true"
    >
      <div className="animate-sweep absolute inset-y-0 w-1/3" style={{ background: "linear-gradient(90deg,transparent,color-mix(in oklab,var(--amber) 25%,transparent),transparent)" }} />
    </div>
  );
}

/** A tiny inline bar used for price ranges and margin trends. */
export function RangeBar({ low, mid, high, marker }: { low: number; mid: number; high: number; marker?: number }) {
  const span = Math.max(1, high - low);
  const pos = (v: number) => Math.min(100, Math.max(0, ((v - low) / span) * 100));
  return (
    <div className="relative h-2 w-full rounded-full" style={{ background: "var(--surface-2)" }} aria-hidden="true">
      <div className="absolute inset-y-0 rounded-full" style={{ left: `${pos(low)}%`, width: `${Math.max(2, pos(high) - pos(low))}%`, background: "color-mix(in oklab, var(--buy) 35%, transparent)" }} />
      <div className="absolute -top-1 h-4 w-1 rounded" style={{ left: `calc(${pos(mid)}% - 2px)`, background: "var(--ink)" }} />
      {marker !== undefined && (
        <div className="absolute -top-1.5 h-5 w-0.5 rounded" style={{ left: `calc(${pos(marker)}% - 1px)`, background: "var(--amber)" }} />
      )}
    </div>
  );
}
