const STOPWORDS = new Set(
  "a an and are as at be but by did do does for from had has have he her his how i if in into is it its me my not of on or she should so than that the their them then there they this to was we were what when where which who why will with would you your".split(
    " "
  )
);

/**
 * Turns free text into an FTS5 MATCH expression: each meaningful token is
 * quoted (so "MGU-K" or "33.3" can't be read as FTS syntax) and OR-ed, and
 * bm25 ranking rewards chunks that match more of them.
 */
export function buildFtsQuery(query: string): string | null {
  const tokens = query.match(/[\p{L}\p{N}]+(?:[.\-'][\p{L}\p{N}]+)*/gu) ?? [];
  const terms = [
    ...new Set(
      tokens
        .map((t) => t.toLowerCase())
        .filter((t) => !STOPWORDS.has(t) && (t.length > 1 || /\d/.test(t)))
    )
  ].slice(0, 16);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t.replaceAll('"', "")}"`).join(" OR ");
}

/** Reciprocal rank fusion of several ranked id lists. */
export function reciprocalRankFusion(lists: string[][], k = 60): string[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
