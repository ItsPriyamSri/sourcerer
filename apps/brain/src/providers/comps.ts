import type { Comp, CompsResult, Condition, Identification } from "@sourcerer/shared";
import { summariseComps, round2 } from "@sourcerer/shared";
import { config } from "../env.ts";

/**
 * Live market prices.
 *
 * IMPORTANT AND DELIBERATE: SerpApi can no longer return eBay *sold* listings —
 * eBay put completed listings behind a login in July 2026 and the Sold filter was
 * retired. So what we can actually get today is asking prices for active listings.
 *
 * Asking is not sold, and the whole point of this product is that a reseller can
 * trust the number. So we do two things instead of lying:
 *
 *   1. We tag every comp as `asking` or `sold`, and the UI shows which it is.
 *   2. We apply an explicit, visible asking→sold haircut before it ever reaches
 *      the verdict, so the model is not fed optimistic numbers.
 *
 * Plugging in a true sold-comps vendor later means implementing one interface.
 */

/** Asking prices run above realised sale prices. This is the discount we apply. */
export const ASKING_TO_SOLD_FACTOR = 0.86;

/**
 * How many of the identification's own tokens a past sale must share before it counts as a
 * comparable. One is too few — see the note in `LocalHistoryCompsProvider.search`.
 */
export const MIN_COMP_TOKENS = 2;

export interface CompsQuery {
  identification: Identification;
  condition?: Condition;
  /** Only consider these marketplaces. */
  markets?: string[];
  signal?: AbortSignal;
}

export interface CompsProvider {
  readonly id: string;
  readonly local: boolean;
  available(): Promise<boolean>;
  search(q: CompsQuery): Promise<CompsResult>;
}

/** eBay item-condition ids, used to narrow listings to comparable condition. */
const EBAY_CONDITION: Record<Condition, number | undefined> = {
  new: 1000, // New
  like_new: 1500, // New other
  good: 3000, // Used
  fair: 3000,
  poor: 7000, // For parts or not working
  unknown: undefined,
};

/**
 * SerpApi's `_ipg` is not an arbitrary maximum — it accepts exactly 25, 50, 100 or 200.
 * The configured default is 60, which is not one of them, so passing the config value
 * straight through would have made the first live comps call fail on a parameter that
 * no test could have caught and no local run would ever exercise.
 */
const IPG_ALLOWED = [25, 50, 100, 200] as const;

export function snapIpg(max: number): number {
  return IPG_ALLOWED.find((n) => n >= max) ?? 200;
}

export function compsQueryFor(id: Identification): string {
  const brand = id.brand?.trim();
  const kw = id.keywords.slice(0, 3).join(" ");
  const base = [brand, kw || id.title].filter(Boolean).join(" ");
  return base.replace(/\s+/g, " ").trim().slice(0, 120);
}

/** Thin wrapper over the SerpApi eBay engine. */
export class SerpApiCompsProvider implements CompsProvider {
  readonly id = "serpapi";
  readonly local = false;

  constructor(private apiKey = config.serpapi.apiKey) {}

