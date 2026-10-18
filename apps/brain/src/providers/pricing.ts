import type { PriceEstimate, CompsResult, Identification } from "@sourcerer/shared";
import { conditionAdjusted, round2, clamp, median } from "@sourcerer/shared";
import { config } from "../env.ts";

/**
 * Turning "what is it" + "what is it going for" into "what will it actually sell for".
 *
 * Two engines, one interface:
 *
 *   TabPFN        — a tabular foundation model. We fit it on *your* sold history,
 *                   so Sourcerer learns your niche, your market, your pricing.
 *                   It is a real foundation model, not a regression we shipped,
 *                   and it works from a few dozen rows, which is exactly the
 *                   regime a real solo reseller lives in.
 *
 *   Heuristic     — condition-adjusted comps median. Always available, no network,
 *                   no key. Also the fallback that keeps the app usable on day one
 *                   before you have sold anything.
 *
 * Both are honest about which one produced the number.
 */

export interface PriceFeatures {
  category: string;
  brand: string;
  condition: string;
  /** Median of the comps we found (already asking→sold adjusted). */
  compsMedian: number;
  compsCount: number;
  compsLow: number;
  compsHigh: number;
  /** How scattered the comps are — high spread means an uncertain niche. */
  compsSpread: number;
  /** Was there any live market data at all? */
  hasLiveComps: number;
}

export interface PriceContext {
  identification: Identification;
  comps: CompsResult;
}

export interface PricingEngine {
  readonly id: string;
  train(rows: TrainingRow[]): Promise<{ rows: number; modelPath: string }>;
  predict(ctx: PriceContext): Promise<PriceEstimate>;
}

export interface TrainingRow {
  title: string;
  category?: string;
  brand?: string;
  condition?: string;
  price: number;
  daysToSell?: number;
  compsMedian?: number;
  compsCount?: number;
}

export function featuresFor(ctx: PriceContext): PriceFeatures {
  const s = ctx.comps.summary;
  return {
    category: ctx.identification.category || "misc",
    brand: ctx.identification.brand || "unknown",
    condition: ctx.identification.condition || "unknown",
    compsMedian: s?.median ?? 0,
    compsCount: s?.count ?? 0,
    compsLow: s?.low ?? 0,
    compsHigh: s?.high ?? 0,
    compsSpread: s && s.median > 0 ? round2((s.high - s.low) / s.median) : 0,
    hasLiveComps: s && s.count > 0 ? 1 : 0,
  };
}

/** How confident are we, really? Driven by how much evidence we have. */
export function evidenceConfidence(ctx: PriceContext): number {
  const n = ctx.comps.summary?.count ?? 0;
  const spread = ctx.comps.summary && ctx.comps.summary.median > 0
    ? (ctx.comps.summary.high - ctx.comps.summary.low) / ctx.comps.summary.median
    : 1;
  const fromCount = clamp(n / 20, 0, 1); // 20 comps ≈ full marks
  const fromSpread = clamp(1 - spread, 0, 1);
  const fromId = clamp(ctx.identification.confidence, 0, 1);
  return round2(0.45 * fromCount + 0.25 * fromSpread + 0.3 * fromId);
}

/**
 * Heuristic engine. Deliberately simple and explainable — a reseller can look at
 * it and say "yes, that is roughly how I price things", which is what earns trust.
 */
export class HeuristicPricingEngine implements PricingEngine {
  readonly id = "heuristic";

  async train(): Promise<{ rows: number; modelPath: string }> {
    return { rows: 0, modelPath: "heuristic" };
  }

  async predict(ctx: PriceContext): Promise<PriceEstimate> {
    const s = ctx.comps.summary;
    const confidence = evidenceConfidence(ctx);

    if (s && s.count > 0) {
      const base = conditionAdjusted(s.median, ctx.identification.condition);
      const spread = s.median > 0 ? clamp((s.high - s.low) / s.median, 0.1, 0.8) : 0.4;
      return {
        expected: round2(base),
        low: round2(Math.max(1, base * (1 - spread / 2))),
        high: round2(base * (1 + spread / 2)),
        method: "comps_median",
        confidence,
        features: featuresFor(ctx) as unknown as Record<string, string | number>,
        note: "Condition-adjusted median of the market data we found.",
      };
    }

    // No market data at all. Rather than error, we give a deliberately wide,
    // low-confidence guess so the UI can say "unknown, go look at sold listings".
    return {
      expected: 0,
      low: 0,
      high: 0,
      method: "heuristic",
      confidence: 0.15,
      features: featuresFor(ctx) as unknown as Record<string, string | number>,
      note: "No market data available. Prices are a guess until you have signal or sold history.",
    };
  }
}

/**
 * TabPFN over Prior Labs' REST API.
 *
 * Flow, exactly as documented: prepare_train_set_upload → PUT signed URLs →
 * fit → prepare_test_set_upload → PUT → predict. The fitted model id is cached on
 * disk, so we fit once per history change instead of once per scan.
 *
 * Low confidence? We refuse to use TabPFN below a minimum number of training rows
 * rather than pretend a 3-row fit is meaningful.
 */
export class TabPfnPricingEngine implements PricingEngine {
  readonly id = "tabpfn";
  private fittedId: string | null = null;
  private rows = 0;

  static MIN_ROWS = 8;

  constructor(
    private token = config.tabpfn.token,
    private baseUrl = config.tabpfn.baseUrl,
    private modelPath = config.tabpfn.modelPath,
  ) {}

