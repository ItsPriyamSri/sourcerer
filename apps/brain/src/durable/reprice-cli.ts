import { Connection, Client } from "@temporalio/client";
import { config } from "../env.ts";
import { listItems } from "../core/store.ts";
import type { RepriceProgress } from "./workflows.ts";

/**
 * One-shot reprice from the terminal:
 *
 *   pnpm --filter @sourcerer/brain reprice
 *
 * Starts the durable workflow and waits for it, printing progress. In production
 * this is what the nightly schedule calls.
 */
async function main() {
  const items = await listItems();
  if (items.length === 0) {
    console.log("inventory is empty — nothing to reprice");
    return;
  }

  const connection = await Connection.connect({ address: config.temporal.address });
  const client = new Client({ connection, namespace: config.temporal.namespace });

  const day = new Date().toISOString().slice(0, 10);
  const handle = await client.workflow.start("repriceInventory", {
    taskQueue: config.temporal.taskQueue,
    workflowId: `reprice-${day}`,
    args: [{ items: items.map((i) => i.id) }],
    workflowExecutionTimeout: "2 hours",
  });

  console.log(`started ${handle.workflowId} over ${items.length} items`);
  console.log(`watch it: http://127.0.0.1:8233/namespaces/${config.temporal.namespace}/workflows/${handle.workflowId}`);

  const result = (await handle.result()) as RepriceProgress;
  console.log(`done: ${result.done}/${result.total} refreshed, ${result.failed.length} failed`);
  if (result.failed.length) console.log("failed:", result.failed.join(", "));
  await connection.close();
}

main().catch((err) => {
  console.error("reprice failed:", err instanceof Error ? err.message : err);
  console.error("is Temporal running?  temporal server start-dev");
  process.exit(1);
});
