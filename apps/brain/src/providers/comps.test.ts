import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compsQueryFor, snapIpg, LocalHistoryCompsProvider, SerpApiCompsProvider } from "./comps.ts";
import type { Identification } from "@sourcerer/shared";

/**
 * These cover the SerpApi request the app builds, because that request is the one part of
 * this codebase that cannot be exercised locally: it needs a paid key and a live eBay, so
 * `tests pass` says nothing about it. A parameter that SerpApi rejects is a bug that ships
 * silently and only appears the moment someone connects a real key — which is exactly when
 * you least want to be debugging.
 *
 * So the parameters are pinned here against the documented contract instead.
 */

function identify(over: Partial<Identification> = {}): Identification {
  return {
    title: "Levi's 501 Big E Selvedge Denim Jacket",
    brand: "Levi's",
    category: "clothing",
    condition: "good",
    confidence: 0.8,
    keywords: ["501", "big e", "selvedge", "denim", "type iii"],
    ...over,
  } as Identification;
}

describe("snapIpg", () => {
  // SerpApi's `_ipg` accepts exactly 25, 50, 100 or 200. The configured default is 60.
  it("snaps the configured 60 up to an allowed value", () => {
    assert.equal(snapIpg(60), 100);
  });

  it("leaves an already-allowed value alone", () => {
    for (const n of [25, 50, 100, 200]) assert.equal(snapIpg(n), n);
  });

  it("never returns a value outside the allowed set", () => {
    const allowed = new Set([25, 50, 100, 200]);
    for (const n of [1, 10, 24, 26, 49, 51, 99, 101, 199, 200, 500, 10_000]) {
      assert.ok(allowed.has(snapIpg(n)), `snapIpg(${n}) returned ${snapIpg(n)}`);
    }
  });

  it("never returns less than it was asked for, up to the cap", () => {
    for (const n of [1, 25, 26, 50, 51, 60, 100, 101, 200]) {
      assert.ok(snapIpg(n) >= n, `snapIpg(${n}) went backwards`);
    }
  });

  it("caps at 200 for anything above", () => {
    assert.equal(snapIpg(201), 200);
    assert.equal(snapIpg(2000), 200);
  });
});

