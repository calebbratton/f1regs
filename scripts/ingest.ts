// Parses every PDF under data/pdfs/, chunks it, and uploads it to a running
// f1regs Worker, which embeds the chunks into Vectorize and stores them in D1.
//
//   INGEST_TOKEN=... npm run ingest -- https://f1regs.<you>.workers.dev
//   INGEST_TOKEN=... npm run ingest -- http://localhost:5173 --force
//
// Unchanged PDFs are skipped (tracked in data/ingested.json); --force re-sends all.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { chunkPages } from "../src/chunking.ts";
import type { ManifestEntry } from "./fetch-fia.ts";
import { parseDocDate, parseEventName, parseSeason, titleFromFilename } from "./metadata.ts";

const DATA = path.resolve("data");
const STATE = path.join(DATA, "ingested.json");
const BATCH = 40;

async function walk(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? walk(p) : Promise.resolve(p.toLowerCase().endsWith(".pdf") ? [p] : []);
    })
  );
  return files.flat();
}

async function post(base: string, token: string, body: unknown) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(new URL("/api/ingest", base), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
    if (res.ok) return;
    const text = await res.text();
    if (res.status < 500 || attempt >= 4) throw new Error(`${res.status}: ${text.slice(0, 500)}`);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const base = args.find((a) => !a.startsWith("--"));
  const force = args.includes("--force");
  const token = process.env.INGEST_TOKEN;
  if (!base || !token) {
    console.error("Usage: INGEST_TOKEN=... npm run ingest -- <worker-url> [--force]");
    process.exit(1);
  }

  const manifest = new Map<string, ManifestEntry>(
    existsSync(path.join(DATA, "manifest.json"))
      ? (JSON.parse(await readFile(path.join(DATA, "manifest.json"), "utf8")) as ManifestEntry[]).map(
          (e) => [e.file, e]
        )
      : []
  );
  const state: Record<string, string> = existsSync(STATE)
    ? JSON.parse(await readFile(STATE, "utf8"))
    : {};

  const files = await walk(path.join(DATA, "pdfs"));
  console.log(`${files.length} PDFs found`);

  for (const file of files) {
    const rel = path.relative(DATA, file);
    const bytes = await readFile(file);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (!force && state[rel] === hash) continue;

    const parts = path.relative(path.join(DATA, "pdfs"), file).split(path.sep);
    const entry = manifest.get(rel);
    const kind = entry?.kind ?? (parts[0] === "event" ? "event" : "regulation");
    const title = entry?.title ?? titleFromFilename(path.basename(file));

    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text: pages } = await extractText(pdf, { mergePages: false });
    const chunks = chunkPages(pages);
    if (chunks.length === 0) {
      console.warn(`  ! ${rel}: no text (scanned PDF?), skipped`);
      continue;
    }

    const firstPage = pages[0] ?? "";
    const event =
      kind === "event"
        ? (entry?.event ??
          (parts.length > 2 && parts[1] !== "unknown" ? parts[1] : null) ??
          parseEventName(title) ??
          parseEventName(firstPage))
        : null;
    // Doc ids are stable per file path so re-ingesting replaces, not duplicates.
    const docId = createHash("sha256").update(rel).digest("hex").slice(0, 16);
    const document = {
      id: docId,
      title,
      kind,
      season: parseSeason(event, title, firstPage),
      event,
      docDate: parseDocDate(firstPage),
      url: entry?.url ?? null
    };

    for (let i = 0; i < chunks.length; i += BATCH) {
      await post(base, token, {
        document,
        replace: i === 0,
        chunks: chunks.slice(i, i + BATCH).map((c) => ({ ...c, id: `${docId}-${c.seq}` }))
      });
    }
    state[rel] = hash;
    await writeFile(STATE, JSON.stringify(state, null, 2));
    console.log(`  ✓ ${title} (${chunks.length} chunks${event ? `, ${event}` : ""})`);
  }
  console.log("Done");
}

await main();
