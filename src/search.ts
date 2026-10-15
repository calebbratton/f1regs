import { buildFtsQuery, reciprocalRankFusion } from "./ranking";

export const EMBEDDING_MODEL = "@cf/baai/bge-large-en-v1.5";
// bge v1.5 retrieves better when queries (not passages) carry this prefix.
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

export type DocKind = "regulation" | "event";

export interface SearchFilters {
  kind?: DocKind;
  event?: string;
}

export interface SearchHit {
  chunkId: string;
  docId: string;
  title: string;
  kind: DocKind;
  event: string | null;
  docDate: string | null;
  url: string | null;
  page: number | null;
  article: string | null;
  text: string;
}

export async function embed(ai: Ai, texts: string[]): Promise<number[][]> {
  const result = (await ai.run(EMBEDDING_MODEL, { text: texts })) as {
    data: number[][];
  };
  return result.data;
}

async function vectorSearch(env: Env, query: string, filters: SearchFilters) {
  const [vector] = await embed(env.AI, [QUERY_PREFIX + query]);
  const filter: VectorizeVectorMetadataFilter = {};
  if (filters.kind) filter.kind = filters.kind;
  if (filters.event) filter.event = filters.event;
  const result = await env.VECTORIZE.query(vector, {
    topK: 20,
    filter: Object.keys(filter).length ? filter : undefined
  });
  return result.matches.map((m) => m.id);
}

async function keywordSearch(env: Env, query: string, filters: SearchFilters) {
  const match = buildFtsQuery(query);
  if (!match) return [];
  const { results } = await env.DB.prepare(
    `SELECT c.id FROM chunks_fts
       JOIN chunks c ON c.rowid = chunks_fts.rowid
       JOIN documents d ON d.id = c.doc_id
     WHERE chunks_fts MATCH ?1
       AND (?2 IS NULL OR d.kind = ?2)
       AND (?3 IS NULL OR d.event = ?3)
     ORDER BY bm25(chunks_fts)
     LIMIT 20`
  )
    .bind(match, filters.kind ?? null, filters.event ?? null)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

/** Hybrid search: Vectorize (meaning) + D1 FTS5 (literal terms), fused. */
export async function searchDocuments(
  env: Env,
  query: string,
  filters: SearchFilters = {},
  limit = 6
): Promise<SearchHit[]> {
  const [vectorIds, keywordIds] = await Promise.all([
    vectorSearch(env, query, filters),
    keywordSearch(env, query, filters)
  ]);
  const ids = reciprocalRankFusion([vectorIds, keywordIds]).slice(0, limit);
  if (ids.length === 0) return [];

  const placeholders = ids.map((_, i) => `?${i + 1}`).join(",");
  const { results } = await env.DB.prepare(
    `SELECT c.id AS chunkId, c.doc_id AS docId, d.title, d.kind, d.event,
            d.doc_date AS docDate, d.url, c.page, c.article, c.text
       FROM chunks c JOIN documents d ON d.id = c.doc_id
      WHERE c.id IN (${placeholders})`
  )
    .bind(...ids)
    .all<SearchHit>();
  const byId = new Map(results.map((r) => [r.chunkId, r]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}
