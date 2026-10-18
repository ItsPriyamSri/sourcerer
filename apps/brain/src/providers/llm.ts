import { config, modelRoute } from "../env.ts";

/**
 * The model layer.
 *
 * We talk to open-weight models through two very different APIs, so we hide both
 * behind one tiny interface. Nothing else in the codebase knows which model is
 * running, or whether it is on this device or on someone else's.
 *
 *   OllamaProvider     — Gemma 3 running on this machine. Multimodal, structured
 *                        output, works with the wifi off. The default.
 *   BackboardProvider  — open-weight models (Gemma, gpt-oss, Qwen...) through one
 *                        Backboard key. Used when there is no local GPU.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmChatOptions {
  messages: ChatMessage[];
  /** base64 (with or without a `data:` prefix). Only used by vision models. */
  images?: string[];
  /** Standard JSON Schema. Constrains the model's output where supported. */
  jsonSchema?: Record<string, unknown>;
  /** Pins llama.cpp's sampler. Set by the evidence capture; see config.ollama.seed. */
  seed?: number;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  /**
   * What the task actually needs. Local runs use the small text model for text-only
   * work, because loading 3 GB of vision weights to tidy up a title is a waste of the
   * user's battery. Hosted providers ignore this and keep their configured model.
   */
  capability?: "vision" | "text";
  signal?: AbortSignal;
}

export interface LlmResult {
  text: string;
  provider: string;
  model: string;
  /** true when inference happened on this device. */
  local: boolean;
  ms: number;
  usage?: { promptTokens?: number; completionTokens?: number };
}

export interface LlmProvider {
  readonly id: string;
  readonly local: boolean;
  available(): Promise<boolean>;
  chat(opts: LlmChatOptions): Promise<LlmResult>;
}

export function stripDataUrl(b64: string): string {
  const i = b64.indexOf("base64,");
  return i >= 0 ? b64.slice(i + 7) : b64;
}

/** Local Gemma via Ollama's native API. */
export class OllamaProvider implements LlmProvider {
  readonly id = "ollama";
  readonly local = true;
  private alive: { at: number; ok: boolean; models: string[] } | null = null;

  constructor(private baseUrl = config.ollama.baseUrl) {}

  /**
   * "Available" means the server answered *and* at least one of the models we are
   * configured to use is actually pulled. A running Ollama with no Gemma is not a
   * usable brain, and the UI deserves to know that instead of failing at scan time.
   */
  async status(): Promise<{ reachable: boolean; ready: boolean; models: string[]; missing: string[] }> {
    const wanted = [config.ollama.model, config.ollama.textModel].filter(Boolean);
    const cached = this.alive && Date.now() - this.alive.at < 10_000 ? this.alive.models : null;
    let models = cached;
    let reachable = Boolean(cached);
    if (!models) {
      try {
        const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { models?: { name?: string; model?: string }[] };
        models = (json.models ?? []).map((m) => m.name ?? m.model ?? "").filter(Boolean);
        reachable = true;
      } catch {
        models = [];
        reachable = false;
      }
    }
    const missing = reachable ? wanted.filter((w) => !models!.includes(w)) : wanted;
    const ready = reachable && missing.length < Math.max(1, wanted.length);
    this.alive = { at: Date.now(), ok: ready, models: models! };
    return { reachable, ready, models: models!, missing };
  }

  async available(): Promise<boolean> {
    return (await this.status()).ready;
  }

