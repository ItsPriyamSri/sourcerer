import { defineQuery, proxyActivities, setHandler, sleep } from "@temporalio/workflow";
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
  /**
   * Milliseconds to pause between items.
   *
   * A 200-item sweep against a paid search API will happily get you rate-limited, so
   * the pause is a real feature rather than a demo trick. It also happens to make the
   * durability of this loop observable: there is a window in which you can kill the
   * worker and watch the run pick up where it stopped.
   */
  paceMs?: number;
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
    if (input.paceMs) await sleep(input.paceMs);
  }

  return progress;
}
