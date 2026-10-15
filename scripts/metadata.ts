const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december"
];

/** First "31 August 2026" style date in the text, as YYYY-MM-DD. */
export function parseDocDate(text: string): string | null {
  const m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(20\d\d)\b/.exec(text);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  if (month < 0) return null;
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/**
 * Event name from an FIA document title or filename, e.g.
 * "2026_dutch_grand_prix_-_decision_-_car_12.pdf" -> "2026 Dutch Grand Prix".
 */
export function parseEventName(title: string): string | null {
  const clean = title.replace(/\.pdf$/i, "").replace(/[_+]+/g, " ");
  const m = /\b(20\d\d)\s+(?:formula 1\s+)?(.+?\bgrand prix)\b/i.exec(clean);
  if (!m) return null;
  const name = m[2]
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
  return `${m[1]} ${name}`;
}

export function parseSeason(...texts: (string | null | undefined)[]): number | null {
  for (const t of texts) {
    const m = t && /\b(20\d\d)\b/.exec(t);
    if (m) return Number(m[1]);
  }
  return null;
}

/** "2026_f1_sporting_regulations_-_issue_3.pdf" -> "2026 F1 Sporting Regulations - Issue 3" */
export function titleFromFilename(file: string): string {
  return file
    .replace(/\.pdf$/i, "")
    .replace(/[_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|\s)([a-z])/g, (_, s, c) => s + c.toUpperCase());
}
