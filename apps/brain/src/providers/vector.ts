import pg from "pg";
import { config } from "../env.ts";

/**
 * Vector memory over pgvector — "have I bought one of these before, and what did
 * it sell for?"
 *
 * Works against Tiger Data (pgvector is pre-installed on every Tiger Cloud
 * service) or a local pgvector container. Uses hybrid search: keyword match via
 * tsvector OR'd with vector similarity, fused with Reciprocal Rank Fusion, which
 * is what actually finds "the same mug but the listing called it a cup".
 *
 * Entirely optional. No DATABASE_URL → available() is false and the app carries on.
 */

let pool: pg.Pool | null = null;
let schemaReady = false;

export function hasVectorDb(): boolean {
  return Boolean(config.db.url);
}

function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: config.db.url,
      // Tiger Cloud and most managed PG need TLS; local containers usually do not.
      ssl: /sslmode=require|timescale\.com/.test(config.db.url) ? { rejectUnauthorized: false } : undefined,
      max: 4,
      connectionTimeoutMillis: 4000,
    });
  }
  return pool;
}

export async function ensureSchema(): Promise<boolean> {
  if (!hasVectorDb()) return false;
  if (schemaReady) return true;
  const dim = config.db.embedDim;
  try {
    await getPool().query("CREATE EXTENSION IF NOT EXISTS vector");
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS items (
        id          text PRIMARY KEY,
        title       text NOT NULL,
        category    text,
        brand       text,
        condition   text,
        sold_for    numeric,
        embedding   vector(${dim}),
        tsv         tsvector GENERATED ALWAYS AS (
                      to_tsvector('english', coalesce(title,'') || ' ' || coalesce(brand,'') || ' ' || coalesce(category,''))
                    ) STORED,
        updated_at  timestamptz NOT NULL DEFAULT now()
      )`);
    await getPool().query(
      `CREATE INDEX IF NOT EXISTS items_embedding_hnsw ON items USING hnsw (embedding vector_cosine_ops)`,
    );
    await getPool().query(`CREATE INDEX IF NOT EXISTS items_tsv_gin ON items USING gin (tsv)`);
    schemaReady = true;
    return true;
  } catch (err) {
    console.warn("[vector] schema init failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

export interface SimilarHit {
  id: string;
  title: string;
  brand?: string;
  category?: string;
  soldFor?: number;
  score: number;
}

export async function upsertItem(row: {
  id: string;
  title: string;
  category?: string;
  brand?: string;
  condition?: string;
  soldFor?: number;
  embedding?: number[] | null;
}): Promise<void> {
  if (!(await ensureSchema())) return;
  const vec = row.embedding ? `[${row.embedding.join(",")}]` : null;
  await getPool().query(
    `INSERT INTO items (id, title, category, brand, condition, sold_for, embedding, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::vector, now())
     ON CONFLICT (id) DO UPDATE SET
       title=EXCLUDED.title, category=EXCLUDED.category, brand=EXCLUDED.brand,
       condition=EXCLUDED.condition, sold_for=EXCLUDED.sold_for,
       embedding=COALESCE(EXCLUDED.embedding, items.embedding), updated_at=now()`,
    [row.id, row.title, row.category ?? null, row.brand ?? null, row.condition ?? null, row.soldFor ?? null, vec],
  );
}

/** Hybrid keyword + vector search, fused with RRF (k=60). */
export async function similarItems(
  query: string,
  embedding: number[] | null,
  limit = 5,
): Promise<SimilarHit[]> {
  if (!(await ensureSchema())) return [];
  const vec = embedding ? `[${embedding.join(",")}]` : null;
  try {
    const { rows } = await getPool().query(
      `WITH kw AS (
         SELECT id, row_number() OVER (
                  ORDER BY ts_rank_cd(tsv, websearch_to_tsquery('english', $1)) DESC) AS r
         FROM items
         WHERE $1 <> '' AND tsv @@ websearch_to_tsquery('english', $1)
         LIMIT 50
       ),
       vs AS (
         SELECT id, row_number() OVER (ORDER BY embedding <=> $2::vector) AS r
         FROM items
         WHERE $2::text IS NOT NULL AND embedding IS NOT NULL
         ORDER BY embedding <=> $2::vector
         LIMIT 50
       )
       SELECT i.id, i.title, i.brand, i.category, i.sold_for,
              COALESCE(1.0/(60+k.r),0) + COALESCE(1.0/(60+v.r),0) AS score
       FROM items i
       LEFT JOIN kw k ON k.id = i.id
       LEFT JOIN vs v ON v.id = i.id
       WHERE k.id IS NOT NULL OR v.id IS NOT NULL
       ORDER BY score DESC
       LIMIT $3`,
      [query, vec, limit],
    );
    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      brand: r.brand ?? undefined,
      category: r.category ?? undefined,
      soldFor: r.sold_for != null ? Number(r.sold_for) : undefined,
      score: Number(r.score),
    }));
  } catch (err) {
    console.warn("[vector] query failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** Embeddings from the local model. Returns null when unavailable. */
export async function embed(text: string): Promise<number[] | null> {
  if (!config.ollama.embedModel) return null;
  try {
    const res = await fetch(`${config.ollama.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: config.ollama.embedModel, prompt: text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { embedding?: number[] };
    return json.embedding ?? null;
  } catch {
    return null;
  }
}

export async function closeVector(): Promise<void> {
  if (pool) await pool.end().catch(() => {});
  pool = null;
  schemaReady = false;
}
