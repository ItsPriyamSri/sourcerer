import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import type { CompsResult, Identification, PriceEstimate, RanLogEntry, ScanStage, Verdict } from "@sourcerer/shared";
import { ScanRequestZ, defaultCostModel, mergeCostModel, maxOfferFor, decideVerdict, clamp } from "@sourcerer/shared";
import { identify, findComps, estimatePrice, makeVerdict } from "../core/steps.ts";

/**
 * The scan, expressed as a Mastra workflow.
 *
 * Four typed steps, each with its own schema, so Mastra (and its Studio) can show
 * exactly where time went and which step failed. The steps are the same functions
 * the HTTP route uses — a workflow that reimplemented the pipeline would be a
 * second source of truth, and second sources of truth drift.
 *
 * State accumulates across steps rather than being re-derived, which is what makes
 * a crash mid-scan resumable and the Studio view readable.
 */

const IdentZ = z.any();
const StateZ = z.object({
  request: ScanRequestZ,
  identification: IdentZ.optional(),
  comps: z.any().optional(),
  price: z.any().optional(),
  verdict: z.any().optional(),
  ran: z.array(z.any()).default([]),
  stages: z.array(z.any()).default([]),
});

export type ScanState = z.infer<typeof StateZ>;

const identifyStep = createStep({
  id: "identify",
  inputSchema: StateZ,
  outputSchema: StateZ,
  execute: async ({ inputData }) => {
    const t0 = Date.now();
    const { identification, ran } = await identify({
      image: inputData.request.image,
      text: inputData.request.text,
    });
    const stage: ScanStage = { stage: "identify", status: "done", ms: Date.now() - t0, detail: identification.title };
    return { ...inputData, identification, ran: [...inputData.ran, ran], stages: [...inputData.stages, stage] };
  },
});

const compsStep = createStep({
  id: "comps",
  inputSchema: StateZ,
  outputSchema: StateZ,
  execute: async ({ inputData }) => {
    const t0 = Date.now();
    const { comps, ran } = await findComps({
      identification: inputData.identification as Identification,
      offline: inputData.request.offline,
    });
    const stage: ScanStage = {
      stage: "comps",
      status: ran.ok ? "done" : "error",
      ms: Date.now() - t0,
      detail: comps.basis,
    };
    return { ...inputData, comps, ran: [...inputData.ran, ran], stages: [...inputData.stages, stage] };
  },
});

const priceStep = createStep({
  id: "price",
  inputSchema: StateZ,
  outputSchema: StateZ,
  execute: async ({ inputData }) => {
    const t0 = Date.now();
    const { price, ran } = await estimatePrice({
      identification: inputData.identification as Identification,
      comps: inputData.comps as CompsResult,
    });
    const stage: ScanStage = {
      stage: "price",
      status: "done",
      ms: Date.now() - t0,
      detail: `${price.method} · ${price.expected}`,
    };
    return { ...inputData, price, ran: [...inputData.ran, ran], stages: [...inputData.stages, stage] };
  },
});

const verdictStep = createStep({
  id: "verdict",
  inputSchema: StateZ,
  outputSchema: StateZ,
  execute: async ({ inputData }) => {
    const cost = mergeCostModel(defaultCostModel(inputData.request.cost?.marketplace ?? "ebay"), inputData.request.cost);
    const price = inputData.price as PriceEstimate;
    const buy = inputData.request.buyPrice ?? maxOfferFor(price.expected, cost);
    const verdict: Verdict = decideVerdict(buy, price.expected, cost, clamp(price.confidence, 0.1, 0.95));
    const stage: ScanStage = { stage: "verdict", status: "done", ms: 0, detail: verdict.label };
    const ran: RanLogEntry = { step: "verdict", provider: "local", locality: "device", ms: 0, ok: true, detail: verdict.reason };
    return { ...inputData, verdict, ran: [...inputData.ran, ran], stages: [...inputData.stages, stage] };
  },
});

export const scanWorkflow = createWorkflow({
  id: "scanWorkflow",
  inputSchema: StateZ,
  outputSchema: StateZ,
})
  .then(identifyStep)
  .then(compsStep)
  .then(priceStep)
  .then(verdictStep)
  .commit();

/** Convenience for callers that just want the answer. */
export function makeScanState(request: z.infer<typeof ScanRequestZ>): ScanState {
  return { request, ran: [], stages: [] };
}

export { makeVerdict };
