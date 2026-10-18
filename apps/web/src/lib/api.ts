import type {
  CapturedItem,
  Capabilities,
  CostModel,
  Identification,
  ListingDraft,
  ScanRequest,
  ScanResult,
  ScanStage,
} from "@sourcerer/shared";

/**
 * Client for the Sourcerer brain.
 *
 * The brain is intentionally a *separate process on your own machine* (Hono + Ollama).
 * `baseUrl` is therefore configurable at runtime from Settings, so the same static
 * build can talk to 127.0.0.1 during a thrift-store run and to a hosted instance
 * during a demo. Nothing here assumes the internet exists.
 */

const LS_BRAIN = "sourcerer.brainUrl";

export function brainUrl(): string {
  try {
    const stored = localStorage.getItem(LS_BRAIN);
    if (stored) return stored.replace(/\/$/, "");
  } catch {
    /* private mode */
  }
  const fromEnv = import.meta.env.VITE_BRAIN_URL as string | undefined;
  return (fromEnv || "http://127.0.0.1:8787").replace(/\/$/, "");
}

export function setBrainUrl(url: string): void {
  try {
    if (url) localStorage.setItem(LS_BRAIN, url.replace(/\/$/, ""));
    else localStorage.removeItem(LS_BRAIN);
  } catch {
    /* ignore */
  }
}

export class BrainError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly unreachable = false,
  ) {
    super(message);
    this.name = "BrainError";
  }
}

async function req<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = 120_000, ...rest } = init ?? {};
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${brainUrl()}${path}`, {
      ...rest,
      signal: ctrl.signal,
      headers: { "content-type": "application/json", ...(rest.headers ?? {}) },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as Record<string, unknown>);
      throw new BrainError(
        (body as { error?: string }).error ?? `brain responded ${res.status}`,
        res.status,
      );
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof BrainError) throw err;
    if ((err as Error)?.name === "AbortError")
      throw new BrainError("The local brain took too long to answer.", undefined, true);
    throw new BrainError(
      "Can't reach your Sourcerer brain. It runs on your own machine — start it, then try again.",
      undefined,
      true,
    );
  } finally {
    clearTimeout(t);
  }
}

export const api = {
  health: () => req<{ ok: boolean; ts: string; tracing: boolean }>("/health", { timeoutMs: 4000 }),

  capabilities: () => req<Capabilities & { brain: { provider: string; model: string; local: boolean } }>("/capabilities", { timeoutMs: 6000 }),

  inventory: () => req<{ items: CapturedItem[] }>("/inventory"),

  saveItem: (item: CapturedItem) =>
    req<{ ok: boolean }>("/inventory", { method: "POST", body: JSON.stringify(item) }),

  patchItem: (id: string, patch: Partial<CapturedItem>) =>
    req<CapturedItem>(`/inventory/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  deleteItem: (id: string) => req<{ ok: boolean }>(`/inventory/${id}`, { method: "DELETE" }),

  markSold: (id: string, soldFor: number, daysToSell?: number) =>
    req<{ ok: boolean }>(`/inventory/${id}/sold`, {
      method: "POST",
      body: JSON.stringify({ soldFor, daysToSell }),
    }),

  insights: () =>
    req<{
      itemCount: number;
      spent: number;
      soldCount: number;
      revenue: number;
      realisedProfit: number;
      unrealisedProfit: number;
      sellThrough: number;
    }>("/insights"),

  similar: (q: string, limit = 5) =>
    req<{ items: { id: string; title: string; soldFor?: number; score?: number }[] }>(
      `/similar?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),

  listing: (body: {
    identification: Identification;
    price: unknown;
    comps: unknown;
    cost?: Partial<CostModel>;
    itemId?: string;
  }) => req<{ listing: ListingDraft; ran: { provider: string; locality: string; ms: number }[] }>("/listing", {
    method: "POST",
    body: JSON.stringify(body),
    timeoutMs: 180_000,
  }),

  advisor: (message: string, threadId?: string, scan?: unknown) =>
    req<{ text: string; degraded?: boolean }>("/advisor", {
      method: "POST",
      body: JSON.stringify({ message, threadId, scan }),
      timeoutMs: 180_000,
    }),

  train: () =>
    req<{ trained: boolean; rows: number; reason?: string; fallback?: string }>("/train", {
      method: "POST",
      body: "{}",
      timeoutMs: 180_000,
    }),

  seed: () => req<{ ok: boolean; seeded: number; note: string }>("/demo/seed", { method: "POST", body: "{}" }),

  reprice: () => req<{ started: boolean; reason?: string; hint?: string }>("/reprice", { method: "POST", body: "{}", timeoutMs: 20_000 }),

  speakUrl: () => `${brainUrl()}/speak`,
};

/**
 * Streamed scan.
 *
 * We do our own SSE parsing over `fetch` rather than `EventSource` because the scan
 * carries an image body. Stages arrive as the pipeline runs so the UI can show real
 * progress instead of a spinner (design principle 1: never a blank spinner).
 */
export async function scanStream(
  body: ScanRequest,
  onStage: (s: ScanStage) => void,
  signal?: AbortSignal,
): Promise<ScanResult> {
  const res = await fetch(`${brainUrl()}/scan`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  }).catch(() => {
    throw new BrainError("Can't reach your Sourcerer brain.", undefined, true);
  });

  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => ({}));
    throw new BrainError((detail as { error?: string }).error ?? `brain responded ${res.status}`, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: ScanResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const dataLine = /^data: (.*)$/m.exec(frame)?.[1];
      if (!dataLine) continue;
      const data = JSON.parse(dataLine);
      if (event === "stage") onStage(data as ScanStage);
      else if (event === "result") result = data as ScanResult;
      else if (event === "error") throw new BrainError(data.message ?? "scan failed");
    }
  }

  if (!result) throw new BrainError("The scan finished without a result.");
  return result;
}
