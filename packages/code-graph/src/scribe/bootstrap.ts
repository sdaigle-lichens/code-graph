import type { DatabaseSync } from "node:sqlite";
import { getStore } from "./db.js";
import { nameIndexText } from "./rows.js";

/**
 * Every table stores its payload in a JSON `doc` column, with VIRTUAL generated
 * columns projecting only the fields that are filtered or sorted on.
 *
 * The point of the doc column is fidelity: `SELECT doc` hands back exactly the
 * object that was written, so the query results, the `--json` payloads, the
 * markdown formatter and the LSP's own copy of these types all keep working
 * without a field-by-field mapping that could quietly turn an absent key into
 * an explicit null. It also absorbs `status`/`archivedAt`, which delete-concept
 * writes onto edges and docs but which appear in no schema.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS vertices (
  key  TEXT PRIMARY KEY,
  doc  TEXT NOT NULL,
  concept    TEXT    GENERATED ALWAYS AS (json_extract(doc, '$.concept'))    VIRTUAL,
  status     TEXT    GENERATED ALWAYS AS (json_extract(doc, '$.status'))     VIRTUAL,
  type       TEXT    GENERATED ALWAYS AS (json_extract(doc, '$.type'))       VIRTUAL,
  name       TEXT    GENERATED ALWAYS AS (json_extract(doc, '$.name'))       VIRTUAL,
  filepath   TEXT    GENERATED ALWAYS AS (json_extract(doc, '$.filepath'))   VIRTUAL,
  start_line INTEGER GENERATED ALWAYS AS (json_extract(doc, '$.start_line')) VIRTUAL,
  end_line   INTEGER GENERATED ALWAYS AS (json_extract(doc, '$.end_line'))   VIRTUAL,
  purpose    TEXT    GENERATED ALWAYS AS (json_extract(doc, '$.purpose'))    VIRTUAL
);
CREATE INDEX IF NOT EXISTS idx_v_concept_status ON vertices(concept, status);
CREATE INDEX IF NOT EXISTS idx_v_concept_type   ON vertices(concept, type);
CREATE INDEX IF NOT EXISTS idx_v_name           ON vertices(name);
CREATE INDEX IF NOT EXISTS idx_v_file_line      ON vertices(filepath, start_line, end_line);

CREATE TABLE IF NOT EXISTS edges (
  key TEXT PRIMARY KEY,
  doc TEXT NOT NULL,
  from_id  TEXT GENERATED ALWAYS AS (json_extract(doc, '$._from')) VIRTUAL,
  to_id    TEXT GENERATED ALWAYS AS (json_extract(doc, '$._to'))   VIRTUAL,
  from_key TEXT GENERATED ALWAYS AS
    (substr(json_extract(doc, '$._from'), instr(json_extract(doc, '$._from'), '/') + 1)) VIRTUAL,
  to_key   TEXT GENERATED ALWAYS AS
    (substr(json_extract(doc, '$._to'),   instr(json_extract(doc, '$._to'),   '/') + 1)) VIRTUAL,
  type    TEXT GENERATED ALWAYS AS (json_extract(doc, '$.type'))    VIRTUAL,
  concept TEXT GENERATED ALWAYS AS (json_extract(doc, '$.concept')) VIRTUAL,
  crosses_concept INTEGER GENERATED ALWAYS AS
    (CASE WHEN json_extract(doc, '$.crosses_concept') THEN 1 ELSE 0 END) VIRTUAL,
  authored_by TEXT GENERATED ALWAYS AS (json_extract(doc, '$.agent.authored_by')) VIRTUAL
);
CREATE INDEX IF NOT EXISTS idx_e_to_type      ON edges(to_id, type);
CREATE INDEX IF NOT EXISTS idx_e_from_type    ON edges(from_id, type);
CREATE INDEX IF NOT EXISTS idx_e_concept_type ON edges(concept, type);
CREATE INDEX IF NOT EXISTS idx_e_cross        ON edges(crosses_concept) WHERE crosses_concept = 1;

CREATE TABLE IF NOT EXISTS docs (
  key TEXT PRIMARY KEY,
  doc TEXT NOT NULL,
  concept TEXT GENERATED ALWAYS AS (json_extract(doc, '$.concept')) VIRTUAL
);

CREATE TABLE IF NOT EXISTS concepts (
  key TEXT PRIMARY KEY,
  doc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  ref_kind UNINDEXED,
  ref_key  UNINDEXED,
  name,
  purpose,
  tags,
  body_md,
  tokenize = 'porter unicode61'
);
`;

/** Bumped when the schema changes in a way an older binary cannot read. */
export const SCHEMA_VERSION = 1;

