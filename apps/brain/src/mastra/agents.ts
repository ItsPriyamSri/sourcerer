import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { createOllama } from "ollama-ai-provider-v2";
import { ADVISOR_SYSTEM, LISTING_SYSTEM } from "@sourcerer/shared";
import { config, modelRoute } from "../env.ts";
import { advisorTools } from "./tools.ts";
import { storage } from "./storage.ts";

/**
 * The agents.
 *
 *   Sourcing Advisor  — the thing you talk to while standing at a rack. Has tools
 *                       for comps, pricing and fee math, so it answers with real
 *                       numbers instead of vibes.
 *   Listing Writer    — turns a captured item into listing copy.
 *
 * Both run on Gemma 3 through Ollama by default: on-device, no key, no network.
 * If this machine has no local model, the same agents run against open-weight
 * models through Backboard — same prompts, same tools, still open weights.
 */

const ollama = createOllama({ baseURL: `${config.ollama.baseUrl}/api` });

/** Gemma on this device. `gemma3:4b` is multimodal; the 1B is the fast text path. */
export function localModel(modelId: string = config.ollama.model) {
  return ollama.chat(modelId);
}

export const memory = new Memory({ storage });

export const sourcingAdvisor = new Agent({
  id: "sourcing-advisor",
  name: "Sourcing Advisor",
  instructions: ADVISOR_SYSTEM,
  model: localModel(),
  tools: advisorTools,
  memory,
});

export const listingWriter = new Agent({
  id: "listing-writer",
  name: "Listing Writer",
  instructions: LISTING_SYSTEM,
  model: localModel(),
  memory,
});

/** Reported by GET /capabilities so the UI can be honest about the running brain. */
export function brainSummary() {
  const route = modelRoute();
  return {
    provider: route.provider,
    local: route.local,
    model: route.provider === "ollama" ? config.ollama.model : config.backboard.model,
  };
}
