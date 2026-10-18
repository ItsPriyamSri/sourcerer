import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CapturedItem, CompsResult } from "@sourcerer/shared";
import { config } from "../env.ts";

/**
 * Local storage.
 *
 * Sourcerer is local-first, so the source of truth is a JSON file next to the
 * app and a folder of photos — not a server. That is what makes the privacy
 * claim provable instead of marketing: you can open the folder and look.
 *
 * Deliberately dumb: read the whole file, write the whole file, atomic rename so
 * a crash mid-write cannot corrupt the inventory. At a few thousand items this is
 * comfortably fast, and it has zero setup, which matters for a tool a person
 * installs on a Saturday.
 */

const dataDir = config.dataDir;
const photosDir = join(dataDir, "photos");

async function ensureDirs() {
  await mkdir(dataDir, { recursive: true });
  await mkdir(photosDir, { recursive: true });
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(join(dataDir, file), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await ensureDirs();
  const target = join(dataDir, file);
  const tmp = `${target}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, target);
}

export interface SoldRecord {
  title: string;
  category?: string;
  brand?: string;
  condition?: string;
  price: number;
  daysToSell?: number;
  compsMedian?: number;
  compsCount?: number;
  soldAt?: string;
}

export async function listItems(): Promise<CapturedItem[]> {
  const items = await readJson<CapturedItem[]>("inventory.json", []);
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getItem(id: string): Promise<CapturedItem | null> {
  const items = await readJson<CapturedItem[]>("inventory.json", []);
  return items.find((i) => i.id === id) ?? null;
}

export async function saveItem(item: CapturedItem): Promise<CapturedItem> {
  const items = await readJson<CapturedItem[]>("inventory.json", []);
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx >= 0) items[idx] = item;
  else items.unshift(item);
  await writeJson("inventory.json", items);
  return item;
}

export async function patchItem(id: string, patch: Partial<CapturedItem>): Promise<CapturedItem | null> {
  const items = await readJson<CapturedItem[]>("inventory.json", []);
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  const next = { ...items[idx]!, ...patch, id };
  items[idx] = next;
  await writeJson("inventory.json", items);
  return next;
}

export async function deleteItem(id: string): Promise<boolean> {
  const items = await readJson<CapturedItem[]>("inventory.json", []);
  const next = items.filter((i) => i.id !== id);
  await writeJson("inventory.json", next);
  return next.length !== items.length;
}

/** Sold items, used as TabPFN training rows AND as offline comps. */
export async function soldHistory(): Promise<SoldRecord[]> {
  return readJson<SoldRecord[]>("sold.json", []);
}

export async function recordSold(record: SoldRecord): Promise<void> {
  const rows = await readJson<SoldRecord[]>("sold.json", []);
  rows.push({ ...record, soldAt: record.soldAt ?? new Date().toISOString() });
  await writeJson("sold.json", rows);
}

/**
 * Wipe the local data and start over from the committed fixture.
 *
 * This exists so the demo is reproducible: `POST /demo/seed?reset=1` always leaves
 * exactly the sample dataset, which is what makes the numbers in the README and the
 * evidence directory mean the same thing on your machine as they do on mine.
 */
export async function clearLocalData(): Promise<void> {
  await writeJson("inventory.json", []);
  await writeJson("sold.json", []);
}

/** Persist a captured photo locally. Returns the path. */
export async function savePhoto(id: string, bytes: Buffer): Promise<string> {
  await ensureDirs();
  const p = join(photosDir, `${id}.jpg`);
  await writeFile(p, bytes);
  return p;
}

export function photoExists(path: string): boolean {
  return existsSync(path);
}

// ── comps cache ────────────────────────────────────────────────────────────
export function restoreCompsCache(): Record<string, { at: number; result: CompsResult }> {
  try {
    const p = join(dataDir, "comps-cache.json");
    if (!existsSync(p)) return {};
    // Synchronous read is fine: this runs once at boot for a small file.
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

let compsCacheWriteTimer: NodeJS.Timeout | null = null;
export function persistCompsCache(key: string, entry: { at: number; result: CompsResult }): void {
  // Debounced: a burst of scans should not cause a burst of disk writes.
  if (compsCacheWriteTimer) clearTimeout(compsCacheWriteTimer);
  compsCacheWriteTimer = setTimeout(async () => {
    const current = restoreCompsCache();
    current[key] = entry;
    // Keep the cache bounded.
    const entries = Object.entries(current).sort((a, b) => b[1].at - a[1].at).slice(0, 500);
    await writeJson("comps-cache.json", Object.fromEntries(entries));
  }, 500);
}
