import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dbConnection, readEmbedding } from "./vector.ts";

/**
 * `pg-connection-string` throws away an explicit `ssl` object whenever the URL
 * carries `sslmode`, and `sslmode=require` means verify-full as of pg 8.23. Tiger
 * Cloud's default URL is `...?sslmode=require` and its free services present a
 * self-signed certificate, so the combination fails at the TLS handshake — before
 * any query runs. There is no local pgvector in CI to catch that, so the parameter
 * handling is pinned here instead.
 */

const TIGER =
  "postgresql://tsdbadmin:pw@svc.proj.tsdb.cloud.timescale.com:31042/tsdb?sslmode=require";

describe("dbConnection", () => {
  it("strips sslmode so it cannot override our ssl object", () => {
    const { connectionString } = dbConnection(TIGER);
    assert.ok(
      !connectionString.includes("sslmode"),
      "sslmode must not survive into the connection string, or pg ignores `ssl`",
    );
  });

  it("disables certificate verification for a managed host", () => {
    const { ssl } = dbConnection(TIGER);
    assert.deepEqual(ssl, { rejectUnauthorized: false });
  });

  it("still enables TLS for a timescale host with no sslmode param", () => {
    const { ssl } = dbConnection("postgresql://tsdbadmin:pw@svc.proj.tsdb.cloud.timescale.com:31042/tsdb");
    assert.deepEqual(ssl, { rejectUnauthorized: false });
  });

  it("leaves a plain local container without TLS", () => {
    const { connectionString, ssl } = dbConnection("postgres://postgres:postgres@localhost:5432/sourcerer");
    assert.equal(ssl, undefined);
    assert.ok(connectionString.includes("localhost:5432"));
  });

  it("does not mangle credentials or the database name", () => {
    const { connectionString } = dbConnection(TIGER);
    const url = new URL(connectionString);
    assert.equal(url.username, "tsdbadmin");
    assert.equal(url.password, "pw");
    assert.equal(url.pathname, "/tsdb");
    assert.equal(url.port, "31042");
  });

  it("hands an unparseable string over untouched", () => {
    const raw = "/var/run/postgresql/not-a-url?sslmode=require";
    const { connectionString, ssl } = dbConnection(raw);
    assert.equal(connectionString, raw);
    assert.deepEqual(ssl, { rejectUnauthorized: false });
  });

  it("keeps unrelated query parameters", () => {
    const { connectionString } = dbConnection(
      "postgresql://u:p@host:5432/db?sslmode=require&application_name=sourcerer",
    );
    const url = new URL(connectionString);
    assert.equal(url.searchParams.get("application_name"), "sourcerer");
    assert.equal(url.searchParams.get("sslmode"), null);
  });
});

/**
 * Ollama 0.40 dropped `POST /api/embeddings`; 0.40+ answers `POST /api/embed` with
 * `{embeddings: [[…]]}` instead of `{embedding: […]}`. Reading only the old shape
 * returns null for every request, which stores NULL vectors and hides the whole
 * feature — there is no live Ollama in CI, so both shapes are pinned here.
 */
describe("readEmbedding", () => {
  it("reads the current /api/embed shape", () => {
    assert.deepEqual(readEmbedding({ model: "nomic-embed-text", embeddings: [[0.1, -0.2, 0.3]] }), [
      0.1, -0.2, 0.3,
    ]);
  });

  it("reads the legacy /api/embeddings shape", () => {
    assert.deepEqual(readEmbedding({ embedding: [1, 2, 3] }), [1, 2, 3]);
  });

  it("rejects an empty vector", () => {
    assert.equal(readEmbedding({ embeddings: [[]] }), null);
    assert.equal(readEmbedding({ embedding: [] }), null);
  });

  it("rejects non-numeric payloads rather than poisoning the column", () => {
    assert.equal(readEmbedding({ embeddings: [["a", "b"]] }), null);
    assert.equal(readEmbedding({ embeddings: [[1, null]] }), null);
    assert.equal(readEmbedding({ embeddings: [[NaN]] }), null);
  });

  it("returns null for an error body", () => {
    assert.equal(readEmbedding({ error: "model not found" }), null);
    assert.equal(readEmbedding(null), null);
    assert.equal(readEmbedding(undefined), null);
  });
});
