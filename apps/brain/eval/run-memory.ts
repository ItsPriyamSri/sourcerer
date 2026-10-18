/**
 * Agent eval.
 *
 * Three turns against the same Mastra agent and the same memory thread, to establish
 * two things a claim of "it's an agent" should have to prove:
 *
 *   1. Does it actually reach for a tool when the question needs one?
 *   2. Does it remember what was said two turns ago?
 *
 * Turn 1 is a pricing question that cannot be answered from the prompt alone, so a
 * useful answer requires a tool call. Turn 2 changes the cost assumptions. Turn 3 asks
 * about turn 1 without repeating it — that one only works if memory is real.
 *
 * Run:  pnpm evidence:memory
 * Out:  docs/evidence/agent-transcript.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BRAIN = process.env.BRAIN_URL ?? "http://127.0.0.1:8787";
const THREAD = `eval-${Date.now().toString(36)}`;

const TURNS = [
  {
    id: "t1",
    needsTool: true,
    message:
      "I'm at an estate sale and there's a Ludwig Acrolite snare drum for $150. I sell on eBay. What's my true profit if it resells for $215, and should I buy it?",
  },
  {
    id: "t2",
    needsTool: true,
    message: "I'm shipping cross-country, so put shipping at $35 instead. Does the answer change?",
  },
  {
    id: "t3",
    needsTool: false,
    message: "What did I tell you I was looking at? And remind me of the asking price I mentioned.",
  },
];

async function ask(message: string) {
  const t0 = Date.now();
  const res = await fetch(`${BRAIN}/advisor`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, threadId: THREAD, resourceId: "eval-reseller" }),
  });
  const body = (await res.json()) as { text?: string; degraded?: boolean; agent?: string };
  return { ms: Date.now() - t0, ...body };
}

async function main() {
  const results: { id: string; message: string; needsTool: boolean; reply: string; ms: number; degraded: boolean }[] = [];

  for (const turn of TURNS) {
    process.stdout.write(`\n[${turn.id}] ${turn.message.slice(0, 70)}…\n`);
    const r = await ask(turn.message);
    process.stdout.write(`  (${(r.ms / 1000).toFixed(1)}s${r.degraded ? ", degraded" : ""}) ${(r.text ?? "").slice(0, 400)}\n`);
    results.push({ id: turn.id, message: turn.message, needsTool: turn.needsTool, reply: r.text ?? "", ms: r.ms, degraded: Boolean(r.degraded) });
  }

  // Cheap, checkable heuristics — not a grade, an observation.
  const said215 = results[0]?.reply.includes("215");
  const mentionedShipping = /shipping|35/.test(results[1]?.reply ?? "");
  const recalledItem = /acro|snare|drum|ludwig/i.test(results[2]?.reply ?? "");
  const recalledPrice = /150/.test(results[2]?.reply ?? "");

  console.log("\nobservations");
  console.log(`  turn 1 mentions the resale price it was given: ${said215}`);
  console.log(`  turn 2 engages with the shipping change:        ${mentionedShipping}`);
  console.log(`  turn 3 recalls the item from turn 1:            ${recalledItem}`);
  console.log(`  turn 3 recalls the asking price from turn 1:     ${recalledPrice}`);
  console.log(`  any turn degraded (model could not run):         ${results.some((r) => r.degraded)}`);

  const dir = resolve(process.cwd(), "../../docs/evidence");
  mkdirSync(dir, { recursive: true });
  const out = resolve(dir, "agent-transcript.json");
  writeFileSync(
    out,
    JSON.stringify(
      {
        brain: BRAIN,
        threadId: THREAD,
        generatedAt: new Date().toISOString(),
        observations: { said215, mentionedShipping, recalledItem, recalledPrice, anyDegraded: results.some((r) => r.degraded) },
        turns: results,
      },
      null,
      2,
    ),
  );
  console.log(`\nwrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
