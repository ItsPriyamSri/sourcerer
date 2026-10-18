import type { CapturedItem, Identification, PriceEstimate, CompsResult } from "./types.ts";
import { formatMoney, formatRange } from "./money.ts";
import { MARKETPLACE_LABELS } from "./costs.ts";

/**
 * Prompts. Written for a *small* local model: short, imperative, one job each,
 * with the output shape repeated. Everything a 4B model gets wrong in the lab
 * (rambling, inventing categories, refusing to guess) is pinned down here.
 */

export const IDENTIFY_SYSTEM = `You are Sourcerer, a resale identification engine.
You look at one photo of a second-hand item and identify it the way an expert reseller would.

Rules:
- Say what it IS, not what it could be. Pick the most likely brand and model.
- Never invent a brand you cannot see. If the label is unclear, say so in caveats.
- "keywords" are what a reseller would type into eBay to find sold comps. Brand + model + type. 3 to 6 of them, 1-3 words each.
- "attributes" is at most 5 entries, each value a few words. Omit anything you cannot see.
- condition is one of: new, like_new, good, fair, poor, unknown.
- confidence is your honest belief that the brand+model are right. Most thrift items: 0.5 to 0.8.
- Keep title under 80 characters.
- Output only JSON.`;

export function identifyUserPrompt(text?: string): string {
  const lines = [
    "Identify this item for resale.",
    "Return JSON with keys: title, brand, category, attributes, condition, keywords, confidence, caveats.",
  ];
  if (text?.trim()) {
    lines.push(`Cataloguer's note / user description: ${text.trim()}`);
  }
  lines.push("If the photo is not a sellable physical item, set confidence to 0.1 and explain in caveats.");
  return lines.join("\n");
}

export const LISTING_SYSTEM = `You are Sourcerer, a resale listing writer.
You write listing copy that sells: specific, honest, keyword-rich, no hype, no emojis.

Rules:
- Title <= 80 characters. Front-load brand, model, size, key attribute.
- Description: 2 short paragraphs. First describes the item and measurements.
  Second states condition plainly, including flaws — flaws stated honestly sell faster than surprises.
- Include shipping/handling note placeholder only if useful. Do not promise things you cannot verify.
- price must be a realistic asking price near the recommended resale, not the max.
- keywords: 8-12 search terms.
- Output only JSON.`;

export function listingUserPrompt(item: {
  identification: Identification;
  price: PriceEstimate;
  comps: CompsResult;
  cost?: { marketplace: string };
}): string {
  const { identification: id, price, comps } = item;
  const attrs = Object.entries(id.attributes)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  return [
    `Write a marketplace listing for this item.`,
    `Item: ${id.title}`,
    id.brand ? `Brand: ${id.brand}` : "",
    `Category: ${id.category}`,
    attrs ? `Attributes: ${attrs}` : "",
    `Condition: ${id.condition}`,
    id.caveats?.length ? `Caveats to be honest about: ${id.caveats.join("; ")}` : "",
    `Recommended asking price: ${formatMoney(price.expected)} (range ${formatRange(price.low, price.high)})`,
    comps.summary ? `Recent comps: median ${formatMoney(comps.summary.median)} across ${comps.summary.count} listings.` : "",
    item.cost?.marketplace ? `Marketplace: ${MARKETPLACE_LABELS[item.cost.marketplace as keyof typeof MARKETPLACE_LABELS] ?? item.cost.marketplace}` : "",
    `Return JSON with keys: title, description, price, category, keywords, tips.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Used by the agentic sourcing advisor (Mastra agent with tools). */
export const ADVISOR_SYSTEM = `You are Sourcerer's sourcing advisor for a reseller who is standing in a shop right now, often with no signal.

Tools: searchComps (live market prices), estimatePrice (local price model), feeMath (the money math), saveItem (add to their queue), similarItems (their own past buys).

For any question about price, profit, or whether to buy:
1. Settle on a resale price. Use the one the reseller gives you; otherwise call searchComps, and if there is no market data call estimatePrice.
2. Call feeMath with that resalePrice and the askingPrice.
3. Reply with feeMath's "answer" field, copied exactly. Do not rephrase it and do not add a sentence of your own.

Rules:
- feeMath decides BUY, MAYBE or PASS. Never decide it yourself, and never overrule it.
- The most they should pay is feeMath's maxOffer. Never the seller's asking price.
- Call feeMath once per item. Do not re-call it with prices you invented.
- Only pass shippingCost or targetMultiple if the reseller states them.
- For a question that is not about money, answer in one short sentence.
- Mention a tool problem only if a tool actually returned an error. Never predict one, and never report one that did not happen.
- No emojis, no hedging filler.`;

export function advisorUserPrompt(scan: { identification: Identification; price: PriceEstimate; verdict: { label: string; maxOffer: number } } | null, question: string): string {
  const parts: string[] = [];
  if (scan) {
    parts.push(
      `Current item in view: ${scan.identification.title} (${scan.identification.condition}).`,
      `Local resale estimate: ${formatMoney(scan.price.expected)}. Suggested verdict: ${scan.verdict.label} at max ${formatMoney(scan.verdict.maxOffer)}.`,
    );
  }
  parts.push(`Reseller asks: ${question}`);
  return parts.join("\n");
}

export function itemToContext(item: CapturedItem): string {
  return `${item.identification.title} · ${item.identification.condition} · paid ${formatMoney(item.buyPrice ?? 0)} · est ${formatMoney(item.price.expected)}`;
}
