import { ApplicationFailure, Context } from "@temporalio/activity";
import type { CompsResult, Identification } from "@sourcerer/shared";
import { findComps } from "../core/steps.ts";
import { getItem, patchItem } from "../core/store.ts";

/**
 * Activities do all the I/O and all the nondeterminism. Workflows only orchestrate.
 *
 * That split is not ceremony: it is what lets Temporal replay a crashed run and
 * resume at the exact item it was refreshing, without re-calling a paid search API.
 */

export interface RefreshResult {
  itemId: string;
  title: string;
  median: number;
  count: number;
}

/** Refresh market data for one inventory item. Retried with backoff by the workflow. */
export async function refreshComps(itemId: string): Promise<RefreshResult> {
  const item = await getItem(itemId);
  if (!item) {
    // Nothing to retry — the item is gone. Fail fast and non-retryably.
    throw ApplicationFailure.nonRetryable(`item ${itemId} not found`, "ItemMissing");
  }

  const identification: Identification = item.identification;
  // Respect cancellation so a terminated workflow stops spending API quota.
  if (Context.current().cancellationSignal.aborted) {
    throw ApplicationFailure.nonRetryable("cancelled", "Cancelled");
  }

  const { comps } = await findComps({ identification, offline: false });
  if (!comps.summary || comps.summary.count === 0) {
    throw ApplicationFailure.create({ message: `no comps for ${itemId}`, type: "NoComps" });
  }

  // One line per item, so the worker's log is itself a record of how much work the
  // crash cost you. After a restart it should contain only the items that were still
  // outstanding — completed activities are replayed from history, not re-executed.
  console.log(
    `[reprice] ${itemId} ${identification.title.slice(0, 40)} → ${comps.summary.median} (${comps.summary.count} listings)`,
  );

  return {
    itemId,
    title: identification.title,
    median: comps.summary.median,
    count: comps.summary.count,
  };
}

/** Persist a refreshed price. Idempotent, so a retry cannot double-apply. */
export async function applyReprice(input: RefreshResult): Promise<void> {
  const item = await getItem(input.itemId);
  if (!item) return;
  const comps: CompsResult = {
    ...item.comps,
    summary: item.comps.summary
      ? { ...item.comps.summary, median: input.median, count: input.count }
      : null,
    basis: `Refreshed by the nightly reprice job (${input.count} listings).`,
    queriedAt: new Date().toISOString(),
  };
  await patchItem(input.itemId, { comps });
}
