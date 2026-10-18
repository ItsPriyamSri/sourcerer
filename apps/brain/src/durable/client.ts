import { Client, Connection } from "@temporalio/client";
import { config } from "../env.ts";
import { listItems } from "../core/store.ts";
import type { RepriceProgress } from "./workflows.ts";

/**
 * Starts (or resumes) a reprice run.
 *
 * The workflow id is derived from the calendar day, so hitting "reprice" twice on a
 * Tuesday attaches to the same durable run instead of spawning a duplicate that
 * spends the same API quota again.
 */
export async function startReprice(opts: { itemIds?: string[]; paceMs?: number } = {}) {
  const connection = await Connection.connect({ address: config.temporal.address });
  const client = new Client({ connection, namespace: config.temporal.namespace });

  const itemIds = opts.itemIds ?? (await listItems()).map((i) => i.id);
  if (itemIds.length === 0) {
    await connection.close();
    return { started: false, reason: "no items in inventory to reprice" };
  }

  const day = new Date().toISOString().slice(0, 10);
  const workflowId = `reprice-${day}`;

  const handle = await client.workflow.start("repriceInventory", {
    taskQueue: config.temporal.taskQueue,
    workflowId,
    args: [{ items: itemIds, paceMs: opts.paceMs }],
    workflowExecutionTimeout: "2 hours",
  });

  return {
    started: true,
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
    itemCount: itemIds.length,
    ui: `http://127.0.0.1:8233/namespaces/${config.temporal.namespace}/workflows/${handle.workflowId}`,
  };
}

export async function repriceProgress(workflowId: string): Promise<RepriceProgress | null> {
  const connection = await Connection.connect({ address: config.temporal.address });
  const client = new Client({ connection, namespace: config.temporal.namespace });
  const handle = client.workflow.getHandle(workflowId);
  const { getProgress } = await import("./workflows.ts");
  return handle.query(getProgress);
}
