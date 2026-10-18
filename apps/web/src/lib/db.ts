import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { CapturedItem, CostModel, ScanRequest } from "@sourcerer/shared";

/**
 * Local-first storage.
 *
 * The app owns its data on the device: every capture lands in IndexedDB *before* it
 * is ever sent anywhere, so a scan is never lost to a dead connection (and the user
 * can prove it, because it is their own browser storage). The brain's `/inventory`
 * is a peer, not the source of truth for the capture queue.
 */

export interface PendingCapture {
  id: string;
  createdAt: string;
  request: ScanRequest;
  /** Set once the brain has accepted it (kept for dedupe). */
  syncedItemId?: string;
  attempts: number;
  lastError?: string;
}

interface SourcererDB extends DBSchema {
  items: { key: string; value: CapturedItem; indexes: { createdAt: string; status: string } };
  queue: { key: string; value: PendingCapture; indexes: { createdAt: string } };
  kv: { key: string; value: unknown };
}

let dbp: Promise<IDBPDatabase<SourcererDB>> | null = null;

function db(): Promise<IDBPDatabase<SourcererDB>> {
  dbp ??= openDB<SourcererDB>("sourcerer", 1, {
    upgrade(d) {
      const items = d.createObjectStore("items", { keyPath: "id" });
      items.createIndex("createdAt", "createdAt");
      items.createIndex("status", "status");
      const queue = d.createObjectStore("queue", { keyPath: "id" });
      queue.createIndex("createdAt", "createdAt");
      d.createObjectStore("kv");
    },
  });
  return dbp;
}

export const localDb = {
  async putItem(item: CapturedItem) {
    await (await db()).put("items", item);
  },
  async patchItem(id: string, patch: Partial<CapturedItem>) {
    const d = await db();
    const existing = await d.get("items", id);
    if (!existing) return;
    await d.put("items", { ...existing, ...patch });
  },
  async getItem(id: string) {
    return (await db()).get("items", id);
  },
  async allItems(): Promise<CapturedItem[]> {
    const items = await (await db()).getAllFromIndex("items", "createdAt");
    return items.reverse();
  },
  async deleteItem(id: string) {
    await (await db()).delete("items", id);
  },

  async enqueue(c: PendingCapture) {
    await (await db()).put("queue", c);
  },
  async queue(): Promise<PendingCapture[]> {
    return (await db()).getAllFromIndex("queue", "createdAt");
  },
  async dequeue(id: string) {
    await (await db()).delete("queue", id);
  },

  async get<T>(key: string, fallback: T): Promise<T> {
    const v = await (await db()).get("kv", key);
    return (v as T) ?? fallback;
  },
  async set(key: string, value: unknown) {
    await (await db()).put("kv", value, key);
  },
};

/** The user's cost model, remembered across sessions. */
export async function loadCost(): Promise<Partial<CostModel>> {
  return localDb.get<Partial<CostModel>>("cost", {});
}
export async function saveCost(cost: Partial<CostModel>) {
  await localDb.set("cost", cost);
}
