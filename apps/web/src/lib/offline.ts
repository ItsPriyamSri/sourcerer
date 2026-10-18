import {
  conditionAdjusted,
  decideVerdict,
  defaultCostModel,
  mergeCostModel,
  round2,
  summariseComps,
  type CapturedItem,
  type Comp,
  type CompsResult,
  type CostModel,
  type Identification,
  type PriceEstimate,
  type RanLogEntry,
  type ScanRequest,
  type ScanResult,
  type ScanStage,
} from "@sourcerer/shared";

/**
 * The genuinely-offline path.
 *
 * When there is no brain and no network, Sourcerer still answers — using the item
 * text plus the reseller's *own* sold history, which is the most honest comps source
 * that exists for a one-person business. The result is visibly tagged `estimate`
 * (principle 4: never dress an estimate up as a live comp).
 */

const STOP = new Set([
  "the", "a", "an", "and", "or", "for", "with", "size", "sz", "new", "used", "vintage",
  "small", "medium", "large", "xl", "color", "colour", "x", "of", "in", "on",
]);

export function keywordsFrom(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .slice(0, 8);
}

function identificationFromText(text: string): Identification {
  const keywords = keywordsFrom(text);
  const brandish = text.split(/\s+/).slice(0, 2).join(" ");
  return {
    title: text.trim() || "Unidentified item",
    brand: brandish || undefined,
    category: keywords[0] ?? "misc",
    attributes: {},
    condition: /new|mint|sealed|nwt|bnib/i.test(text) ? "like_new" : /damaged|broken|torn|hole/i.test(text) ? "fair" : "good",
    keywords,
    confidence: 0.35,
    caveats: ["Priced offline from your own sold history and category heuristics — no live comps."],
  };
}

function overlapScore(a: string[], b: string[]): number {
  const bs = new Set(b);
  let hit = 0;
  for (const w of a) if (bs.has(w)) hit++;
  return hit;
}

export interface OfflineScanInput extends ScanRequest {
  /** The user's sold + saved items, already loaded from IndexedDB. */
  history: CapturedItem[];
}

export function runOfflineScan(input: OfflineScanInput, onStage?: (s: ScanStage) => void): ScanResult {
  const started = performance.now();
  const ran: RanLogEntry[] = [];
  const stages: ScanStage[] = [];
  const step = <T>(stage: ScanStage["stage"], detail: string, fn: () => T): T => {
    onStage?.({ stage, status: "start", detail });
    const t0 = performance.now();
    try {
      const out = fn();
      const ms = Math.round(performance.now() - t0);
      const frame: ScanStage = { stage, status: "done", detail, ms };
      stages.push(frame);
      onStage?.(frame);
      ran.push({ step: stage, provider: "on-device (this browser)", locality: "device", ms, ok: true, detail });
      return out;
    } catch (err) {
      const ms = Math.round(performance.now() - t0);
      stages.push({ stage, status: "error", detail: String(err), ms });
      ran.push({ step: stage, provider: "on-device (this browser)", locality: "device", ms, ok: false, detail: String(err) });
      throw err;
    }
  };

  const text = (input.text ?? "").trim();
  const identification = step("identify", "Read the description on-device", () => identificationFromText(text));

  const soldish = input.history.filter((i) => i.status === "sold" || i.soldFor);
  const comps = step("comps", "Search your own sold history", (): CompsResult => {
    const kw = identification.keywords;
    const scored = soldish
      .map((i) => ({ i, score: overlapScore(kw, keywordsFrom(i.identification.title)) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);

    const list: Comp[] = scored.map(({ i }) => ({
      title: i.identification.title,
      price: i.soldFor ?? i.verdict.economics.expectedResale,
      currency: "USD",
      condition: i.identification.condition,
      soldAt: i.soldAt,
      kind: "sold",
      source: "your sold history",
    }));

    const sameCategory = soldish.filter((i) => i.identification.category === identification.category);
    const categoryList: Comp[] = sameCategory.slice(0, 12).map((i) => ({
      title: i.identification.title,
      price: i.soldFor ?? i.verdict.economics.expectedResale,
      currency: "USD",
      condition: i.identification.condition,
      soldAt: i.soldAt,
      kind: "sold",
      source: "your sold history",
    }));

    const use = list.length >= 3 ? list : categoryList.length >= 1 ? categoryList : list;
    return {
      comps: use,
      summary: summariseComps(use),
      source: use.length ? "local_history" : "estimate",
      basis: use.length
        ? `${use.length} item${use.length === 1 ? "" : "s"} from your own sold history`
        : "No matching history yet — category heuristic only",
      queriedAt: new Date().toISOString(),
    };
  });

  const price = step("price", "Condition-adjusted local estimate", (): PriceEstimate => {
    const summary = comps.summary;
    if (summary) {
      const expected = conditionAdjusted(summary.median, identification.condition);
      return {
        expected: round2(expected),
        low: round2(conditionAdjusted(summary.low, identification.condition)),
        high: round2(conditionAdjusted(summary.high, identification.condition)),
        method: "history_median",
        confidence: Math.min(0.85, 0.4 + summary.count * 0.05),
        note: "Median of your sold history, adjusted for condition.",
        features: { samples: summary.count, median: summary.median, condition: identification.condition },
      };
    }
    // Cold start: a deliberately conservative guess so the verdict leans PASS.
    const base = 18 + identification.keywords.length * 4;
    return {
      expected: base,
      low: round2(base * 0.6),
      high: round2(base * 1.5),
      method: "heuristic",
      confidence: 0.25,
      note: "Nothing to compare against yet. Sell a few items and this gets sharp fast.",
    };
  });

  const cost: CostModel = mergeCostModel(defaultCostModel(input.cost?.marketplace ?? "ebay"), input.cost);
  const buyPrice = input.buyPrice ?? 0;

  const verdict = step("verdict", "Fee math and margin check", () =>
    decideVerdict(buyPrice, price.expected, cost, price.confidence),
  );

  const result: ScanResult = {
    id: `off-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    identification,
    comps,
    price,
    verdict,
    cost,
    stages,
    ran,
    totalMs: Math.round(performance.now() - started),
  };
  return result;
}
