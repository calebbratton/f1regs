-- One row per ingested PDF (a regulation book, or one FIA event document).
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  -- 'regulation' (Sporting/Technical/Financial regs, ISC, Appendix L)
  -- or 'event' (stewards' decisions, Race Director's event notes, etc.)
  kind TEXT NOT NULL CHECK (kind IN ('regulation', 'event')),
  season INTEGER,
  -- Event name, e.g. '2026 Dutch Grand Prix'. NULL for regulations.
  event TEXT,
  -- ISO date the FIA document was issued, when it could be parsed.
  doc_date TEXT,
  url TEXT,
  ingested_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX documents_event ON documents (event, doc_date);

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  page INTEGER,
  -- Regulation article in effect at the start of the chunk, e.g. '33.3'.
  article TEXT,
  text TEXT NOT NULL
);

CREATE INDEX chunks_doc ON chunks (doc_id, seq);

-- Keyword index for literal lookups ("Article 54.3", "MGU-K", car numbers)
-- that embedding search tends to miss.
CREATE VIRTUAL TABLE chunks_fts USING fts5 (
  text,
  article,
  content = 'chunks',
  content_rowid = 'rowid',
  tokenize = 'porter unicode61'
);

CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts (rowid, text, article) VALUES (new.rowid, new.text, new.article);
END;

CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts (chunks_fts, rowid, text, article) VALUES ('delete', old.rowid, old.text, old.article);
END;

CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts (chunks_fts, rowid, text, article) VALUES ('delete', old.rowid, old.text, old.article);
  INSERT INTO chunks_fts (rowid, text, article) VALUES (new.rowid, new.text, new.article);
END;