  available(): boolean {
    return Boolean(this.token);
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, "content-type": "application/json" };
  }

  private async putSigned(info: { signed_urls: string[]; required_headers: Record<string, string> }, body: string) {
    const url = info.signed_urls[0];
    if (!url) throw new Error("tabpfn: no signed url returned");
    const res = await fetch(url, { method: "PUT", headers: info.required_headers, body });
    if (!res.ok) throw new Error(`tabpfn upload ${res.status}`);
  }

  async train(rows: TrainingRow[]): Promise<{ rows: number; modelPath: string }> {
    if (!this.available()) throw new Error("TABPFN_TOKEN not set");
    if (rows.length < TabPfnPricingEngine.MIN_ROWS) {
      throw new Error(`need at least ${TabPfnPricingEngine.MIN_ROWS} sold items to train (have ${rows.length})`);
    }

    const cols = ["category", "brand", "condition", "comps_median", "comps_count"];
    const esc = (v: unknown) => {
      const s = String(v ?? "").replace(/"/g, "'").replace(/[\r\n]+/g, " ");
      return /[",]/.test(s) ? `"${s}"` : s;
    };
    const xCsv = [cols.join(","), ...rows.map((r) => [r.category ?? "misc", r.brand ?? "unknown", r.condition ?? "unknown", r.compsMedian ?? "", r.compsCount ?? ""].map(esc).join(","))].join("\n");
    const yCsv = ["price", ...rows.map((r) => String(r.price))].join("\n");

    const prepRes = await fetch(`${this.baseUrl}/tabpfn/prepare_train_set_upload`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ x_train_info: { format: "csv" }, y_train_info: { format: "csv" } }),
    });
    if (!prepRes.ok) throw new Error(`tabpfn prepare_train_set_upload ${prepRes.status}`);
    const prep = (await prepRes.json()) as {
      train_set_upload_id: string;
      x_train_info: { signed_urls: string[]; required_headers: Record<string, string> };
      y_train_info: { signed_urls: string[]; required_headers: Record<string, string> };
    };
    await this.putSigned(prep.x_train_info, xCsv);
    await this.putSigned(prep.y_train_info, yCsv);

    const fitRes = await fetch(`${this.baseUrl}/tabpfn/fit`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        train_set_upload_id: prep.train_set_upload_id,
        task_config: { task: "regression", tabpfn_config: { model_path: this.modelPath } },
      }),
    });
    if (!fitRes.ok) throw new Error(`tabpfn fit ${fitRes.status}: ${(await fitRes.text()).slice(0, 200)}`);
    const fit = (await fitRes.json()) as { fitted_train_set_id: string };

    this.fittedId = fit.fitted_train_set_id;
    this.rows = rows.length;
    return { rows: rows.length, modelPath: this.modelPath };
  }

  async predict(ctx: PriceContext): Promise<PriceEstimate> {
    if (!this.fittedId) throw new Error("tabpfn: not fitted");
    const f = featuresFor(ctx);
    const cols = ["category", "brand", "condition", "comps_median", "comps_count"];
    const esc = (v: unknown) => {
      const s = String(v ?? "").replace(/"/g, "'");
      return /[",]/.test(s) ? `"${s}"` : s;
    };
    const xTest = [
      cols.join(","),
      [f.category, f.brand, f.condition, f.compsMedian, f.compsCount].map(esc).join(","),
    ].join("\n");

    const prepRes = await fetch(`${this.baseUrl}/tabpfn/prepare_test_set_upload`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ fitted_train_set_id: this.fittedId, x_test_info: { format: "csv" } }),
    });
    if (!prepRes.ok) throw new Error(`tabpfn prepare_test_set_upload ${prepRes.status}`);
    const prep = (await prepRes.json()) as {
      test_set_upload_id: string;
      x_test_info: { signed_urls: string[]; required_headers: Record<string, string> };
    };
    await this.putSigned(prep.x_test_info, xTest);

    const predRes = await fetch(`${this.baseUrl}/tabpfn/predict`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        test_set_upload_id: prep.test_set_upload_id,
        fitted_train_set_id: this.fittedId,
        task_config: { task: "regression", predict_params: { output_type: "quantiles", quantiles: [0.1, 0.5, 0.9] } },
      }),
    });
    if (!predRes.ok) throw new Error(`tabpfn predict ${predRes.status}`);
    const pred = (await predRes.json()) as { prediction: number[] | number[][] };

    // Regression quantiles come back per-row; be liberal about the exact nesting.
    const row = Array.isArray(pred.prediction[0]) ? (pred.prediction[0] as number[]) : (pred.prediction as number[]);
    const [p10, p50, p90] = row.length >= 3 ? row : [row[0]! * 0.8, row[0]!, row[0]! * 1.2];

    return {
      expected: round2(p50 ?? 0),
      low: round2(Math.max(1, p10 ?? 0)),
      high: round2(p90 ?? 0),
      method: "tabpfn",
      confidence: clamp(0.5 + Math.min(this.rows, 60) / 200, 0.5, 0.85),
      features: f as unknown as Record<string, string | number>,
      note: `TabPFN-3.5 fitted on your last ${this.rows} sold items.`,
    };
  }
}

/** Chains engines: prefer the trained model, fall back to the heuristic. */
export class ChainedPricingEngine implements PricingEngine {
  readonly id = "chained";
  constructor(
    private primary: PricingEngine,
    private fallback: PricingEngine,
  ) {}

  async train(rows: TrainingRow[]) {
    return this.primary.train(rows);
  }

  async predict(ctx: PriceContext): Promise<PriceEstimate> {
    try {
      return await this.primary.predict(ctx);
    } catch {
      return this.fallback.predict(ctx);
    }
  }
}

export function historyMedian(rows: TrainingRow[]): number {
  return round2(median(rows.map((r) => r.price).filter((p) => Number.isFinite(p))));
}
