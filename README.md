# F1 Regs

A free "ask the rulebook" site for Formula 1 fans. Ask things like *"Should Antonelli have
got a track limits penalty last race?"* and get an answer that cites the FIA regulations and
the stewards' documents from that weekend.

It runs entirely on Cloudflare's free tier: Workers (site + API), Workers AI (chat model and
embeddings), Vectorize (semantic search), D1 (document store + keyword search) and a
Durable Object per visitor (chat history, via the Cloudflare Agents SDK).

## How a question gets answered

The chat agent (`src/agent.ts`) has four tools and decides which to call:

| Tool | What it does |
| --- | --- |
| `searchDocuments` | Hybrid search: Vectorize for meaning plus D1 FTS5 for literal terms like "Article 33.3" or "MGU-K", merged with reciprocal rank fusion. Can be narrowed to the rulebooks or to one race weekend. |
| `listRecentEvents` | Race weekends with documents, newest first, so "last race" resolves to a real event. |
| `listEventDocuments` | Every FIA document for one weekend (decisions, infringements, event notes). |
| `readDocument` | Full text of one document, e.g. a stewards' decision. |

So the incident question becomes: find the last event, read any decision about car 12,
look up the track limits article and the Race Director's event notes for that circuit, then
answer with citations. If the stewards published nothing about the incident, the agent says
so and explains the rule instead of inventing what happened on track.

The corpus is two kinds of FIA PDF:

- **Regulations**: F1 Sporting, Technical and Financial Regulations, plus the International
  Sporting Code and Appendix L if you add them.
- **Event documents**: stewards' decisions, infringement reports, summonses and Race Director's
  event notes, published per Grand Prix.

## Setup (one time)

You need a free Cloudflare account and Node 22+.

```sh
npm install
npx wrangler login

# Database for documents and keyword search. Paste the printed database_id into wrangler.jsonc.
npx wrangler d1 create f1regs
npx wrangler d1 migrations apply f1regs --remote

# Vector index. bge-large-en-v1.5 produces 1024-dimension vectors.
# Create the metadata indexes before ingesting, or filters won't see older vectors.
npx wrangler vectorize create f1regs-docs --dimensions=1024 --metric=cosine
npx wrangler vectorize create-metadata-index f1regs-docs --property-name=kind --type=string
npx wrangler vectorize create-metadata-index f1regs-docs --property-name=event --type=string

# Token that protects the /api/ingest endpoint. Pick any long random string.
npx wrangler secret put INGEST_TOKEN

npm run deploy
```

## Loading documents

```sh
npm run fetch-docs                       # downloads PDFs listed in sources.json into data/pdfs/
INGEST_TOKEN=... npm run ingest -- https://f1regs.<your-subdomain>.workers.dev
```

`fetch-docs` scans the FIA pages in `sources.json` for PDF links and records what it got in
`data/manifest.json`. To add an older race weekend, pass its FIA documents page:
`npm run fetch-docs -- <url>`. The FIA site layout changes from time to time, so check the
download list. You can always drop PDFs in by hand instead:

```
data/pdfs/regulation/2026_f1_sporting_regulations.pdf
data/pdfs/event/2026 Mexico City Grand Prix/decision_car_12.pdf
```

`ingest` extracts text with `unpdf`, splits it into ~900-character chunks that follow article
headings, and posts them to the Worker, which embeds them and stores them in Vectorize and
D1. It skips PDFs it has already sent unless they changed (`--force` re-sends everything).

After each race weekend, run both commands again.

## Local development

```sh
cp .dev.vars.example .dev.vars
npm run dev
```

Workers AI and Vectorize have no local emulator, so `npm run dev` uses your real Cloudflare
AI, Vectorize and D1 (they're marked `remote: true` in `wrangler.jsonc`). That means local dev
reads the same documents as production.

```sh
npm test          # unit tests (chunking, search ranking, metadata parsing)
npm run typecheck
```

## Staying free

- **Workers AI** has a daily free allowance. When it runs out, chat returns a friendly "try
  again later" message until it resets. A smaller tool-calling model stretches it further:
  change `CHAT_MODEL` in `wrangler.jsonc`.
- Each visitor gets one Durable Object holding their chat. Only the last 12 messages go to the
  model, to keep each request small.

## Layout

```
src/server.ts        Worker entry: /agents/* (chat WebSocket) and /api/ingest
src/agent.ts         Chat agent and its tools
src/search.ts        Hybrid Vectorize + D1 search
src/documents.ts     Event listing, document reading, ingestion
src/prompt.ts        System prompt and abbreviation glossary
src/chunking.ts      PDF text chunker (shared with the ingest script)
src/client/          React chat page
migrations/          D1 schema
scripts/             fetch-docs and ingest
```

Unofficial fan project, not affiliated with the FIA or Formula 1.
