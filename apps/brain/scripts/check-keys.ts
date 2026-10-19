import { pathToFileURL } from "node:url";
import { Client } from "pg";
import * as Sentry from "@sentry/node";
import { Connection } from "@temporalio/client";
import { config } from "../src/env.ts";

/**
 * Live verification of every optional integration.
 *
 * This is the gate between "I put a key in .env" and "the integration actually
 * works": every probe below is a real request against the provider.
 * A key that is absent is not a failure — it is `SKIPPED(no key)`, because the
 * whole point of Sourcerer is that it runs with zero keys. A key that is present
 * and broken is a failure, and the run exits non-zero.
 *
 * Rules this file holds itself to:
 *
 *  - Nothing is faked. If a probe cannot be verified against documented API
 *    surface, the row says `SHAPE-ONLY` with the reason, never `PASS`.
 *  - Probes are read-only, cheap and free. SerpApi's Account API is explicitly
 *    "free of charge ... not counted toward your monthly quota"; Prior Labs'
 *    cost estimate "does not consume tokens or reserve capacity". Neither
 *    performs a search or a fit.
 *    One exception, and it is disclosed rather than hidden: a *scoped* ElevenLabs
 *    key cannot answer the read-only route at all, so the probe transcribes a 0.2 s
 *    silent clip instead — the app's real voice-in call, the only thing that proves
 *    the scope is granted. It costs a fraction of a credit and stores nothing.
 *  - No secret is ever printed. At worst the first four characters.
 *  - A hung network never hangs the operator: every probe runs under a short
 *    deadline inside a concurrent overall budget.
 *
 * Run it with `pnpm keys:check`. cwd must be `apps/brain`, which is where
 * `src/env.ts` looks for `.env`.
 */

export type Status = "PASS" | "FAIL" | "SKIPPED(no key)" | "SHAPE-ONLY";

export interface CheckResult {
  /** Display name of the integration. */
  name: string;
  status: Status;
  /** Short, human reason — the actual HTTP status or error message. Never a secret. */
  reason: string;
  /** Was there enough configuration to run a live probe? A missing key is not a failure. */
  configured: boolean;
  /** For a configured-but-failing row, the exact next command or URL. */
  fix?: string;
}

export interface ProbeOutcome {
  status: Exclude<Status, "SKIPPED(no key)">;
  reason: string;
}

/** Short per-probe deadline, and a hard overall budget across all of them. */
const PER_PROBE_MS = 6_000;
const TOTAL_BUDGET_MS = 18_000;

/** Never print a secret. At most the first four characters, then an ellipsis. */
export function redact(secret: string): string {
  return secret.length <= 4 ? "…" : `${secret.slice(0, 4)}…`;
}

/**
 * Exit 1 only when something that was actually configured failed. An absent key
 * never fails the run — that is a fully supported configuration.
 */
