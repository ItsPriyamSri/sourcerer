import { test } from "node:test";
import assert from "node:assert/strict";
import { median, quantile, trimmedMean, summariseComps, conditionAdjusted } from "./comps.ts";
import type { Comp } from "./types.ts";

/** Comps statistics decide the number the whole verdict hangs on. Tested hard. */

test("median handles odd and even counts", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.ok(Number.isNaN(median([])));
});

test("quantile interpolates between neighbours", () => {
  const xs = [10, 20, 30, 40];
  assert.equal(quantile(xs, 0), 10);
  assert.equal(quantile(xs, 1), 40);
  assert.equal(quantile(xs, 0.5), 25);
});

test("trimmedMean ignores the chancer asking ten times the going rate", () => {
  const normal = [100, 102, 98, 105, 101, 99, 103, 97, 104, 100];
  const withOutlier = [...normal, 1000];
  const a = trimmedMean(normal);
  const b = trimmedMean(withOutlier);
  // Dropping the top decile means the outlier barely registers.
  assert.ok(Math.abs(a - b) < 15, `trimmed mean moved from ${a} to ${b}`);
  assert.ok(median(withOutlier) < 110);
});

test("summariseComps drops non-positive and non-finite prices", () => {
  const comps: Comp[] = [
    { title: "a", price: 50, currency: "USD", kind: "asking", source: "test" },
    { title: "b", price: 0, currency: "USD", kind: "asking", source: "test" },
    { title: "c", price: Number.NaN, currency: "USD", kind: "asking", source: "test" },
    { title: "d", price: 70, currency: "USD", kind: "asking", source: "test" },
    { title: "e", price: -5, currency: "USD", kind: "asking", source: "test" },
  ];
  const s = summariseComps(comps);
  assert.equal(s?.count, 2);
  assert.equal(s?.median, 60);
  assert.equal(s?.currency, "USD");
});

test("summariseComps returns null when there is nothing usable", () => {
  assert.equal(summariseComps([]), null);
  assert.equal(summariseComps([{ title: "x", price: 0, currency: "USD", kind: "asking", source: "t" }]), null);
});

test("conditionAdjusted discounts a fair item and premiums a new one", () => {
  assert.equal(conditionAdjusted(100, "new"), 115);
  assert.equal(conditionAdjusted(100, "like_new"), 100);
  assert.equal(conditionAdjusted(100, "fair"), 75);
  assert.equal(conditionAdjusted(100, "poor"), 50);
  // Unknown conditions fall back to the 'good' discount rather than trusting the number.
  assert.equal(conditionAdjusted(100, "mystery"), 92);
});
