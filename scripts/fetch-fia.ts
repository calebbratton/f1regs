// Downloads FIA PDFs listed in sources.json into data/pdfs/ and records them
// in data/manifest.json for `npm run ingest`.
//
//   npm run fetch-docs                 # everything in sources.json
//   npm run fetch-docs -- <page-url>   # one extra event page (e.g. a past race)
//
// You can also skip this script and drop PDFs in by hand:
//   data/pdfs/regulation/<file>.pdf
//   data/pdfs/event/<2026 Dutch Grand Prix>/<file>.pdf
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseEventName, titleFromFilename } from "./metadata.ts";

interface PageSource {
  page: string;
  include?: string;
  exclude?: string;
}

interface Sources {
  regulations: PageSource[];
  events: PageSource[];
  extraUrls: { url: string; kind: "regulation" | "event"; event?: string }[];
}

export interface ManifestEntry {
  file: string;
  url: string;
  title: string;
  kind: "regulation" | "event";
  event: string | null;
}

const DATA = path.resolve("data");
const MANIFEST = path.join(DATA, "manifest.json");
const UA = "f1regs-fetcher (+https://github.com/calebbratton/f1regs)";

// JS regexes have no inline (?i); accept it in sources.json for readability.
function toRegex(src?: string) {
  if (!src) return null;
  const ci = src.startsWith("(?i)");
  return new RegExp(ci ? src.slice(4) : src, ci ? "i" : "");
}

function decode(s: string) {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** All PDF links on a page as { url, text }. */
export function pdfLinks(html: string, base: string) {
  const links: { url: string; text: string }[] = [];
  const re = /<a\b[^>]*href="([^"]+\.pdf(?:\?[^"]*)?)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    const url = new URL(m[1].replace(/&amp;/g, "&"), base).toString();
    const text = decode(m[2]) || decodeURIComponent(path.basename(new URL(url).pathname));
    links.push({ url, text });
  }
  return [...new Map(links.map((l) => [l.url, l])).values()];
}

async function get(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

async function download(entry: Omit<ManifestEntry, "file">, manifest: Map<string, ManifestEntry>) {
  if (manifest.has(entry.url)) return false;
  const name = decodeURIComponent(path.basename(new URL(entry.url).pathname));
  const dir =
    entry.kind === "regulation"
      ? path.join(DATA, "pdfs", "regulation")
      : path.join(DATA, "pdfs", "event", entry.event ?? "unknown");
  await mkdir(dir, { recursive: true });
  let file = path.join(dir, name);
  if (existsSync(file)) {
    const hash = createHash("sha1").update(entry.url).digest("hex").slice(0, 6);
    file = file.replace(/\.pdf$/i, `-${hash}.pdf`);
  }
  const bytes = Buffer.from(await (await get(entry.url)).arrayBuffer());
  await writeFile(file, bytes);
  manifest.set(entry.url, { ...entry, file: path.relative(DATA, file) });
  console.log(`  ↓ ${entry.title}`);
  return true;
}

async function scan(source: PageSource, kind: "regulation" | "event") {
  const html = await (await get(source.page)).text();
  const include = toRegex(source.include);
  const exclude = toRegex(source.exclude);
  return pdfLinks(html, source.page).filter(
    (l) => (!include || include.test(l.text + " " + l.url)) && !(exclude && exclude.test(l.text))
  ).map((l) => ({
    url: l.url,
    title: l.text.endsWith(".pdf") ? titleFromFilename(l.text) : l.text,
    kind,
    event: kind === "event" ? parseEventName(l.text) ?? parseEventName(l.url) : null
  }));
}

async function main() {
  const sources: Sources = JSON.parse(await readFile("sources.json", "utf8"));
  const extraPages = process.argv.slice(2);
  const manifest = new Map<string, ManifestEntry>(
    existsSync(MANIFEST)
      ? (JSON.parse(await readFile(MANIFEST, "utf8")) as ManifestEntry[]).map((e) => [e.url, e])
      : []
  );

  const jobs: [PageSource, "regulation" | "event"][] = [
    ...sources.regulations.map((s) => [s, "regulation"] as [PageSource, "regulation"]),
    ...[...sources.events, ...extraPages.map((page) => ({ page }))].map(
      (s) => [s, "event"] as [PageSource, "event"]
    )
  ];

  let added = 0;
  for (const [source, kind] of jobs) {
    console.log(`Scanning ${source.page}`);
    try {
      const found = await scan(source, kind);
      console.log(`  ${found.length} matching PDFs`);
      for (const entry of found) if (await download(entry, manifest)) added++;
    } catch (err) {
      console.error(`  failed: ${(err as Error).message}`);
    }
  }
  for (const extra of sources.extraUrls) {
    const name = decodeURIComponent(path.basename(new URL(extra.url).pathname));
    const entry = {
      url: extra.url,
      title: titleFromFilename(name),
      kind: extra.kind,
      event: extra.event ?? (extra.kind === "event" ? parseEventName(name) : null)
    };
    if (await download(entry, manifest)) added++;
  }

  await mkdir(DATA, { recursive: true });
  await writeFile(MANIFEST, JSON.stringify([...manifest.values()], null, 2));
  console.log(`Done: ${added} new PDFs, ${manifest.size} in data/manifest.json`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