export function decideExit(results: readonly CheckResult[]): number {
  return results.some((r) => r.configured && r.status === "FAIL") ? 1 : 0;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Reject (and abort the underlying work) if `work` has not settled within `ms`. */
function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      ctrl.abort();
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    work(ctrl.signal).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Run one probe, or report `SKIPPED(no key)` when there is nothing configured.
 * When it is skipped, `probe` is never called — there is nothing to reach out to.
 */
export async function runProbe(
  spec: {
    name: string;
    configured: boolean;
    fix?: string;
    probe?: (signal: AbortSignal) => Promise<ProbeOutcome>;
  },
  budgetMs: number = PER_PROBE_MS,
): Promise<CheckResult> {
  if (!spec.configured || !spec.probe) {
    return {
      name: spec.name,
      status: "SKIPPED(no key)",
      reason: "not configured — nothing to verify",
      configured: false,
    };
  }
  try {
    const outcome = await withTimeout(spec.probe, budgetMs, spec.name);
    return {
      name: spec.name,
      status: outcome.status,
      reason: outcome.reason,
      configured: true,
      ...(outcome.status === "FAIL" && spec.fix ? { fix: spec.fix } : {}),
    };
  } catch (err) {
    return { name: spec.name, status: "FAIL", reason: errMsg(err), configured: true, fix: spec.fix };
  }
}

interface JsonResponse {
  status: number;
  body: unknown;
}

async function getJson(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<JsonResponse> {
  const res = await fetch(url, { headers, signal });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    /* a non-JSON body still has a status worth reporting */
  }
  return { status: res.status, body };
}

/** A configured model name and an on-disk tag count as the same model. */
function hasModel(present: ReadonlySet<string>, want: string): boolean {
  if (present.has(want)) return true;
  return present.has(want.includes(":") ? want : `${want}:latest`);
}

// ── Ollama — the local brain. No key, but it must never be faked. ────────────
// doc: https://github.com/ollama/ollama/blob/main/docs/api.md#list-local-models
async function probeOllama(signal: AbortSignal): Promise<ProbeOutcome> {
  const base = config.ollama.baseUrl.replace(/\/+$/, "");
  const { status, body } = await getJson(`${base}/api/tags`, { accept: "application/json" }, signal);
  if (status !== 200) return { status: "FAIL", reason: `GET /api/tags → HTTP ${status}` };

  const models = ((body as { models?: Array<{ name?: string; model?: string }> } | undefined)?.models ?? []);
  const present = new Set<string>();
  for (const m of models) {
    if (m.name) present.add(m.name);
    if (m.model) present.add(m.model);
  }

  const wanted = [
    config.ollama.model,
    config.ollama.textModel,
    config.ollama.toolModel,
    config.ollama.embedModel,
  ].filter(Boolean);
  const missing = wanted.filter((w) => !hasModel(present, w));
  if (missing.length) {
    return { status: "FAIL", reason: `missing model(s): ${missing.join(", ")} — run pnpm model:pull` };
  }
  return { status: "PASS", reason: `${base} — ${models.length} model(s); all ${wanted.length} configured present` };
}

// ── SerpApi — live market comps. ─────────────────────────────────────────────
// doc: https://serpapi.com/account-api — "Account API is free of charge, and
// using it will not be counted toward your monthly quota." No search credit.
async function probeSerpApi(signal: AbortSignal): Promise<ProbeOutcome> {
  const key = config.serpapi.apiKey;
  const url = `https://serpapi.com/account.json?api_key=${encodeURIComponent(key)}`;
  const { status, body } = await getJson(url, { accept: "application/json" }, signal);
  if (status === 200 && body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const left = b.total_searches_left ?? b.plan_searches_left ?? "?";
    return { status: "PASS", reason: `account ok — ${String(left)} searches left` };
  }
  return { status: "FAIL", reason: `HTTP ${status} (key ${redact(key)})` };
}

// ── Backboard — the hosted brain. ────────────────────────────────────────────
// doc: https://docs.backboard.io/api-reference/threads/list — GET /threads with
// the `X-API-Key` header. Listing threads is read-only and spends no tokens.
async function probeBackboard(signal: AbortSignal): Promise<ProbeOutcome> {
  const key = config.backboard.apiKey;
  const base = config.backboard.baseUrl.replace(/\/+$/, "");
  const { status } = await getJson(`${base}/threads?limit=1`, { "X-API-Key": key, accept: "application/json" }, signal);
  if (status === 200) return { status: "PASS", reason: `GET /threads → HTTP 200 (key ${redact(key)})` };
  if (status === 401 || status === 403) return { status: "FAIL", reason: `HTTP ${status} — key rejected (key ${redact(key)})` };
  // A 404/405 means the documented route moved; we cannot verify the key, so we
  // say so rather than claiming a pass.
  if (status === 404 || status === 405) return { status: "SHAPE-ONLY", reason: `GET /threads → HTTP ${status} — documented route not found` };
  return { status: "FAIL", reason: `GET /threads → HTTP ${status} (key ${redact(key)})` };
}

// ── TabPFN / Prior Labs — the local price model. ─────────────────────────────
// doc: https://docs.priorlabs.ai/api/rest-quickstart — "Use the /tabpfn/*
// JSON endpoints." §7: "Requesting an estimate does not consume tokens or
// reserve capacity." So POST /tabpfn/estimate_cost is a free auth probe; Prior
// Labs publishes no account/whoami REST route.
async function probeTabpfn(signal: AbortSignal): Promise<ProbeOutcome> {
  const token = config.tabpfn.token;
  const base = config.tabpfn.baseUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/tabpfn/estimate_cost`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ train_rows: 1, raw_columns: 1 }),
    signal,
  });
  if (res.ok) return { status: "PASS", reason: `POST /tabpfn/estimate_cost → HTTP ${res.status} (key ${redact(token)})` };
  if (res.status === 401 || res.status === 403) return { status: "FAIL", reason: `HTTP ${res.status} — token rejected (key ${redact(token)})` };
  if (res.status === 404 || res.status === 405) return { status: "SHAPE-ONLY", reason: `POST /tabpfn/estimate_cost → HTTP ${res.status} — documented route not found` };
  return { status: "FAIL", reason: `POST /tabpfn/estimate_cost → HTTP ${res.status} (key ${redact(token)})` };
}

// ── Tiger Data / pgvector — vector memory. ───────────────────────────────────
async function probeDatabase(signal: AbortSignal): Promise<ProbeOutcome> {
  const client = new Client({
    connectionString: config.db.url,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    query_timeout: 5_000,
  });
  const onAbort = (): void => {
    void client.end().catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    await client.connect();
    await client.query("SELECT 1");
    const ext = await client.query<{ extversion: string }>(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
    );
    const version = ext.rows[0]?.extversion;
    if (!version) {
      return { status: "FAIL", reason: "connected, but pgvector is not installed (CREATE EXTENSION vector)" };
    }
    return { status: "PASS", reason: `connected — pgvector ${version}` };
  } finally {
    signal.removeEventListener("abort", onAbort);
    await client.end().catch(() => {});
  }
}

// ── ElevenLabs — voice in and out. ───────────────────────────────────────────
// doc: https://elevenlabs.io/docs/api-reference/user/get (GET /v1/user) and
// https://elevenlabs.io/docs/api-reference/authentication (`xi-api-key` header).
//
// Keys are now created scoped: a fresh key answers 401 on every route it was not granted,
// `user_read` included. Since the app never calls /v1/user, testing it alone reported a
// perfectly good key as "rejected" — a false alarm from the one command whose whole job is
// telling the truth. So when the key authenticates but lacks a scope, probe the path the
// app actually uses instead of the one that happens to be convenient.

/** The missing scope out of an ElevenLabs error body, if it is a scoping error. */
export function missingScope(body: unknown): string | null {
  const detail = (body as { detail?: { status?: string; message?: string } } | null)?.detail;
  if (detail?.status !== "missing_permissions") return null;
  return /permission (\w+)/.exec(detail.message ?? "")?.[1] ?? "unknown";
}

/**
 * A 0.2 s silent WAV, built here rather than committed as a blob.
 *
 * speech-to-text is the app's real voice-in call and the only way to prove the scope is
 * granted; a silent clip gives a deterministic 200 with empty text and costs a fraction of
 * a credit.
 */
export function silentWav(seconds = 0.2, rate = 16_000): Uint8Array {
  const samples = Math.floor(seconds * rate);
  const buf = new Uint8Array(44 + samples * 2);
  const view = new DataView(buf.buffer);
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => (buf[at + i] = c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  return buf; // samples stay zero: silence
}

async function probeElevenLabs(signal: AbortSignal): Promise<ProbeOutcome> {
  const key = config.elevenlabs.apiKey;
  const res = await fetch("https://api.elevenlabs.io/v1/user", {
    headers: { "xi-api-key": key, accept: "application/json" },
    signal,
  });
  if (res.ok) {
    const body = (await res.json().catch(() => ({}))) as { subscription?: { tier?: string } };
    return { status: "PASS", reason: `GET /v1/user → HTTP ${res.status}, tier ${body.subscription?.tier ?? "?"}` };
  }

  const body = await res.json().catch(() => null);
  const scope = missingScope(body);
  if (!scope) {
    return { status: "FAIL", reason: `HTTP ${res.status} — key rejected (key ${redact(key)})` };
  }

  // The key is real; it just was not granted `user_read`. Ask it to do the app's job.
  const form = new FormData();
  form.append("file", new Blob([silentWav()], { type: "audio/wav" }), "silence.wav");
  form.append("model_id", "scribe_v2");
  const stt = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form,
    signal,
  });
  if (stt.ok) {
    return {
      status: "PASS",
      reason: `key is scoped (no ${scope}), but the voice-in path works: POST /v1/speech-to-text → HTTP ${stt.status}`,
    };
  }
  const sttBody = await stt.json().catch(() => null);
  const sttScope = missingScope(sttBody);
  return {
    status: "FAIL",
    reason: sttScope
      ? `key is valid but lacks ${sttScope} — enable speech_to_text (and text_to_speech for voice out)`
      : `POST /v1/speech-to-text → HTTP ${stt.status}`,
  };
}

// ── Sentry — agent tracing. ──────────────────────────────────────────────────
// doc: https://docs.sentry.io/platforms/javascript/guides/node/usage/ (capture)
// and .../configuration/apis/ (`init`, `getClient`, `captureMessage`, `flush`).
// We build a client from the DSN, send one constant, low-cardinality message, and
// read the ingest HTTP status from the `afterSendEvent` hook — 200 means the
// event was actually accepted.
async function probeSentry(signal: AbortSignal): Promise<ProbeOutcome> {
  let statusCode: number | undefined;
  Sentry.init({
    dsn: config.sentry.dsn,
    tracesSampleRate: 0,
    defaultIntegrations: false, // a CLI probe needs no instrumentation
  });
  const client = Sentry.getClient();
  client?.on("afterSendEvent", (_event, response) => {
    statusCode = response.statusCode;
  });
  Sentry.captureMessage("sourcerer keys:check probe");
  const flushed = await Sentry.flush(4_000);
  await Sentry.close(1_000).catch(() => {});
  if (statusCode === 200) return { status: "PASS", reason: "event accepted (HTTP 200)" };
  if (statusCode !== undefined) return { status: "FAIL", reason: `ingest rejected the event (HTTP ${statusCode})` };
  return {
    status: "FAIL",
    reason: flushed ? "no delivery receipt — DSN rejected locally" : "flush timed out before delivery",
  };
}

// ── Temporal — durable background jobs. ──────────────────────────────────────
// doc: https://typescript.temporal.io/api/classes/client.Connection — `connect`,
// `withDeadline` and the raw `workflowService`. DescribeNamespace is read-only.
async function probeTemporal(signal: AbortSignal): Promise<ProbeOutcome> {
  const { address, namespace } = config.temporal;
  let conn: Connection | undefined;
  const onAbort = (): void => {
    void conn?.close().catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    conn = await Connection.connect({ address, connectTimeout: 2_000 });
    const res = await conn.withDeadline(Date.now() + 2_000, () =>
      conn!.workflowService.describeNamespace({ namespace }),
    );
    const name = res.namespaceInfo?.name ?? namespace;
    return { status: "PASS", reason: `${address} — namespace "${name}" reachable` };
  } finally {
    signal.removeEventListener("abort", onAbort);
    await conn?.close().catch(() => {});
  }
}

interface Spec {
  name: string;
  configured: boolean;
  fix: string;
  probe: (signal: AbortSignal) => Promise<ProbeOutcome>;
}

function specs(): Spec[] {
  // Ollama and Temporal have no key, but they are the local defaults and always
  // probed; a missing key is never a failure, but a configured default being
  // down is.
  return [
    { name: "Ollama", configured: true, probe: probeOllama, fix: "Start it: `ollama serve`, then `pnpm model:pull`" },
    { name: "Temporal", configured: true, probe: probeTemporal, fix: "Start it: `temporal server start-dev`" },
    { name: "SerpApi", configured: Boolean(config.serpapi.apiKey), probe: probeSerpApi, fix: "Check SERPAPI_API_KEY — https://serpapi.com/manage-api-key" },
    { name: "Backboard", configured: Boolean(config.backboard.apiKey), probe: probeBackboard, fix: "Check BACKBOARD_API_KEY — https://app.backboard.io" },
    { name: "TabPFN", configured: Boolean(config.tabpfn.token), probe: probeTabpfn, fix: "Check TABPFN_TOKEN — https://platform.priorlabs.ai/account/api-keys" },
    { name: "Tiger Data", configured: Boolean(config.db.url), probe: probeDatabase, fix: "Check DATABASE_URL, or run `bash scripts/db-up.sh` for local pgvector" },
    { name: "ElevenLabs", configured: Boolean(config.elevenlabs.apiKey), probe: probeElevenLabs, fix: "Check ELEVENLABS_API_KEY — https://elevenlabs.io/app/settings/api-keys" },
    { name: "Sentry", configured: Boolean(config.sentry.dsn), probe: probeSentry, fix: "Check SENTRY_DSN — https://sentry.io" },
  ];
}

function render(results: readonly CheckResult[]): void {
  const statusW = Math.max(...results.map((r) => r.status.length));
  const nameW = Math.max(...results.map((r) => r.name.length));

  console.log("");
  console.log("  sourcerer keys:check — live probes (read-only; no search quota used)");
  console.log("");
  for (const r of results) {
    console.log(`  ${r.status.padEnd(statusW)}  ${r.name.padEnd(nameW)}  ${r.reason}`);
  }

  const count = (s: Status): number => results.filter((r) => r.status === s).length;
  const pass = count("PASS");
  const fail = count("FAIL");
  const skip = count("SKIPPED(no key)");
  const shape = count("SHAPE-ONLY");

  console.log("");
  console.log(
    `  ${pass} passing · ${fail} failing · ${skip} skipped (no key)${shape ? ` · ${shape} shape-only` : ""}.`,
  );

  for (const r of results.filter((r) => r.configured && r.status === "FAIL")) {
    console.log(`  fix ${r.name}: ${r.fix ?? r.reason}`);
  }
  console.log(
    fail === 0
      ? "  ✓ nothing configured is failing."
      : `  ✗ ${fail} configured integration(s) failing — see the fixes above.`,
  );
  console.log("");
}

async function main(): Promise<number> {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const budget = Math.max(250, Math.min(PER_PROBE_MS, deadline - Date.now()));
  const list = specs();
  const results = await Promise.all(
    list.map((s) => runProbe({ name: s.name, configured: s.configured, fix: s.fix, probe: s.probe }, budget)),
  );
  render(results);
  return decideExit(results);
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;

if (invokedDirectly) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`keys:check crashed: ${errMsg(err)}`);
      process.exitCode = 1;
    },
  );
}
