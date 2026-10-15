export interface Chunk {
  seq: number;
  page: number;
  article: string | null;
  text: string;
}

export interface ChunkOptions {
  /** Target chunk size in characters. */
  size?: number;
  /** Characters carried over from the end of the previous chunk. */
  overlap?: number;
}

// "33.3 Drivers must…", "B6.1.2 The race…", "ARTICLE 54: PENALTIES".
const NUMBERED_HEADING = /^([A-Z]?\d{1,2}(?:\.\d{1,3}){1,3})\.?\s+\S/;
const ARTICLE_HEADING = /^ARTICLE\s+([A-Z]?\d{1,3}(?:\.\d{1,3})*)\b/i;

export function articleOf(line: string): string | null {
  const trimmed = line.trim();
  const m = ARTICLE_HEADING.exec(trimmed) ?? NUMBERED_HEADING.exec(trimmed);
  return m ? m[1] : null;
}

function splitLongLine(line: string, size: number): string[] {
  if (line.length <= size) return [line];
  // Text extracted without line breaks: fall back to sentence boundaries.
  const parts = line.split(/(?<=[.;:])\s+/);
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    if (cur && cur.length + p.length + 1 > size) {
      out.push(cur);
      cur = "";
    }
    cur = cur ? `${cur} ${p}` : p;
    while (cur.length > size * 1.5) {
      out.push(cur.slice(0, size));
      cur = cur.slice(size);
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Splits per-page PDF text into overlapping chunks that break on line
 * boundaries, tagging each with its starting page and the regulation article
 * in effect where it starts, so answers can cite "Art. 33.3, p. 27".
 */
export function chunkPages(pages: string[], opts: ChunkOptions = {}): Chunk[] {
  const size = opts.size ?? 900;
  const overlap = opts.overlap ?? 150;
  const chunks: Chunk[] = [];

  let buf: { line: string; page: number; article: string | null }[] = [];
  let bufLen = 0;
  // Leading lines of `buf` carried over from the previous chunk.
  let carried = 0;
  let article: string | null = null;

  const flush = () => {
    const text = buf.map((l) => l.line).join("\n").trim();
    // Label with the first new line, not the overlap, so a chunk that opens
    // with the tail of Art. 33.1 and then covers 33.2 is cited as 33.2.
    const first = buf[Math.min(carried, buf.length - 1)];
    if (text) {
      chunks.push({ seq: chunks.length, page: first.page, article: first.article, text });
    }
    // Carry whole trailing lines (up to `overlap` chars) into the next chunk.
    const tail: typeof buf = [];
    let tailLen = 0;
    for (let i = buf.length - 1; i > 0; i--) {
      tailLen += buf[i].line.length + 1;
      if (tailLen > overlap) break;
      tail.unshift(buf[i]);
    }
    buf = tail;
    carried = tail.length;
    bufLen = tail.reduce((n, l) => n + l.line.length + 1, 0);
  };

  pages.forEach((pageText, i) => {
    const page = i + 1;
    for (const raw of pageText.split(/\r?\n/)) {
      for (const line of splitLongLine(raw.replace(/\s+/g, " ").trim(), size)) {
        if (!line) continue;
        const heading = articleOf(line);
        if (heading) article = heading;
        // Prefer to start a new chunk at an article heading once the current
        // one has some substance, so chunks map cleanly onto articles.
        const full = bufLen + line.length > size || (heading && bufLen > size * 0.4);
        if (full && buf.length > carried) flush();
        buf.push({ line, page, article });
        bufLen += line.length + 1;
      }
    }
  });
  // Skip a final buffer that is nothing but overlap already emitted.
  if (buf.length > carried) flush();
  return chunks;
}
