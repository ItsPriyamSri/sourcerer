import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BackboardProvider } from "./llm.ts";

/**
 * The hosted brain is the half of this app that no local run can reach: it needs a real
 * key, real money and someone else's GPU. So these tests pin the request against
 * Backboard's published schema instead of pretending to exercise the service, because the
 * failure mode here is silent rather than loud.
 *
 * That is not hypothetical. The first version put the system prompt inside `content` and
 * sent the JSON schema in an `instructions` field. `instructions` is not a field Backboard
 * accepts, so it would have been dropped without an error, and the identify step would have
 * posted the literal text "Produce the JSON now." with the item description and the schema
 * both missing. The request would have returned 200 and the item would have been wrong.
 */

const TOOL = "https://example.invalid/api";

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  json?: Record<string, unknown>;
  form?: FormData;
  signal?: AbortSignal | null;
}

/** Runs `chat()` against a stubbed fetch and returns what was actually sent. */
async function capture(
  opts: Parameters<BackboardProvider["chat"]>[0],
): Promise<{ sent: Captured; result: { text: string; provider: string; local: boolean } }> {
  const original = globalThis.fetch;
  let sent: Captured | undefined;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    const body = init?.body;
    sent = {
      url,
      method: init?.method ?? "GET",
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
          k.toLowerCase(),
          String(v),
        ]),
      ),
      json: body instanceof FormData ? undefined : JSON.parse(String(body)),
      form: body instanceof FormData ? body : undefined,
      signal: init?.signal,
    };
    return new Response(
      JSON.stringify({ content: "ok", thread_id: "t", timestamp: "2026-01-01T00:00:00Z", total_tokens: 12 }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const provider = new BackboardProvider("test-key", TOOL);
    const result = await provider.chat(opts);
    assert.ok(sent, "no request was made");
    return { sent, result };
  } finally {
    globalThis.fetch = original;
  }
}

const ask = (over: Record<string, unknown> = {}) => ({
  messages: [
    { role: "system" as const, content: "You identify resale items." },
    { role: "user" as const, content: "Levi's 501 Big E selvedge denim jacket" },
  ],
  ...over,
});

describe("BackboardProvider request shape", () => {
  it("posts to the documented endpoint with the documented auth header", async () => {
    const { sent } = await capture(ask());
    assert.equal(sent.method, "POST");
    assert.equal(sent.url, `${TOOL}/threads/messages`);
    assert.equal(sent.headers["x-api-key"], "test-key");
  });

  it("sends the system prompt in system_prompt, not folded into content", async () => {
    const { sent } = await capture(ask());
    assert.equal(sent.json?.system_prompt, "You identify resale items.");
    assert.ok(!String(sent.json?.content).includes("You identify resale items."));
    assert.equal(sent.json?.content, "Levi's 501 Big E selvedge denim jacket");
  });

  it("never sends a field Backboard does not accept", async () => {
    // `instructions` is the OpenAI-shaped field this used to send. Backboard's schema has
    // `system_prompt`; an unknown key is ignored rather than rejected, which is precisely
    // why the mistake would have survived a successful-looking 200.
    const { sent } = await capture(ask({ jsonSchema: { type: "object" } }));
    assert.ok(!("instructions" in (sent.json ?? {})), "sent an undocumented `instructions` field");
    assert.ok(!("response_format" in (sent.json ?? {})));
  });

  it("carries the schema in the instructions and asks for JSON output", async () => {
    const schema = { type: "object", properties: { title: { type: "string" } }, required: ["title"] };
    const { sent } = await capture(ask({ jsonSchema: schema }));
    assert.equal(sent.json?.json_output, true);
    assert.match(String(sent.json?.system_prompt), /Respond with ONLY valid JSON/);
    assert.match(String(sent.json?.system_prompt), /"title"/);
    // The user's actual question survives; it is not replaced by a nudge to the model.
    assert.equal(sent.json?.content, "Levi's 501 Big E selvedge denim jacket");
  });

  it("leaves json_output off when no schema was requested", async () => {
    const { sent } = await capture(ask());
    assert.ok(!("json_output" in (sent.json ?? {})));
  });

  it("flattens prior turns into the content, because a thread API has no message array", async () => {
    const { sent } = await capture({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "what should I pay?" },
        { role: "assistant", content: "Sixty dollars." },
        { role: "user", content: "and with shipping?" },
      ],
    });
    assert.match(String(sent.json?.content), /\[HISTORY\]/);
    assert.match(String(sent.json?.content), /User: what should I pay\?/);
    assert.match(String(sent.json?.content), /Assistant: Sixty dollars\./);
    assert.ok(String(sent.json?.content).endsWith("and with shipping?"));
  });

  it("switches to multipart for images, and keeps the system prompt in the form", async () => {
    const { sent } = await capture(
      ask({
        images: [Buffer.from("not-really-a-jpeg").toString("base64")],
      }),
    );
    assert.ok(sent.form, "vision must go over multipart; Backboard rejects binaries in JSON");
    assert.equal(sent.form!.get("system_prompt"), "You identify resale items.");
    assert.equal(sent.form!.get("content"), "Levi's 501 Big E selvedge denim jacket");
    assert.ok(sent.form!.getAll("files").length === 1);
    assert.ok(!sent.json, "a JSON body was sent alongside the multipart form");
  });

  it("passes the caller's abort signal through", async () => {
    const controller = new AbortController();
    const { sent } = await capture(ask({ signal: controller.signal }));
    assert.equal(sent.signal, controller.signal);
  });

  it("omits the key entirely when none is configured, rather than calling out", async () => {
    const provider = new BackboardProvider("", TOOL);
    await assert.rejects(() => provider.chat(ask()), /BACKBOARD_API_KEY/);
  });
});
