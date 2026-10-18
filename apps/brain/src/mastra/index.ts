import { Mastra } from "@mastra/core";
import { sourcingAdvisor, listingWriter } from "./agents.ts";
import { scanWorkflow } from "./workflows.ts";
import { storage } from "./storage.ts";

/**
 * One Mastra instance holds everything the brain knows how to do:
 * agents, tools (attached to the agents), and the scan workflow.
 *
 * Registering them here is also what lets `pnpm --filter @sourcerer/brain mastra`
 * open the Mastra Studio against this app — which is how the agent traces, step
 * timings and tool calls were debugged while building it.
 */
export const mastra = new Mastra({
  agents: { sourcingAdvisor, listingWriter },
  workflows: { scanWorkflow },
  storage,
});

export { sourcingAdvisor, listingWriter, scanWorkflow };
