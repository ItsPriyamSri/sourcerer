import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CapturedItem, Capabilities, CostModel, ScanRequest, ScanResult } from "@sourcerer/shared";
import { api, brainUrl, scanStream, BrainError } from "./api.ts";
import { localDb, loadCost, saveCost, type PendingCapture } from "./db.ts";
import { runOfflineScan } from "./offline.ts";

export type Caps = Capabilities & { brain: { provider: string; model: string; local: boolean } };

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "good" | "bad";
}

interface AppState {
  ready: boolean;
  online: boolean;
  brainUp: boolean | null;
  caps: Caps | null;
  items: CapturedItem[];
  pending: PendingCapture[];
  cost: Partial<CostModel>;
  toasts: Toast[];
  setCost: (c: Partial<CostModel>) => void;
  refresh: () => Promise<void>;
  saveScan: (result: ScanResult, request: ScanRequest) => Promise<void>;
  updateItem: (id: string, patch: Partial<CapturedItem>) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  markSold: (id: string, soldFor: number, daysToSell?: number) => Promise<void>;
  retryPending: () => Promise<void>;
  toast: (text: string, tone?: Toast["tone"]) => void;
  checkCaps: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}

/** Haptic whisper on a verdict reveal, where the platform allows it. */
export function haptic(ms = 12) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [brainUp, setBrainUp] = useState<boolean | null>(null);
  const [caps, setCaps] = useState<Caps | null>(null);
  const [items, setItems] = useState<CapturedItem[]>([]);
  const [pending, setPending] = useState<PendingCapture[]>([]);
  const [cost, setCostState] = useState<Partial<CostModel>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const refresh = useCallback(async () => {
    setItems(await localDb.allItems());
    setPending(await localDb.queue());
  }, []);

  const checkCaps = useCallback(async () => {
    try {
      const c = await api.capabilities();
      setCaps(c);
      setBrainUp(true);
    } catch {
      setBrainUp(false);
      setCaps(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setCostState(await loadCost());
      await refresh();
      await checkCaps();
      setReady(true);
    })();
  }, [refresh, checkCaps]);

  useEffect(() => {
    const on = () => {
      setOnline(true);
      void checkCaps();
    };
    const off = () => setOnline(false);
    addEventListener("online", on);
    addEventListener("offline", off);
    return () => {
      removeEventListener("online", on);
      removeEventListener("offline", off);
    };
  }, [checkCaps]);

  const setCost = useCallback((c: Partial<CostModel>) => {
    setCostState(c);
    void saveCost(c);
  }, []);

  const saveScan = useCallback(
    async (result: ScanResult, request: ScanRequest) => {
      const item: CapturedItem = {
        id: result.id,
        createdAt: result.createdAt,
        source: request.image ? "camera" : request.text ? "manual" : "manual",
        identification: result.identification,
        comps: result.comps,
        price: result.price,
        verdict: result.verdict,
        cost: result.cost,
        buyPrice: request.buyPrice,
        status: "sourced",
        thumbnail: request.image?.startsWith("data:") ? request.image : undefined,
      };
      await localDb.putItem(item);
      await refresh();

      // Mirror to the brain so its agents and vector store can see it. Best effort.
      try {
        await api.saveItem(item);
        if (request.image) void api.patchItem(item.id, { imagePath: item.imagePath });
      } catch {
        /* local copy is the source of truth; the brain will catch up */
      }
    },
    [refresh],
  );

  const updateItem = useCallback(
    async (id: string, patch: Partial<CapturedItem>) => {
      await localDb.patchItem(id, patch);
      await refresh();
      try {
        await api.patchItem(id, patch);
      } catch {
        /* offline: local state already updated */
      }
    },
    [refresh],
  );

  const removeItem = useCallback(
    async (id: string) => {
      await localDb.deleteItem(id);
      await refresh();
      try {
        await api.deleteItem(id);
      } catch {
        /* ignore */
      }
    },
    [refresh],
  );

  const markSold = useCallback(
    async (id: string, soldFor: number, daysToSell?: number) => {
      await localDb.patchItem(id, { status: "sold", soldFor, soldAt: new Date().toISOString() });
      await refresh();
      try {
        await api.markSold(id, soldFor, daysToSell);
        toast(`Logged ${soldFor ? "$" + Math.round(soldFor) : "sale"} — your price model just got smarter.`, "good");
      } catch {
        toast("Saved on this device. It will sync when you're back online.", "info");
      }
    },
    [refresh, toast],
  );

  /**
   * Re-run queued offline captures against the brain once it is reachable, so an
   * estimate made in a basement quietly becomes a real comps-backed price later.
   */
  const retryPending = useCallback(async () => {
    if (brainUp !== true) return;
    const q = await localDb.queue();
    if (q.length === 0) return;
    let upgraded = 0;
    for (const entry of q) {
      try {
        const result = await scanStream(entry.request, () => {});
        await localDb.putItem({
          ...(await localDb.getItem(entry.id))!,
          comps: result.comps,
          price: result.price,
          verdict: result.verdict,
          identification: result.identification,
          cost: result.cost,
        });
        await localDb.dequeue(entry.id);
        upgraded++;
      } catch (err) {
        await localDb.enqueue({
          ...entry,
          attempts: entry.attempts + 1,
          lastError: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (upgraded) {
      toast(`Refined ${upgraded} offline capture${upgraded === 1 ? "" : "s"} with live comps.`, "good");
      await refresh();
    }
  }, [brainUp, refresh, toast]);

  useEffect(() => {
    if (ready && brainUp && pending.length > 0) void retryPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, brainUp, pending.length]);

  const value = useMemo<AppState>(
    () => ({
      ready,
      online,
      brainUp,
      caps,
      items,
      pending,
      cost,
      toasts,
      setCost,
      refresh,
      saveScan,
      updateItem,
      removeItem,
      markSold,
      retryPending,
      toast,
      checkCaps,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, online, brainUp, caps, items, pending, cost, toasts, setCost, refresh, saveScan, updateItem, removeItem, markSold, retryPending, toast, checkCaps],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Run a scan with the best available brain, and *never* fail the user.
 *
 * Precedence:  live brain (local Gemma or Backboard)  →  on-device heuristics.
 * If the live path fails we keep the capture in the queue so the estimate can be
 * upgraded later — the capture is never lost and the user is never blocked.
 */
export async function smartScan(
  request: ScanRequest,
  onStage: (s: import("@sourcerer/shared").ScanStage) => void,
  history: CapturedItem[],
): Promise<{ result: ScanResult; usedBrain: boolean; error?: string }> {
  try {
    const result = await scanStream(request, onStage);
    return { result, usedBrain: true };
  } catch (err) {
    const message = err instanceof BrainError ? err.message : String(err);
    // Mark the identification the browser produced so the queue can upgrade it.
    await localDb.enqueue({
      id: `pend-${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      request,
      attempts: 1,
      lastError: message,
    });
    const result = runOfflineScan({ ...request, history }, onStage);
    return { result, usedBrain: false, error: message };
  }
}

export { brainUrl, BrainError };
