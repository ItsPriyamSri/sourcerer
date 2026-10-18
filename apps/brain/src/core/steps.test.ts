import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultCostModel, type PriceEstimate } from "@sourcerer/shared";
import { extractJson, makeVerdict } from "./steps.ts";

/**
 * Two things in the pipeline are worth testing on the brain side specifically.
 *
 * `extractJson` is the seam between "a language model replied" and "we have data",
 * and it is the only reason a 4B model that writes prose instead of JSON does not
 * take the whole scan down with it.
 *
 * `makeVerdict` is the money. It is a thin wrapper over `decideVerdict`, but it also
 * owns one real decision: when the user has not named an asking price yet, the verdict
 * is computed *at our recommended offer*, because that is the number someone needs
 * while walking up to the counter.
 */

const price = (expected: number, confidence = 0.8): PriceEstimate => ({
  expected,
  low: expected * 0.9,
  high: expected * 1.1,
  daysToSell: 14,
  method: "comps_median",
  confidence,
  note: "test fixture",
});

describe("extractJson", () => {
  it("reads a bare object", () => {
    assert.deepEqual(extractJson('{"title":"Pyrex bowl"}'), { title: "Pyrex bowl" });
  });

  it("reads a bare array", () => {
    assert.deepEqual(extractJson("[1,2,3]"), [1, 2, 3]);
  });

  it("digs JSON out of a fenced block", () => {
    const reply = 'Sure!\n```json\n{"title":"Griswold #8"}\n```\nHope that helps.';
    assert.deepEqual(extractJson(reply), { title: "Griswold #8" });
  });

  it("digs JSON out of prose with no fences", () => {
    const reply = 'Here is what I think:\n{"title":"Stetson Open Road","confidence":0.9}\nLet me know.';
    assert.deepEqual(extractJson(reply), { title: "Stetson Open Road", confidence: 0.9 });
  });

  it("keeps nested objects intact", () => {
    const reply = '{"title":"Nikon FM2","attributes":{"mount":"F","shutter":"mechanical"}}';
    assert.deepEqual(extractJson(reply), {
      title: "Nikon FM2",
      attributes: { mount: "F", shutter: "mechanical" },
    });
  });

  it("throws on a reply with no JSON at all, so the caller can fall back", () => {
    assert.throws(() => extractJson("That looks like a vintage camera to me."), /no JSON/);
  });

  it("throws on JSON cut off mid-object rather than returning half a record", () => {
    assert.throws(() => extractJson('{"title":"Sony Walkman","category":"audio"'), /truncated JSON/);
  });
});

describe("makeVerdict", () => {
  const cost = defaultCostModel("ebay");

  it("says BUY when the tag price is well under our ceiling", () => {
    const v = makeVerdict({ buyPrice: 5, price: price(200), cost });
    assert.equal(v.label, "BUY");
    assert.ok(v.maxOffer > 5);
  });

  it("says PASS when the tag price is over the ceiling", () => {
    const v = makeVerdict({ buyPrice: 999, price: price(40), cost });
    assert.equal(v.label, "PASS");
  });

  it("never says BUY when the model is unsure", () => {
    // Cheap by the arithmetic, but confidence 0.2 is below the 0.5 floor.
    const v = makeVerdict({ buyPrice: 1, price: price(200, 0.2), cost });
    assert.notEqual(v.label, "BUY");
  });

  it("uses the recommended offer as the price when no asking price is given", () => {
    // With no buyPrice, makeVerdict evaluates at maxOffer itself. At exactly the
    // ceiling there is no cushion, so the honest label is MAYBE and not BUY — BUY
    // requires paying at most 70% of your own ceiling. That buffer is deliberate.
    const v = makeVerdict({ price: price(120), cost });
    assert.equal(v.label, "MAYBE");
    assert.equal(v.offerRatio, 1);
  });

  it("says BUY only with a real cushion under the ceiling", () => {
    const ceiling = makeVerdict({ price: price(120), cost }).maxOffer;
    const v = makeVerdict({ buyPrice: ceiling * 0.7, price: price(120), cost });
    assert.equal(v.label, "BUY");
  });

  it("refuses to recommend an offer on an item it cannot price", () => {
    const v = makeVerdict({ price: price(0), cost });
    assert.equal(v.label, "PASS");
    assert.equal(v.maxOffer, 0);
  });

  it("is deterministic — same inputs, same cents, every time", () => {
    const a = makeVerdict({ buyPrice: 18.55, price: price(133.4), cost });
    const b = makeVerdict({ buyPrice: 18.55, price: price(133.4), cost });
    assert.deepEqual(a, b);
  });
});
