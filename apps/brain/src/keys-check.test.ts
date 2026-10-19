import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideExit, redact, runProbe, type CheckResult } from "../scripts/check-keys.ts";
import { missingScope, silentWav } from "../scripts/check-keys.ts";

/**
 * `keys:check` is the gate between "a key is in .env" and "the integration
 * works", so its own decision logic has to be right. The live probes are
 * deliberately not exercised here — they need real network and real keys, and a
 * test that stubbed them would prove nothing about the gate. What is testable
 * hermetically is the part that decides the run's outcome: skip-a-missing-key,
 * redaction, and the exit code.
 */

const result = (over: Partial<CheckResult>): CheckResult => ({
  name: "X",
  status: "PASS",
  reason: "test",
  configured: true,
  ...over,
});

describe("runProbe — a missing key is not a failure", () => {
  it("reports SKIPPED(no key) and never reaches out when nothing is configured", async () => {
    let called = false;
    const res = await runProbe({
      name: "SerpApi",
      configured: false,
      probe: async () => {
        called = true;
        return { status: "PASS", reason: "should not happen" };
      },
    });
    assert.equal(res.status, "SKIPPED(no key)");
    assert.equal(res.configured, false);
    assert.equal(called, false, "a skipped probe must not make a network call");
  });

  it("runs the probe and passes the outcome through when configured", async () => {
    const res = await runProbe({
      name: "ElevenLabs",
      configured: true,
      probe: async () => ({ status: "PASS", reason: "tier free" }),
    });
    assert.equal(res.status, "PASS");
    assert.equal(res.configured, true);
    assert.equal(res.reason, "tier free");
  });

  it("turns a thrown probe into a FAIL with the message, not a crash", async () => {
    const res = await runProbe({
      name: "Sentry",
      configured: true,
      fix: "Check SENTRY_DSN",
      probe: async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      },
    });
    assert.equal(res.status, "FAIL");
    assert.match(res.reason, /ENOTFOUND/);
    assert.equal(res.fix, "Check SENTRY_DSN");
  });

  it("attaches no fix to a passing configured probe", async () => {
    const res = await runProbe({
      name: "Backboard",
      configured: true,
      fix: "Check BACKBOARD_API_KEY",
      probe: async () => ({ status: "PASS", reason: "ok" }),
    });
    assert.equal(res.fix, undefined);
  });
});

describe("redact", () => {
  it("keeps at most the first four characters", () => {
    assert.equal(redact("sk_live_abcdef123456"), "sk_l…");
  });

  it("reveals nothing for a short secret", () => {
    assert.equal(redact("abc"), "…");
    assert.equal(redact(""), "…");
  });

  it("never returns the whole secret", () => {
    const secret = "9f2c1e7b4a6d8e0f";
    assert.notEqual(redact(secret), secret);
  });
});

describe("decideExit", () => {
  it("exits 0 when everything passes or is skipped", () => {
    assert.equal(
      decideExit([
        result({ name: "Ollama", status: "PASS" }),
        result({ name: "SerpApi", status: "SKIPPED(no key)", configured: false }),
      ]),
      0,
    );
  });

  it("exits 0 when the only FAIL is an unconfigured one", () => {
    // Cannot happen in practice, but a missing key must never fail the run.
    assert.equal(decideExit([result({ status: "FAIL", configured: false })]), 0);
  });

  it("exits 1 when a configured integration fails", () => {
    assert.equal(decideExit([result({ status: "FAIL", configured: true })]), 1);
  });

  it("exits 1 when any configured integration in a mixed table fails", () => {
    assert.equal(
      decideExit([
        result({ name: "Ollama", status: "PASS" }),
        result({ name: "Sentry", status: "FAIL" }),
        result({ name: "TabPFN", status: "SKIPPED(no key)", configured: false }),
      ]),
      1,
    );
  });

  it("does not fail on a SHAPE-ONLY row, which is not a proven failure", () => {
    assert.equal(decideExit([result({ status: "SHAPE-ONLY", configured: true })]), 0);
  });
});

/**
 * ElevenLabs issues scoped keys, and a scoped key answers 401 on `GET /v1/user` — a route
 * the app never calls. Testing only that route reported a valid key as "rejected", so the
 * probe now reads the scope off the error body and falls through to the app's real call.
 * This was observed against the live service: the first key supplied here was scoped.
 */
describe("missingScope", () => {
  const body = (message: string, status = "missing_permissions") => ({
    detail: { status, message, code: "unauthorized" },
  });

  it("reads the scope out of a live missing_permissions body", () => {
    assert.equal(
      missingScope(body("The API key you used is missing the permission user_read to execute this operation.")),
      "user_read",
    );
  });

  it("reads a different scope from the same shape", () => {
    assert.equal(
      missingScope(body("The API key you used is missing the permission models_read to execute this operation.")),
      "models_read",
    );
  });

  it("is null when the key is rejected outright, which is a real failure", () => {
    assert.equal(missingScope(body("Invalid API key", "invalid_api_key")), null);
  });

  it("is null for anything that is not a scoping error", () => {
    assert.equal(missingScope(null), null);
    assert.equal(missingScope({}), null);
    assert.equal(missingScope({ detail: { status: "missing_permissions" } }), "unknown");
  });
});

describe("silentWav", () => {
  it("is a WAV header big enough to be a real upload", () => {
    const wav = silentWav();
    const view = new DataView(wav.buffer);
    assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
    assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
    assert.equal(view.getUint32(24, true), 16_000, "sample rate");
    assert.equal(wav.length, 44 + Math.floor(0.2 * 16_000) * 2);
  });

  it("is silent, so transcribing it cannot invent words", () => {
    assert.ok(silentWav().slice(44).every((b) => b === 0));
  });
});
