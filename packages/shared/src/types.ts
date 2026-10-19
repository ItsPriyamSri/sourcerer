/**
 * Sourcerer domain model.
 *
 * Everything here is pure data. No network, no model, no framework. That matters:
 * the parts a reseller's money depends on (fee math, margin, the verdict) are
 * deterministic, unit-testable, and identical whether the app is online or offline.
 */

export type Condition = "new" | "like_new" | "good" | "fair" | "poor" | "unknown";

export type MarketplaceId = "ebay" | "mercari" | "poshmark" | "depop" | "etsy" | "facebook";

export type VerdictLabel = "BUY" | "MAYBE" | "PASS";

/** Where a number came from. Shown in the UI — we never launder an estimate as a comp. */
export type DataSource = "live" | "local_history" | "cache" | "estimate";

/** How the resale price was produced. */
export type PriceMethod = "tabpfn" | "comps_median" | "history_median" | "heuristic";

export interface Identification {
  /** Canonical, human-readable item name, e.g. `Levi's 501 "Big E" selvedge denim, ~1966-71`. */
  title: string;
  brand?: string;
  category: string;
  /** Free-form attributes: size, colour, material, era, model... */
  attributes: Record<string, string>;
  condition: Condition;
  /** Terms to search for comps. The model's most valuable output. */
  keywords: string[];
  /** 0..1. The model's own confidence in the identification. */
  confidence: number;
  /** Anything a human should check before trusting the price ("label partly illegible"). */
  caveats?: string[];
}

export interface Comp {
  title: string;
  price: number;
  currency: string;
  condition?: string;
  soldAt?: string;
  url?: string;
  /** Asking price vs. actually sold — resellers care deeply about the difference. */
  kind: "sold" | "asking";
  source: string;
}

export interface CompsSummary {
  count: number;
  low: number;
  median: number;
  high: number;
  /** Trimmed mean — resistant to the one chancer asking 10x. */
  mean: number;
  currency: string;
}

export interface CompsResult {
  comps: Comp[];
  summary: CompsSummary | null;
  source: DataSource;
  /** Plain-English reason, shown verbatim in the UI. */
  basis: string;
  queriedAt: string;
  /** e.g. eBay item-condition id or the query string actually used. */
  queryUsed?: string;
}

export interface PriceEstimate {
  expected: number;
  low: number;
  high: number;
  /**
   * Estimated days until it sells at `expected`.
   *
   * Nothing populates this. Sale speed is recorded on sold items and shown in
   * Insights, but neither pricing engine predicts it, so it stays absent rather
   * than being filled with a plausible-looking number.
   */
  daysToSell?: number;
  method: PriceMethod;
  confidence: number;
  /** Model feature vector, kept for the "why" panel and for retraining. */
  features?: Record<string, string | number>;
  note?: string;
}

/** The economics of a flip. Every field is user-editable — these are defaults, not gospel. */
export interface CostModel {
  marketplace: MarketplaceId;
  /** Referral/final-value fee as a fraction of sale price. */
  platformFeePct: number;
  /** Payment processing fee as a fraction of sale price. */
  paymentFeePct: number;
  /** Flat payment fee per order. */
  paymentFlat: number;
  /** Outbound shipping the seller eats. */
  shippingCost: number;
  /** Packaging / supplies. */
  suppliesCost: number;
  /** Target resale-to-cost multiple. 3 means "buy at 1/3 of net resale". */
  targetMultiple: number;
  /** Never recommend a flip that nets less than this. */
  minProfit: number;
}

export interface Economics {
  buyPrice: number;
  expectedResale: number;
  /** Sale price minus all fees and seller-paid costs. */
  netProceeds: number;
  expectedProfit: number;
  /** Net proceeds / buy price. */
  multiple: number;
  /** Profit / buy price, as a fraction. */
  roi: number;
  feesTotal: number;
}

export interface Verdict {
  label: VerdictLabel;
  /** The most we would pay, given the economics and the target multiple. */
  maxOffer: number;
  /** buyPrice / maxOffer. >1 means you are overpaying. */
  offerRatio: number;
  economics: Economics;
  /** One sentence a human reads first. */
  reason: string;
  confidence: number;
}

/** A captured item: the unit of work in the app. */
export interface CapturedItem {
  id: string;
  createdAt: string;
  /** Where it came from. */
  source: "camera" | "upload" | "manual" | "voice";
  /** Small local thumbnail as a data URL (never uploaded when offline). */
  thumbnail?: string;
  imagePath?: string;
  identification: Identification;
  comps: CompsResult;
  price: PriceEstimate;
  verdict: Verdict;
  cost: CostModel;
  buyPrice?: number;
  /** Free text the user added. */
  note?: string;
  /** Set when the listing draft has been generated. */
  listing?: ListingDraft;
  status: "sourced" | "bought" | "listed" | "sold" | "passed";
  soldFor?: number;
  soldAt?: string;
}

export interface ListingDraft {
  title: string;
  description: string;
  price: number;
  category?: string;
  keywords: string[];
  /** Marketplace-specific notes ("eBay: 80 char title limit"). */
  tips?: string[];
  generatedBy: string;
  generatedAt: string;
}

export interface ScanStage {
  stage: "identify" | "comps" | "price" | "verdict" | "listing";
  status: "start" | "done" | "error" | "skipped";
  detail?: string;
  ms?: number;
}

export interface ScanRequest {
  /** Base64 data URL or raw base64 JPEG/PNG. Optional if `text` is provided. */
  image?: string;
  /** A typed description, e.g. "Levi's 501 Big E selvedge, size 32, small hole". */
  text?: string;
  /** What the seller is asking, if you already saw the price tag. */
  buyPrice?: number;
  /** Partial cost-model overrides from the UI. */
  cost?: Partial<CostModel>;
  /** Skip the comps network call. Offline mode sets this automatically. */
  offline?: boolean;
}

export interface ScanResult {
  id: string;
  createdAt: string;
  identification: Identification;
  comps: CompsResult;
  price: PriceEstimate;
  verdict: Verdict;
  cost: CostModel;
  stages: ScanStage[];
  /** Which providers actually served this scan. Powers the "what ran where" panel. */
  ran: RanLogEntry[];
  /** Total wall-clock ms. */
  totalMs: number;
}

export interface RanLogEntry {
  step: string;
  provider: string;
  /** Did it run on this device, or did data leave the machine? */
  locality: "device" | "cloud" | "none";
  ms: number;
  ok: boolean;
  detail?: string;
}

export interface Capabilities {
  /** model providers */
  llm: { provider: string; model: string; local: boolean; available: boolean; detail?: string }[];
  comps: { provider: string; local: boolean; available: boolean; detail?: string }[];
  pricing: { tabpfn: boolean; tabpfnLocal?: boolean };
  tracing: { sentry: boolean };
  voice: { elevenlabs: boolean };
  durable: { temporal: boolean };
  vector: { pgvector: boolean; provider?: string };
  /** Human-facing summary shown in the UI's "What runs where" sheet. */
  privacy: string;
}
