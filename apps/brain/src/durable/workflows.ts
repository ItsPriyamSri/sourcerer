import { defineQuery, proxyActivities, setHandler } from "@temporalio/workflow";
import type * as activities from "./activities.ts";

/**
 * Nightly reprice.
 *
 * Prices drift. A jacket you bought in March is worth something different in June,
 * and a reseller with 200 items cannot re-check all of them by hand. This workflow
 * walks the inventory, refreshes market data for each item, and — because Temporal
 * persists every step to its event history — survives a laptop sleeping, a network
 * drop, or the process dying, resuming at the next item instead of starting over.
 *
 * Per-item failure is contained: one dead search does not kill the run.
 */

const { refreshComps, applyReprice } = proxyActivities<typeof activities>({
  startToCloseTimeout: "2 minutes",
  retry: {
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
    maximumAttempts: 4,
    nonRetryableErrorTypes: ["ItemMissing", "Cancelled"],
  },
});

export interface RepriceInput {
  items: string[];
}

export interface RepriceProgress {
  total: number;
  done: number;
  failed: string[];
  lastTitle?: string;
}

export const getProgress = defineQuery<RepriceProgress>("getProgress");

export async function repriceInventory(input: RepriceInput): Promise<RepriceProgress> {
  const progress: RepriceProgress = { total: input.items.length, done: 0, failed: [] };
  setHandler(getProgress, () => progress);

  for (const itemId of input.items) {
    try {
      const result = await refreshComps(itemId);
      await applyReprice(result);
      progress.lastTitle = result.title;
    } catch {
      progress.failed.push(itemId);
    }
    progress.done++;
  }

  return progress;
}
