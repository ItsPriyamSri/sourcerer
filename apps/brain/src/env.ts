import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Configuration, resolved once at boot.
 *
 * Design rule: every integration is *optional*. `caps` records what is actually
 * available so the API can tell the UI the truth about what ran where — and so
 * the product degrades into "works offline" rather than "errors offline".
 */

// Node >= 20.12 can read .env natively; no dotenv dependency.
for (const f of [".env.local", ".env"]) {
  const p = resolve(process.cwd(), f);
  if (existsSync(p)) {
    try {
      process.loadEnvFile(p);
    } catch {
      /* malformed .env should not take the server down */
    }
  }
}

const str = (k: string, d = ""): string => process.env[k]?.trim() || d;
const num = (k: string, d: number): number => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) ? v : d;
};
const optNum = (k: string): number | undefined => {
  const raw = process.env[k]?.trim();
  if (!raw) return undefined;
  const v = Number(raw);
  return Number.isFinite(v) ? v : undefined;
};
const list = (k: string, d: string[] = []): string[] =>
  str(k) ? str(k).split(",").map((s) => s.trim()).filter(Boolean) : d;

export const config = {
  port: num("PORT", 8787),
  allowedOrigins: list("ALLOWED_ORIGINS", ["http://localhost:3000", "http://127.0.0.1:3000"]),
  dataDir: resolve(process.cwd(), str("SOURCERER_DATA_DIR", "./data")),

  ollama: {
    baseUrl: str("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
    model: str("OLLAMA_MODEL", "gemma3:4b"),
    textModel: str("OLLAMA_TEXT_MODEL", "gemma3:1b"),
    /**
     * Tool calling is a separate capability. Ollama reports Gemma 3 as
     * `completion, vision` and rejects `tools`, so the agent loop uses a small
     * tool-capable open model instead. See docs/ARCHITECTURE.md §4.
     */
    // The tool loop needs a model that follows a protocol, not one that deliberates.
    // See the note in mastra/agents.ts — a reasoning model here costs minutes per turn.
    toolModel: str("OLLAMA_TOOL_MODEL", "llama3.2:3b"),
    embedModel: str("OLLAMA_EMBED_MODEL", ""),
    /**
     * Pins llama.cpp's RNG for every local call. Unset (the default) means Ollama picks a
     * fresh random seed per request — real spread, and the correct behaviour for the
     * identify eval, whose entire job is to measure that spread.
     *
     * `scripts/capture-evidence.ts` pins it instead, because the screenshots have to be
     * reproducible: unpinned, the same description came back identified as condition
     * `good` in one capture and `fair` in the next, which changed the comparable set from
     * 6 sold items to 8 and moved the max offer from $35.32 to $28.22. Nothing in the
     * product was wrong; the evidence was just not repeatable.
     */
    seed: optNum("OLLAMA_SEED"),
  },

  backboard: {
    apiKey: str("BACKBOARD_API_KEY"),
    baseUrl: str("BACKBOARD_BASE_URL", "https://app.backboard.io/api"),
    llmProvider: str("BACKBOARD_LLM_PROVIDER", "openrouter"),
    model: str("BACKBOARD_MODEL", "google/gemma-3-27b-it"),
  },

  serpapi: {
    apiKey: str("SERPAPI_API_KEY"),
    baseUrl: "https://serpapi.com",
    maxResults: num("SERPAPI_MAX_RESULTS", 60),
  },

  tabpfn: {
    token: str("TABPFN_TOKEN"),
    baseUrl: str("TABPFN_BASE_URL", "https://api.priorlabs.ai"),
    modelPath: str("TABPFN_MODEL_PATH", "v3.5_default"),
  },

  db: {
    url: str("DATABASE_URL"),
    embedDim: num("EMBED_DIM", 768),
  },

  temporal: {
    address: str("TEMPORAL_ADDRESS", "127.0.0.1:7233"),
    namespace: str("TEMPORAL_NAMESPACE", "default"),
    taskQueue: str("TEMPORAL_TASK_QUEUE", "sourcerer-reprice"),
  },

  elevenlabs: {
    apiKey: str("ELEVENLABS_API_KEY"),
    ttsVoice: str("ELEVENLABS_TTS_VOICE", "21m00Tcm4TlvDq8ikWAM"),
  },

  sentry: {
    dsn: str("SENTRY_DSN"),
    tracesSampleRate: num("SENTRY_TRACES_SAMPLE_RATE", 1),
    recordInputs: str("SENTRY_RECORD_INPUTS", "0") === "1",
  },
} as const;

/**
 * Which provider serves the model in each situation.
 *
 * `local` is the default and the point of the whole project. Backboard is the
 * escape hatch for a machine with no GPU, or a hosted demo — same agent, still
 * open-weight models.
 */
export function modelRoute(): { provider: "ollama" | "backboard"; local: boolean } {
  const forced = str("MODEL_PROVIDER");
  if (forced === "backboard" && config.backboard.apiKey) return { provider: "backboard", local: false };
  if (forced === "ollama") return { provider: "ollama", local: true };
  if (config.backboard.apiKey && str("PREFER_BACKBOARD", "0") === "1") {
    return { provider: "backboard", local: false };
  }
  return { provider: "ollama", local: true };
}
