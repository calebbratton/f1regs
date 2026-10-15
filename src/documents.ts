import { z } from "zod";
import { embed } from "./search";

export async function listRecentEvents(env: Env, limit: number) {
  const { results } = await env.DB.prepare(
    `SELECT event, season, MAX(doc_date) AS lastDocDate, COUNT(*) AS documents
       FROM documents
      WHERE kind = 'event' AND event IS NOT NULL
      GROUP BY event, season
      ORDER BY lastDocDate DESC
      LIMIT ?1`
  )
    .bind(limit)
    .all();
  return results;
}

export async function listEventDocuments(env: Env, event: string) {
  const { results } = await env.DB.prepare(
    `SELECT id AS docId, title, doc_date AS docDate, url
       FROM documents
      WHERE kind = 'event' AND event = ?1
      ORDER BY doc_date, title`
  )
    .bind(event)
    .all();
  return results;
}

const READ_LIMIT = 8000;

export async function readDocument(env: Env, docId: string) {
  const doc = await env.DB.prepare(
    `SELECT id AS docId, title, kind, event, doc_date AS docDate, url
       FROM documents WHERE id = ?1`
  )
    .bind(docId)
    .first();
  if (!doc) return null;
  const { results } = await env.DB.prepare(
    `SELECT page, text FROM chunks WHERE doc_id = ?1 ORDER BY seq`
  )
    .bind(docId)
    .all<{ page: number | null; text: string }>();
  // Chunks overlap, so this repeats a little text; fine for reading.
  let text = results.map((c) => `[p.${c.page ?? "?"}] ${c.text}`).join("\n");
  const truncated = text.length > READ_LIMIT;
  if (truncated) text = text.slice(0, READ_LIMIT);
  return { ...doc, text, truncated };
}

export const ingestPayload = z.object({
  document: z.object({
    id: z.string().min(1).max(64),
    title: z.string().min(1),
    kind: z.enum(["regulation", "event"]),
    season: z.number().int().nullable(),
    event: z.string().nullable(),
    docDate: z.string().nullable(),
    url: z.string().nullable()
  }),
  chunks: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        seq: z.number().int(),
        page: z.number().int().nullable(),
        article: z.string().nullable(),
        text: z.string().min(1)
      })
    )
    .max(100),
  // The first batch of a document replaces whatever was stored for it before.
  replace: z.boolean()
});

export type IngestPayload = z.infer<typeof ingestPayload>;

export async function ingest(env: Env, payload: IngestPayload) {
  const { document: doc, chunks, replace } = payload;

  if (replace) {
    const { results: old } = await env.DB.prepare(
      `SELECT id FROM chunks WHERE doc_id = ?1`
    )
      .bind(doc.id)
      .all<{ id: string }>();
    for (let i = 0; i < old.length; i += 100) {
      await env.VECTORIZE.deleteByIds(old.slice(i, i + 100).map((c) => c.id));
    }
    await env.DB.prepare(`DELETE FROM chunks WHERE doc_id = ?1`).bind(doc.id).run();
  }

  await env.DB.prepare(
    `INSERT INTO documents (id, title, kind, season, event, doc_date, url)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT (id) DO UPDATE SET title = ?2, kind = ?3, season = ?4,
       event = ?5, doc_date = ?6, url = ?7, ingested_at = datetime('now')`
  )
    .bind(doc.id, doc.title, doc.kind, doc.season, doc.event, doc.docDate, doc.url)
    .run();

  if (chunks.length === 0) return { chunks: 0 };

  const vectors = await embed(
    env.AI,
    chunks.map((c) => `${doc.title}${c.article ? ` Article ${c.article}` : ""}\n${c.text}`)
  );
  await env.VECTORIZE.upsert(
    chunks.map((c, i) => ({
      id: c.id,
      values: vectors[i],
      metadata: { kind: doc.kind, ...(doc.event ? { event: doc.event } : {}) }
    }))
  );

  await env.DB.batch(
    chunks.map((c) =>
      env.DB.prepare(
        // Upsert rather than INSERT OR REPLACE: REPLACE skips the delete
        // trigger, which would leave stale rows in chunks_fts.
        `INSERT INTO chunks (id, doc_id, seq, page, article, text)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (id) DO UPDATE SET doc_id = ?2, seq = ?3, page = ?4,
           article = ?5, text = ?6`
      ).bind(c.id, doc.id, c.seq, c.page, c.article, c.text)
    )
  );
  return { chunks: chunks.length };
}