describe("compsQueryFor", () => {
  it("leads with the brand and the first three keywords", () => {
    assert.equal(compsQueryFor(identify()), "Levi's 501 big e selvedge");
  });

  it("falls back to the title when there is no brand", () => {
    const q = compsQueryFor(identify({ brand: undefined, keywords: [] }));
    assert.match(q, /Levi's 501/);
  });

  it("keeps the query inside eBay's practical length", () => {
    const q = compsQueryFor(
      identify({ brand: undefined, title: "x".repeat(400), keywords: ["a".repeat(300)] }),
    );
    assert.ok(q.length <= 120, `query was ${q.length} chars`);
  });

  it("collapses whitespace rather than sending double spaces", () => {
    const q = compsQueryFor(identify({ brand: "  Levi's  ", keywords: [" 501 ", " big e "]}));
    assert.equal(q, "Levi's 501 big e");
  });
});

describe("SerpApiCompsProvider request parameters", () => {
  /**
   * Builds the same URL `search()` builds, without a network call, by intercepting fetch.
   * This is the only way to assert on the request without a live key.
   */
  async function capturedUrl(provider: SerpApiCompsProvider): Promise<URL> {
    const original = globalThis.fetch;
    let seen: URL | undefined;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      seen = new URL(String(input));
      return new Response(JSON.stringify({ organic_results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      await provider.search({ identification: identify() });
    } finally {
      globalThis.fetch = original;
    }
    assert.ok(seen, "no request was made");
    return seen!;
  }

  it("uses the ebay engine and the documented parameter names", async () => {
    const url = await capturedUrl(new SerpApiCompsProvider("test-key"));
    assert.equal(url.pathname, "/search");
    assert.equal(url.searchParams.get("engine"), "ebay");
    assert.equal(url.searchParams.get("_nkw"), "Levi's 501 big e selvedge");
    assert.equal(url.searchParams.get("ebay_domain"), "ebay.com");
    assert.equal(url.searchParams.get("api_key"), "test-key");
  });

  it("sends an _ipg that SerpApi actually accepts", async () => {
    const url = await capturedUrl(new SerpApiCompsProvider("test-key"));
    assert.ok(
      ["25", "50", "100", "200"].includes(url.searchParams.get("_ipg") ?? ""),
      `_ipg was ${url.searchParams.get("_ipg")}`,
    );
  });

  it("sorts by best match and asks only for free-shipping listings", async () => {
    // Free shipping is the closest comparable to our own shipping-paid cost model, and
    // `_sop=12` is Best Match for ebay.com — 2 and 3 (price sort) are unavailable there.
    const url = await capturedUrl(new SerpApiCompsProvider("test-key"));
    assert.equal(url.searchParams.get("_sop"), "12");
    assert.equal(url.searchParams.get("show_only"), "FS");
  });

  it("narrows to a comparable eBay condition id", async () => {
    const url = await capturedUrl(new SerpApiCompsProvider("test-key"));
    assert.equal(url.searchParams.get("LH_ItemCondition"), "3000"); // Used
  });

  it("restricts the response to the fields it parses", async () => {
    const url = await capturedUrl(new SerpApiCompsProvider("test-key"));
    const restrictor = url.searchParams.get("json_restrictor") ?? "";
    for (const field of ["title", "price", "condition", "link", "product_id"]) {
      assert.ok(restrictor.includes(field), `restrictor dropped ${field}`);
    }
  });

  it("is unavailable without a key, and refuses to call out", async () => {
    const provider = new SerpApiCompsProvider("");
    assert.equal(await provider.available(), false);
    await assert.rejects(() => provider.search({ identification: identify() } as never));
  });
});

describe("LocalHistoryCompsProvider — what counts as a comparable", () => {
  const history = [
    { title: "Levi's 501 Big E selvedge denim jacket", category: "denim jacket", brand: "Levi's", condition: "good", price: 145 },
    { title: "Woolrich 60/40 mountain parka", category: "coat", brand: "Woolrich", condition: "good", price: 78 },
    { title: "Stetson Open Road straw hat", category: "hat", brand: "Stetson", condition: "good", price: 64 },
  ];
  const provider = new LocalHistoryCompsProvider(async () => history);

  it("counts a past sale that shares several tokens", async () => {
    const res = await provider.search({ identification: identify() });
    assert.equal(res.comps.length, 1);
    assert.equal(res.comps[0]!.price, 145);
  });

  it("ignores a past sale that shares only one word", async () => {
    // The Woolrich parka shares exactly one token with a Pendleton wool shirt: "wool".
    // Before the minimum, it joined the comp set, dragged the median up and the confidence
    // down, and the app became less sure than its own history warranted.
    const res = await provider.search({
      identification: identify({
        title: "Pendleton wool board shirt",
        brand: "Pendleton",
        category: "shirt",
        keywords: ["Pendleton", "wool", "board", "shirt", "teal"],
      }),
    });
    assert.deepEqual(res.comps, []);
    assert.match(res.basis, /Nothing similar/);
  });

  it("is not fooled by a shared word in a different item", async () => {
    // "www" in a domain, "iron" in a band name — substring matching is blunt, so the
    // threshold is what keeps the bluntness from becoming an opinion about price.
    const res = await provider.search({
      identification: identify({
        title: "Woolrich blanket",
        brand: "Woolrich",
        category: "blanket",
        keywords: ["Woolrich", "blanket"],
      }),
    });
    // Shares only its brand, so it is excluded even though the brand matches exactly.
    assert.deepEqual(res.comps, []);
  });

  it("reports no comps rather than guessing when nothing is close", async () => {
    const res = await provider.search({
      identification: identify({
        title: "Nikon FM2 35mm film camera body",
        brand: "Nikon",
        category: "film camera",
        keywords: ["Nikon", "FM2", "35mm", "film", "camera", "body"],
      }),
    });
    assert.deepEqual(res.comps, []);
    assert.equal(res.summary, null);
  });
});
