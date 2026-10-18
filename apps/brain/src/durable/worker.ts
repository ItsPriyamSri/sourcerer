import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities.ts";
import { config } from "../env.ts";

/**
 * The reprice worker. Run it next to the brain:
 *
 *   pnpm --filter @sourcerer/brain worker
 *
 * It registers the durable workflow and its activities on the task queue and then
 * sits there waiting for runs — including runs it will resume after a restart.
 */
async function run() {
  const connection = await NativeConnection.connect({ address: config.temporal.address });
  const worker = await Worker.create({
    connection,
    namespace: config.temporal.namespace,
    taskQueue: config.temporal.taskQueue,
    workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
    activities,
  });
  console.log(`[reprice-worker] listening on ${config.temporal.taskQueue} at ${config.temporal.address}`);
  await worker.run();
}

run().catch((err) => {
  console.error("[reprice-worker] fatal:", err);
  process.exit(1);
});