  async available(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async search(q: CompsQuery): Promise<CompsResult> {
    const t0 = Date.now();
    if (!this.apiKey) throw new Error("SERPAPI_API_KEY not set");

    const query = compsQueryFor(q.identification);
    const cond = q.condition ?? q.identification.condition;
    const url = new URL("/search", config.serpapi.baseUrl);
    url.searchParams.set("engine", "ebay");
    url.searchParams.set("ebay_domain", "ebay.com");
    url.searchParams.set("_nkw", query);
    // SerpApi accepts only 25/50/100/200 here; snap up rather than send an illegal value.
    url.searchParams.set("_ipg", String(snapIpg(config.serpapi.maxResults)));
    url.searchParams.set("_sop", "12"); // Best match
    // Seller pays shipping in our cost model, so free-shipping listings are the
    // closest comparable to the price we are estimating.
    url.searchParams.set("show_only", "FS");
    const condId = EBAY_CONDITION[cond];
    if (condId) url.searchParams.set("LH_ItemCondition", String(condId));
    url.searchParams.set(
      "json_restrictor",
      "organic_results[].{title,price,condition,link,product_id}",
    );
    url.searchParams.set("api_key", this.apiKey);

    const res = await fetch(url, { signal: q.signal });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`serpapi ${res.status}: ${detail.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      organic_results?: Array<{
        title?: string;
        condition?: string;
        link?: string;
        price?: { extracted?: number; raw?: string; from?: { extracted?: number }; to?: { extracted?: number } };
      }>;
      error?: string;
    };
    if (json.error) throw new Error(`serpapi: ${json.error}`);

    const comps: Comp[] = [];
    for (const r of json.organic_results ?? []) {
      const p = r.price;
      if (!p) continue;
      const low = p.from?.extracted ?? p.extracted;
      const high = p.to?.extracted ?? p.extracted;
      if (low == null) continue;
      // A price range means variants; use the midpoint so we do not cherry-pick.
      const price = high != null && high !== low ? (low + high) / 2 : low;
      if (!Number.isFinite(price) || price <= 0) continue;
      comps.push({
        title: r.title ?? "(untitled listing)",
        price: round2(price),
        currency: "USD",
        condition: r.condition,
        url: r.link,
        kind: "asking",
        source: "ebay (active listing)",
      });
    }

    const summary = summariseComps(comps);
    return {
      comps,
      summary,
      source: "live",
      basis: summary
        ? `${summary.count} live eBay listings for "${query}". Asking prices, adjusted ${Math.round(
            (1 - ASKING_TO_SOLD_FACTOR) * 100,
          )}% toward realised sale prices.`
        : `No live eBay listings matched "${query}".`,
      queriedAt: new Date().toISOString(),
      queryUsed: query,
    };
  }
}

/** Comps from the user's own sold history. Works with the wifi off. */
export class LocalHistoryCompsProvider implements CompsProvider {
  readonly id = "local_history";
  readonly local = true;

  constructor(
    private load: () => Promise<
      Array<{ title: string; category?: string; brand?: string; condition?: string; price: number; soldAt?: string }>
    >,
  ) {}

  async available(): Promise<boolean> {
    return true;
  }

  async search(q: CompsQuery): Promise<CompsResult> {
    const history = await this.load();
    const tokens = new Set(
      [q.identification.brand, q.identification.category, ...q.identification.keywords]
        .filter(Boolean)
        .flatMap((s) => String(s).toLowerCase().split(/\s+/)),
    );

    const scored = history
      .map((h) => {
        const hay = `${h.title} ${h.brand ?? ""} ${h.category ?? ""}`.toLowerCase();
        let score = 0;
        for (const t of tokens) if (t.length > 2 && hay.includes(t)) score++;
        return { h, score };
      })
      // Two shared words, not one. A single shared word is not evidence: "wool" pulled a
      // Woolrich mountain parka into a Pendleton wool shirt's comp set and dragged the
      // median and the confidence with it, so the app was less sure than its own history
      // justified. Requiring two costs nothing when the record is genuinely comparable —
      // a Levi's jacket matches on six tokens — and it stops the incidental ones.
      .filter((x) => x.score >= MIN_COMP_TOKENS)
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);

    const comps: Comp[] = scored.map(({ h }) => ({
      title: h.title,
      price: h.price,
      currency: "USD",
      condition: h.condition,
      soldAt: h.soldAt,
      kind: "sold",
      source: "your sold history",
    }));

    const summary = summariseComps(comps);
    return {
      comps,
      summary,
      source: "local_history",
      basis: summary
        ? `${summary.count} similar items you have already sold. Real realised prices, on this device.`
        : "Nothing similar in your sold history yet.",
      queriedAt: new Date().toISOString(),
      queryUsed: compsQueryFor(q.identification),
    };
  }
}

/** A tiny on-disk comps cache. Repeat scans of the same item cost nothing. */
export class CachedCompsProvider implements CompsProvider {
  readonly id = "cache";
  readonly local = true;
  private mem = new Map<string, { at: number; result: CompsResult }>();

  constructor(
    private inner: CompsProvider,
    private ttlMs = 6 * 60 * 60 * 1000,
    private persist?: (key: string, entry: { at: number; result: CompsResult }) => void,
    private restore?: () => Record<string, { at: number; result: CompsResult }>,
  ) {
    if (restore) {
      for (const [k, v] of Object.entries(restore())) this.mem.set(k, v);
    }
  }

  async available(): Promise<boolean> {
    return this.inner.available();
  }

  private key(q: CompsQuery): string {
    return `${q.identification.condition}|${compsQueryFor(q.identification).toLowerCase()}`;
  }

  async search(q: CompsQuery): Promise<CompsResult> {
    const k = this.key(q);
    const hit = this.mem.get(k);
    if (hit && Date.now() - hit.at < this.ttlMs) {
      return { ...hit.result, source: "cache", basis: `Cached market data — ${hit.result.basis}` };
    }
    const fresh = await this.inner.search(q);
    const entry = { at: Date.now(), result: fresh };
    this.mem.set(k, entry);
    this.persist?.(k, entry);
    return fresh;
  }
}

/** Applies the asking→sold haircut and rescales a summary. */
export function applyAskingDiscount(result: CompsResult): CompsResult {
  if (!result.summary || result.summary.count === 0) return result;
  const f = ASKING_TO_SOLD_FACTOR;
  return {
    ...result,
    summary: {
      ...result.summary,
      low: round2(result.summary.low * f),
      median: round2(result.summary.median * f),
      high: round2(result.summary.high * f),
      mean: round2(result.summary.mean * f),
    },
  };
}