  async chat(opts: LlmChatOptions): Promise<LlmResult> {
    const started = Date.now();
    const model =
      opts.model ??
      (opts.capability === "text" && config.ollama.textModel ? config.ollama.textModel : config.ollama.model);
    const images = (opts.images ?? []).map(stripDataUrl);

    const seed = opts.seed ?? config.ollama.seed;

    const messages = opts.messages.map((m, i) => {
      const isLastUser = m.role === "user" && i === opts.messages.length - 1;
      return {
        role: m.role,
        content: m.content,
        // Ollama attaches images to the message; we put them on the final user turn.
        ...(isLastUser && images.length ? { images } : {}),
      };
    });

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: false,
      // Keep weights resident. A reseller scans a dozen items in a row; paying the
      // multi-second load cost on every one of them would be a self-inflicted wound.
      keep_alive: process.env.OLLAMA_KEEP_ALIVE ?? "30m",
      options: {
        temperature: opts.temperature ?? 0.2,
        num_predict: opts.maxTokens ?? 900,
        // Only sent when a seed is configured. Left out entirely otherwise, so Ollama's
        // own default (a fresh random seed per request) still applies.
        ...(seed === undefined ? {} : { seed }),
      },
    };
    // Structured output: Ollama accepts a JSON schema here and *constrains* sampling.
    if (opts.jsonSchema) body.format = opts.jsonSchema;

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`ollama ${res.status}: ${detail.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      text: json.message?.content ?? "",
      provider: this.id,
      model,
      local: true,
      ms: Date.now() - started,
      usage: { promptTokens: json.prompt_eval_count, completionTokens: json.eval_count },
    };
  }
}

/** Open-weight models through Backboard's unified API. */
export class BackboardProvider implements LlmProvider {
  readonly id = "backboard";
  readonly local = false;

  constructor(
    private apiKey = config.backboard.apiKey,
    private baseUrl = config.backboard.baseUrl,
  ) {}

  async available(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const res = await fetch(`${this.baseUrl}/models?model_type=llm&limit=1`, {
        headers: { "X-API-Key": this.apiKey },
        signal: AbortSignal.timeout(4000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async chat(opts: LlmChatOptions): Promise<LlmResult> {
    const started = Date.now();
    if (!this.apiKey) throw new Error("BACKBOARD_API_KEY not set");
    const model = opts.model || config.backboard.model;

    // Backboard is a thread API: one `content` string per send, no message array.
    //
    // The system prompt goes in `system_prompt`, which is the documented per-turn
    // instructions field. The first version put it inside `content` behind a `[SYSTEM]`
    // heading and used an `instructions` field for the JSON case — and `instructions` is
    // not in Backboard's schema. It would have been ignored without complaint, so the
    // identify step would have posted the text "Produce the JSON now." with the item
    // description and the schema both dropped. Nothing local could catch that: the path
    // only runs when a real key is present, which is exactly when you are least able to
    // debug it. The parameters here are checked against the published request schema.
    const system = opts.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const turns = opts.messages.filter((m) => m.role !== "system");
    const last = turns[turns.length - 1];
    const history = turns
      .slice(0, -1)
      .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
      .join("\n");

    const content = [history && `[HISTORY]\n${history}`, last?.content ?? ""]
      .filter(Boolean)
      .join("\n\n");

    // Backboard's structured-output switch is `json_output`, not an OpenAI-style
    // `response_format`; the schema itself has to travel in the instructions.
    const systemPrompt = [
      system,
      opts.jsonSchema &&
        `Respond with ONLY valid JSON matching this schema:\n${JSON.stringify(opts.jsonSchema)}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const images = (opts.images ?? []).map(stripDataUrl);
    let res: Response;

    if (images.length) {
      // Vision must go over multipart: Backboard rejects binaries in JSON.
      const form = new FormData();
      form.set("content", content);
      form.set("system_prompt", systemPrompt);
      form.set("llm_provider", config.backboard.llmProvider);
      form.set("model_name", model);
      images.forEach((b64, i) => {
        const bytes = Buffer.from(b64, "base64");
        form.append("files", new Blob([bytes], { type: "image/jpeg" }), `photo-${i}.jpg`);
      });
      res = await fetch(`${this.baseUrl}/threads/messages`, {
        method: "POST",
        headers: { "X-API-Key": this.apiKey },
        body: form,
        signal: opts.signal,
      });
    } else {
      const jsonBody: Record<string, unknown> = {
        content,
        system_prompt: systemPrompt,
        llm_provider: config.backboard.llmProvider,
        model_name: model,
        stream: false,
      };
      if (opts.jsonSchema) jsonBody.json_output = true;
      res = await fetch(`${this.baseUrl}/threads/messages`, {
        method: "POST",
        headers: { "X-API-Key": this.apiKey, "content-type": "application/json" },
        body: JSON.stringify(jsonBody),
        signal: opts.signal,
      });
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`backboard ${res.status}: ${detail.slice(0, 300)}`);
    }
    const json = (await res.json()) as { content?: string; total_tokens?: number };
    return {
      text: json.content ?? "",
      provider: this.id,
      model,
      local: false,
      ms: Date.now() - started,
      usage: { completionTokens: json.total_tokens },
    };
  }
}

const ollama = new OllamaProvider();
const backboard = new BackboardProvider();

/** The provider we should try first, per config. */
export function primaryProvider(): LlmProvider {
  return modelRoute().provider === "backboard" ? backboard : ollama;
}

/**
 * Every provider we *could* use, primary first. Callers can walk this list so a
 * dead Ollama falls through to Backboard (and vice versa) instead of failing.
 */
export function providerChain(): LlmProvider[] {
  const primary = primaryProvider();
  const rest = [ollama, backboard].filter((p) => p.id !== primary.id);
  return [primary, ...rest];
}

export async function llmChat(opts: LlmChatOptions): Promise<LlmResult> {
  const chain = providerChain();
  const errors: string[] = [];
  for (const p of chain) {
    if (!(await p.available())) {
      errors.push(`${p.id}: unavailable`);
      continue;
    }
    try {
      return await p.chat(opts);
    } catch (err) {
      errors.push(`${p.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`no model provider available (${errors.join("; ")})`);
}

export const llmProviders = { ollama, backboard };
