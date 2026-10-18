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

/**
 * The model that runs the advise loop, which is a different job from identifying an item.
 *
 * Ollama reports Gemma 3's capabilities as `completion, vision` — no `tools`. Ask it to
 * call a tool and the request fails with "does not support tools". So the agent uses a
 * small tool-capable open model beside Gemma, while Gemma keeps the jobs it is actually
 * good at: reading photos and writing listings.
 *
 * The first choice for this was Qwen 3 4B, because it is the strongest small tool-caller
 * here and it does call tools correctly. It was the wrong choice anyway, for a reason that
 * only shows up when you time it: Qwen 3 is a reasoning model, and it reasons its way to
 * the tool call and then keeps reasoning — ~8,000 thinking tokens per step, which is over
 * four minutes to answer a question about a $215 sale. A tool loop wants a model that
 * follows a protocol, not one that deliberates about it. `llama3.2:3b` has `tools` and no
 * thinking mode, and answers the same question in seconds.
 *
 * If no tool model is installed, this returns the configured model and the agent fails
 * loudly — which the advisor route catches and turns into a deterministic answer rather
 * than an error page.
 */
export function toolModel() {
  const modelId = config.ollama.toolModel || config.ollama.model;
  return ollama.chat(modelId);
}

/**
 * Does the configured tool model have a thinking mode?
 *
 * Qwen 3 does, and needs `think: true` or its deliberation arrives inside the answer
 * instead of beside it. `llama3.2` does not have one and rejects the flag outright:
 *
 *   {"error":"\"llama3.2:3b\" does not support thinking"}
 *
 * So the flag is read from what the installed model actually reports, not hard-coded to
 * whichever model happened to be the default on the day this was written. Cached: this is
 * a property of the weights on disk and cannot change while the process is running.
 */
const thinkSupport = new Map<string, boolean>();

export async function toolModelThinks(modelId: string = config.ollama.toolModel): Promise<boolean> {
  const cached = thinkSupport.get(modelId);
  if (cached !== undefined) return cached;

  let thinks = false;
  try {
    const res = await fetch(`${config.ollama.baseUrl}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: modelId }),
      signal: AbortSignal.timeout(4000),
    });
    const json = (await res.json()) as { capabilities?: string[] };
    thinks = (json.capabilities ?? []).includes("thinking");
  } catch {
    // Unreachable model: no thinking flag. The request itself will fail visibly rather
    // than this silently guessing wrong.
    thinks = false;
  }

  thinkSupport.set(modelId, thinks);
  return thinks;
}

export const memory = new Memory({ storage });

export const sourcingAdvisor = new Agent({
  id: "sourcing-advisor",
  name: "Sourcing Advisor",
  instructions: ADVISOR_SYSTEM,
  model: toolModel(),
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
