import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEconomics, maxOfferFor, decideVerdict, portfolioStats } from "./economics.ts";
import { defaultCostModel, mergeCostModel } from "./costs.ts";
import type { CostModel } from "./types.ts";

/**
 * The money math is the part a reseller actually bets money on, so it gets tests.
 * These cases are written from the user's point of view ("what would I pay?") rather
 * than from the implementation's, because that is the number that has to be right.
 */

const ebay = defaultCostModel("ebay");

test("computeEconomics subtracts fees, shipping and supplies", () => {
  const e = computeEconomics(10, 100, ebay);
  // 100 - (13.6 + 0.30) - 8 - 1 = 77.10
  assert.equal(e.netProceeds, 77.1);
  assert.equal(e.expectedProfit, 67.1);
  assert.equal(e.multiple, 7.71);
  assert.equal(e.buyPrice, 10);
});

test("computeEconomics never divides by zero", () => {
  const e = computeEconomics(0, 50, ebay);
  assert.equal(e.multiple, Number.POSITIVE_INFINITY);
  assert.equal(Number.isFinite(e.expectedProfit), true);
});

test("maxOfferFor solves for the price that hits the target multiple", () => {
  const cost = mergeCostModel(ebay, { targetMultiple: 3 });
  const max = maxOfferFor(120, cost);
  // net at 120 = 120 - 16.62 - 8 - 1 = 94.38 ; /3 = 31.46
  assert.equal(max, 31.46);

  // Buying at exactly maxOffer should produce a multiple of ~3.
  const e = computeEconomics(max, 120, cost);
  assert.ok(Math.abs(e.multiple - 3) < 0.02, `multiple was ${e.multiple}`);
});

test("maxOfferFor with targetMultiple <= 1 returns full net proceeds", () => {
  const cost = mergeCostModel(ebay, { targetMultiple: 1 });
  assert.equal(maxOfferFor(100, cost), computeEconomics(0, 100, cost).netProceeds);
});

test("decideVerdict says BUY well under max offer", () => {
  const v = decideVerdict(5, 120, ebay, 0.9);
  assert.equal(v.label, "BUY");
  assert.ok(v.economics.expectedProfit > ebay.minProfit);
});

test("decideVerdict says PASS when profit is below the floor", () => {
  // Retail 12 with $8 shipping + $1 supplies on eBay: net is ~1.9, under minProfit.
  const v = decideVerdict(1, 12, ebay, 0.9);
  assert.equal(v.label, "PASS");
});

test("a thin-but-positive flip is MAYBE, not BUY", () => {
  // Buy right at maxOffer: profit lands between minProfit and 1.5x minProfit.
  const max = maxOfferFor(60, ebay);
  const v = decideVerdict(max, 60, ebay, 0.9);
  assert.notEqual(v.label, "BUY");
});

test("low confidence can never produce a confident BUY", () => {
  const v = decideVerdict(1, 500, ebay, 0.2);
  assert.equal(v.label, "MAYBE");
});

test("offerRatio compares what you are asked to your ceiling", () => {
  const cost = mergeCostModel(ebay, { targetMultiple: 2 });
  const max = maxOfferFor(100, cost);
  const v = decideVerdict(max * 2, 100, cost, 0.9);
  assert.equal(v.offerRatio, 2);
});

test("facebook marketplace has no fees and no shipping", () => {
  const fb = defaultCostModel("facebook");
  const e = computeEconomics(10, 50, fb);
  assert.equal(e.netProceeds, 50);
  assert.equal(e.expectedProfit, 40);
});

test("portfolioStats distinguishes realised from unrealised profit", () => {
  const stats = portfolioStats([
    { status: "sold", buyPrice: 10, soldFor: 100, economics: computeEconomics(10, 100, ebay) },
    { status: "bought", buyPrice: 20, economics: computeEconomics(20, 120, ebay) },
    { status: "sourced", buyPrice: 5, economics: computeEconomics(5, 40, ebay) },
  ]);
  assert.equal(stats.itemCount, 3);
  assert.equal(stats.spent, 35);
  assert.equal(stats.revenue, 100);
  assert.equal(stats.realisedProfit, 90);
  assert.ok(stats.unrealisedProfit > 0);
  assert.equal(stats.sellThrough, 0.33);
});

test("mergeCostModel clamps hostile input from a slider or config file", () => {
  const wild: Partial<CostModel> = { platformFeePct: 99, targetMultiple: 0, shippingCost: -50, minProfit: -1 };
  const c = mergeCostModel(ebay, wild);
  assert.equal(c.platformFeePct, 0.6);
  assert.equal(c.targetMultiple, 1);
  assert.equal(c.shippingCost, 0);
  assert.equal(c.minProfit, 0);
});