/**
 * Format of the `search_fts` rows, stored in `meta` (`fts_format`) by `rebuildSearchIndex`. Bump it
 * whenever the indexed text changes (1 = raw names; 2 = names split into words, 0.3.16). `search`
 * reindexes once when the store holds a lower value. Not a schema change: no SCHEMA_VERSION bump.
 */
export const FTS_FORMAT = 2;

/** Column weights for bm25(), mirroring the boosts the ArangoSearch view used. */
export const FTS_WEIGHTS = { name: 3.0, purpose: 2.0, tags: 1.5, body_md: 1.0 };

export function applySchema(store: DatabaseSync): void {
  store.exec(SCHEMA_SQL);
  store.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/**
 * Rebuilds the whole full-text index from `vertices` + `docs`.
 *
 * Wholesale rather than incremental: a standalone FTS5 table does not index its
 * UNINDEXED columns, so deleting one row by ref_key costs a full scan and
 * per-row upkeep would make `apply` quadratic. A complete rebuild is a few
 * hundred milliseconds even on a large project, and `apply` is not a hot path.
 *
 * Vertices and docs share one table because bm25() scores are only comparable
 * within a single FTS index, and the seed query ranks both kinds together.
 */
export function rebuildSearchIndex(store: DatabaseSync): void {
  store.exec("DELETE FROM search_fts");
  // Names are split into words in JS (`nameIndexText`): SQLite cannot split camelCase.
  const vertexRows = store
    .prepare(
      `SELECT key,
              coalesce(json_extract(doc, '$.name'), '') AS name,
              coalesce(json_extract(doc, '$.purpose'), '') AS purpose,
              coalesce((SELECT group_concat(value, ' ') FROM json_each(doc, '$.tags')), '') AS tags
         FROM vertices`
    )
    .all() as Array<{ key: string; name: string; purpose: string; tags: string }>;
  const insertVertex = store.prepare(
    "INSERT INTO search_fts(ref_kind, ref_key, name, purpose, tags, body_md) VALUES ('vertex', ?, ?, ?, ?, '')"
  );
  for (const r of vertexRows) insertVertex.run(r.key, nameIndexText(r.name), r.purpose, r.tags);
  store.exec(`
    INSERT INTO search_fts(ref_kind, ref_key, name, purpose, tags, body_md)
      SELECT 'doc', key, '', '', '',
             coalesce(json_extract(doc, '$.body_md'), '')
        FROM docs
  `);
  store.exec("INSERT INTO search_fts(search_fts) VALUES('optimize')");
  store
    .prepare(
      "INSERT INTO meta(key, value) VALUES ('fts_format', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(String(FTS_FORMAT));
}

/** The FTS row format the index was built with; 0 when never recorded (built before 0.3.18). */
export function storedFtsFormat(store: DatabaseSync): number {
  const row = store.prepare("SELECT value FROM meta WHERE key = 'fts_format'").get() as { value: string } | undefined;
  return row ? Number(row.value) || 0 : 0;
}

export type IndexFormatCheck = "current" | "rebuilt" | "unwritable";

/**
 * Brings an index built by an older code-graph up to `FTS_FORMAT`: rebuilds it once, or reports
 * `unwritable` (the caller tells the user to run `code-graph reindex`). A store with nothing to
 * index is left alone.
 */
export function ensureSearchIndexFormat(store: DatabaseSync): IndexFormatCheck {
  if (storedFtsFormat(store) >= FTS_FORMAT) return "current";
  const n = store.prepare("SELECT (SELECT count(*) FROM vertices) + (SELECT count(*) FROM docs) AS n").get() as {
    n: number;
  };
  if (n.n === 0) return "current";
  try {
    store.exec("BEGIN IMMEDIATE");
    try {
      rebuildSearchIndex(store);
      store.exec("COMMIT");
    } catch (err) {
      store.exec("ROLLBACK");
      throw err;
    }
    return "rebuilt";
  } catch {
    return "unwritable";
  }
}

/** Creates the store file and schema if absent; safe to call repeatedly. */
export function bootstrapStore(dbPath: string): DatabaseSync {
  const store = getStore(dbPath);
  applySchema(store);
  return store;
}
