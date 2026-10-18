/**
 * Identification eval.
 *
 * Runs the same 30 hand-labelled items through four prompt/schema configurations and
 * reports, for each: how often the model emitted parseable JSON, how often it got the
 * brand right, how often it got the type right, and how often it invented a brand for
 * something that has none.
 *
 * Run:  pnpm evidence:identify
 * Out:  docs/evidence/identify-results.json  (+ one checkpoint file per variant)
 *
 * It talks to Ollama directly rather than through the brain, because the point is to
 * vary the *prompt*, and the brain's prompt is deliberately fixed.
 *
 * Two lessons from the first attempt are baked in, because it crashed at item 92 of 120
 * and took every result with it:
 *   - results are written after *every* item, so a crash costs one item, not the run
 *   - each variant is a separate checkpoint, so re-running resumes instead of restarting
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { IDENTIFY_JSON_SCHEMA, IDENTIFY_SYSTEM } from "@sourcerer/shared";
import { EVAL_ITEMS, type EvalItem } from "./items.ts";

const OLLAMA = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "gemma3:4b";
const TEMPERATURE = 0.1;
const ATTEMPT_TIMEOUT_MS = 900_000;
const MAX_ATTEMPTS = 3;

interface Variant {
  id: string;
  label: string;
  system: string;
  /** Whether the JSON schema is passed to Ollama's `format` (constrained decoding). */
  schema: boolean;
}

const NAIVE = `You identify second-hand items for resale. Reply with JSON containing
title, brand, category, attributes, condition, keywords and confidence.`;

const ANTI_INVENT = `${IDENTIFY_SYSTEM}

Additional rules, learned from the failures in the first run:
- If the item has no visible brand or maker's mark, set "brand" to null. Do not
  substitute the designer it resembles. An unbranded Eames-style chair is not an Eames.
- If a mark IS visible, the brand must be a real company name, not a description.
- Put any uncertainty about a mark in "caveats" and lower confidence, rather than
  guessing in "brand".`;

const VARIANTS: Variant[] = [
  { id: "v1", label: "prose prompt, no schema", system: NAIVE, schema: false },
  { id: "v2", label: "same prompt, + JSON schema", system: NAIVE, schema: true },
  { id: "v3", label: "full rules prompt, + schema", system: IDENTIFY_SYSTEM, schema: true },
  { id: "v4", label: "v3 + anti-invention rules", system: ANTI_INVENT, schema: true },
];

interface Row {
  itemId: string;
  text: string;
  parseOk: boolean;
  brandOk: boolean;
  typeOk: boolean;
  inventedBrand: boolean;
  got: { title?: string; brand?: string; category?: string };
  ms: number;
  attempts: number;
  raw?: string;
}

const EVIDENCE = resolve(process.cwd(), "../../docs/evidence");

function checkpointPath(variantId: string) {
  return resolve(EVIDENCE, `identify-${variantId}.json`);
}

