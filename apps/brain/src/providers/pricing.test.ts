import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readQuantiles } from "./pricing.ts";

/**
 * The shape of Prior Labs' regression output is the one thing about TabPFN this
 * repo cannot check locally — it needs a key and a fitted model. So the reading of
 * that shape is pinned here instead.
 *
 * The bug this guards is silent by construction: quantile-major output read
 * row-major does not throw, does not return null, and does not look wrong. It
 * returns a plausible number about 20% below the truth, on every prediction.
 */

describe("readQuantiles", () => {
  it("reads quantile-major output, which is what the SDK documents", () => {
    // One test row, three quantiles → "one array per quantile".
    assert.deepEqual(readQuantiles([[10], [50], [90]]), [10, 50, 90]);
  });

  it("does not mistake quantile-major output for a row (the shipped bug)", () => {
    // The old row-major parse turned this into the ±20% fallback around 10.
    const [p10, p50, p90] = readQuantiles([[10], [50], [90]]);
    assert.equal(p50, 50, "median must be the middle quantile, not the first");
    assert.equal(p10, 10);
    assert.equal(p90, 90);
  });

  it("still accepts row-major output", () => {
    assert.deepEqual(readQuantiles([[10, 50, 90]]), [10, 50, 90]);
  });

  it("still accepts a flat array", () => {
    assert.deepEqual(readQuantiles([10, 50, 90]), [10, 50, 90]);
  });

  it("falls back to a +/-20% band when only one value comes back", () => {
    const [p10, p50, p90] = readQuantiles([[42]]);
    assert.equal(p50, 42);
    assert.equal(p10, 33.6);
    assert.equal(p90, 50.4);
  });

  it("degrades to zeros rather than NaN on a malformed payload", () => {
    for (const bad of [[], [[]], null, undefined, "nope", {}]) {
      const out = readQuantiles(bad);
      assert.equal(out.length, 3);
      for (const v of out) assert.ok(Number.isFinite(v), `${String(bad)} → ${v}`);
    }
  });

  it("uses the first value of each quantile across multiple rows", () => {
    // Two rows, three quantiles: we price the row we asked for.
    assert.deepEqual(readQuantiles([[10, 11], [50, 51], [90, 91]]), [10, 50, 90]);
  });
});
