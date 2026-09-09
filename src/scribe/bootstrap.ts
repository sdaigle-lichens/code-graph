import type { DatabaseSync } from "node:sqlite";
import { getStore } from "./db.js";

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
  store.exec(`
    INSERT INTO search_fts(ref_kind, ref_key, name, purpose, tags, body_md)
      SELECT 'vertex', key,
             coalesce(json_extract(doc, '$.name'), ''),
             coalesce(json_extract(doc, '$.purpose'), ''),
             coalesce((SELECT group_concat(value, ' ') FROM json_each(doc, '$.tags')), ''),
             ''
        FROM vertices
      UNION ALL
      SELECT 'doc', key, '', '', '',
             coalesce(json_extract(doc, '$.body_md'), '')
        FROM docs
  `);
  store.exec("INSERT INTO search_fts(search_fts) VALUES('optimize')");
}

/** Creates the store file and schema if absent; safe to call repeatedly. */
export function bootstrapStore(dbPath: string): DatabaseSync {
  const store = getStore(dbPath);
  applySchema(store);
  return store;
}