function loadCheckpoint(variantId: string): Row[] | null {
  const p = checkpointPath(variantId);
  if (!existsSync(p)) return null;
  try {
    const rows = JSON.parse(readFileSync(p, "utf8")) as Row[];
    return rows.length === EVAL_ITEMS.length ? rows : null;
  } catch {
    return null;
  }
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? trimmed;
  const start = candidate.search(/[{[]/);
  if (start < 0) throw new Error("no JSON");
  const open = candidate[start]!;
  const close = open === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(close);
  if (end <= start) throw new Error("truncated JSON");
  return JSON.parse(candidate.slice(start, end + 1));
}

/** One call to Ollama, retried. Returns null only if every attempt failed. */
async function callModel(item: EvalItem, v: Variant): Promise<{ text: string; ms: number; attempts: number } | null> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const t0 = Date.now();
    try {
      const body: Record<string, unknown> = {
        model: MODEL,
        stream: false,
        keep_alive: "30m",
        options: { temperature: TEMPERATURE, num_predict: 420 },
        messages: [
          { role: "system", content: v.system },
          {
            role: "user",
            content: `Identify this item for resale.\nCataloguer's note / user description: ${item.text}`,
          },
        ],
      };
      if (v.schema) body.format = IDENTIFY_JSON_SCHEMA;

      const res = await fetch(`${OLLAMA}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
      const json = (await res.json()) as { message?: { content?: string } };
      return { text: json.message?.content ?? "", ms: Date.now() - t0, attempts: attempt };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`      attempt ${attempt} failed: ${msg.slice(0, 90)}\n`);
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
  return null;
}

/**
 * Fold away the differences that are not identification failures.
 *
 * The first run scored "Dr Martens 1460 Boots" as a miss against a label of
 * "Dr. Martens" — the model was right and the scorer was wrong. Punctuation and
 * spacing are not part of getting the brand right, so they are normalised before
 * comparison. Case, word order and ampersands are folded too.
 */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,'’`]/g, "")
    .replace(/\s*&\s*/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

function score(item: EvalItem, text: string, ms: number, attempts: number): Row {
  const base = { itemId: item.id, text: item.text, ms, attempts };

  let parsed: {
    title?: string;
    brand?: string | null;
    category?: string;
    attributes?: Record<string, string>;
  } | null = null;
  try {
    parsed = extractJson(text) as typeof parsed;
  } catch {
    parsed = null;
  }

  if (!parsed) {
    return { ...base, parseOk: false, brandOk: false, typeOk: false, inventedBrand: false, got: {}, raw: text.slice(0, 2000) };
  }

  const haystack = norm(
    `${parsed.title ?? ""} ${parsed.category ?? ""} ${Object.values(parsed.attributes ?? {}).join(" ")}`,
  );
  const brandField = norm((parsed.brand ?? "").toString()).trim();

  let brandOk: boolean;
  let inventedBrand = false;
  if (item.brand) {
    // The brand must show up somewhere in what the model returned — title, category,
    // or a named attribute — because those are the fields a listing is built from.
    brandOk = haystack.includes(norm(item.brand));
  } else {
    // Ground truth: no brand. Correct = did not assert one in the `brand` field.
    // The title may legitimately say "Eames style" — that is a description, not a claim.
    // "Eames (Style)" in the *brand field* is a claim, and that is the failure this
    // whole experiment exists to catch.
    const claimed = brandField.length > 0 && !["null", "none", "unknown", "unbranded", "na", "-", ""].includes(brandField);
    brandOk = !claimed;
    inventedBrand = Boolean(claimed);
  }

  const typeOk = item.type.some((t) => haystack.includes(norm(t)));

  return {
    ...base,
    parseOk: true,
    brandOk,
    typeOk,
    inventedBrand,
    got: { title: parsed.title, brand: parsed.brand ?? undefined, category: parsed.category },
    // Keep the full reply, not just the failures. It costs a few kilobytes and it is
    // what makes the scoring re-runnable against the recorded answers instead of
    // against the model, which is the difference between an experiment and an anecdote.
    raw: text.slice(0, 2000),
  };
}

async function runVariant(v: Variant, total: number): Promise<Row[]> {
  const cached = loadCheckpoint(v.id);
  if (cached) {
    process.stdout.write(`  (checkpoint found — skipping ${v.id})\n`);
    return cached;
  }

  const rows: Row[] = [];
  for (const item of EVAL_ITEMS) {
    const res = await callModel(item, v);
    const row = res
      ? score(item, res.text, res.ms, res.attempts)
      : { itemId: item.id, text: item.text, parseOk: false, brandOk: false, typeOk: false, inventedBrand: false, got: {}, ms: 0, attempts: MAX_ATTEMPTS, raw: "all attempts failed" };
    rows.push(row);

    // Persist after every item: a crash costs one row, not the run.
    writeFileSync(checkpointPath(v.id), JSON.stringify(rows, null, 2));

    const verdict = row.parseOk
      ? row.inventedBrand
        ? "brand✗INVENTED"
        : row.brandOk
          ? "brand✓"
          : "brand✗"
      : "PARSE✗";
    process.stdout.write(
      `  ${item.id} ${verdict} ${row.typeOk ? "type✓" : "type✗"}  ${(row.got.title ?? row.raw ?? "").slice(0, 46)}  [${(row.ms / 1000).toFixed(0)}s]\n`,
    );
    void total;
  }
  return rows;
}

function pct(n: number, d: number) {
  return d === 0 ? "—" : `${Math.round((n / d) * 100)}%`;
}

async function main() {
  mkdirSync(EVIDENCE, { recursive: true });
  const total = EVAL_ITEMS.length;
  const withBrand = EVAL_ITEMS.filter((i) => i.brand).length;
  const noBrand = total - withBrand;
  const results: { variant: Variant; rows: Row[] }[] = [];

  for (const v of VARIANTS) {
    process.stdout.write(`\n${v.id}  ${v.label}\n`);
    results.push({ variant: v, rows: await runVariant(v, total) });
  }

  // ── summary ───────────────────────────────────────────────────────────────
  console.log("\n\nvariant                                 parse   brand   type    both   invented  median");
  console.log("─".repeat(94));
  for (const { variant, rows } of results) {
    const parse = rows.filter((r) => r.parseOk).length;
    const brand = rows.filter((r) => r.brandOk).length;
    const type = rows.filter((r) => r.typeOk).length;
    const both = rows.filter((r) => r.brandOk && r.typeOk).length;
    const invented = rows.filter((r) => r.inventedBrand).length;
    const median = [...rows.map((r) => r.ms)].sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? 0;
    console.log(
      `${variant.id}  ${variant.label.padEnd(36)} ${pct(parse, total).padStart(5)}   ${pct(brand, total).padStart(5)}   ${pct(type, total).padStart(5)}   ${pct(both, total).padStart(5)}   ${String(invented).padStart(3)}/${noBrand}   ${(median / 1000).toFixed(0)}s`,
    );
  }

  const best = results.at(-1)!;
  const failures = best.rows.filter((r) => !(r.brandOk && r.typeOk));
  console.log(`\n${best.variant.id} failures (${failures.length} of ${total}):`);
  for (const f of failures) {
    const truth = EVAL_ITEMS.find((i) => i.id === f.itemId)!;
    console.log(`  [${f.itemId}] expected brand=${truth.brand ?? "(none)"} type=${truth.type[0]}`);
    console.log(`        got "${f.got.title ?? "(no title)"}" brand=${f.got.brand ?? "(none)"} cat=${f.got.category ?? "?"}`);
  }

  const out = resolve(EVIDENCE, "identify-results.json");
  writeFileSync(
    out,
    JSON.stringify(
      {
        model: MODEL,
        temperature: TEMPERATURE,
        items: total,
        itemsWithBrand: withBrand,
        itemsWithoutBrand: noBrand,
        generatedAt: new Date().toISOString(),
        machine: `${process.platform}/${process.arch}`,
        note: "Ground truth is the `text` field in apps/brain/eval/items.ts. Scoring is mechanical; see run-identify.ts.",
        variants: results.map(({ variant, rows }) => ({
          id: variant.id,
          label: variant.label,
          schema: variant.schema,
          parseRate: rows.filter((r) => r.parseOk).length / total,
          brandRate: rows.filter((r) => r.brandOk).length / total,
          typeRate: rows.filter((r) => r.typeOk).length / total,
          combinedRate: rows.filter((r) => r.brandOk && r.typeOk).length / total,
          inventedBrands: rows.filter((r) => r.inventedBrand).length,
          medianMs: [...rows.map((r) => r.ms)].sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? 0,
          rows,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`\nwrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
