import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applySchema, rebuildSearchIndex, SCHEMA_VERSION, FTS_WEIGHTS } from "./bootstrap.js";

let db: DatabaseSync;

const putVertex = (key: string, doc: Record<string, unknown>) =>
  db.prepare("INSERT INTO vertices(key, doc) VALUES(?, ?)").run(key, JSON.stringify(doc));
const putEdge = (key: string, doc: Record<string, unknown>) =>
  db.prepare("INSERT INTO edges(key, doc) VALUES(?, ?)").run(key, JSON.stringify(doc));
const putDoc = (key: string, doc: Record<string, unknown>) =>
  db.prepare("INSERT INTO docs(key, doc) VALUES(?, ?)").run(key, JSON.stringify(doc));

const vertex = (over: Record<string, unknown> = {}) => ({
  _key: "v1",
  concept: "wo",
  type: "function",
  name: "setIndex",
  filepath: "src/store/wo.ts",
  start_line: 10,
  end_line: 20,
  status: "live",
  ...over,
});

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  applySchema(db);
});

describe("schema", () => {
  it("creates every table and the fts index", () => {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const t of ["vertices", "edges", "docs", "concepts", "search_fts"]) {
      assert.ok(names.includes(t), `missing ${t}`);
    }
  });

  it("stamps the schema version", () => {
    const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
    assert.equal(row.user_version, SCHEMA_VERSION);
  });

  it("is idempotent", () => {
    applySchema(db);
    applySchema(db);
    putVertex("v1", vertex());
    assert.equal((db.prepare("SELECT count(*) c FROM vertices").get() as { c: number }).c, 1);
  });
});

describe("generated columns", () => {
  it("projects vertex fields out of the doc column", () => {
    putVertex("v1", vertex());
    const r = db
      .prepare("SELECT concept, status, type, name, filepath, start_line, end_line FROM vertices")
      .get() as Record<string, unknown>;
    assert.deepEqual(
      { ...r },
      {
        concept: "wo",
        status: "live",
        type: "function",
        name: "setIndex",
        filepath: "src/store/wo.ts",
        start_line: 10,
        end_line: 20,
      }
    );
  });

  it("leaves purpose null when the vertex is un-enriched", () => {
    putVertex("v1", vertex());
    assert.equal((db.prepare("SELECT purpose FROM vertices").get() as { purpose: unknown }).purpose, null);
  });

  it("splits edge handles into ids and keys", () => {
    putEdge("e1", { _from: "vertices/aaa", _to: "vertices/bbb", type: "calls", concept: "wo", crosses_concept: false });
    const r = db.prepare("SELECT from_id, to_id, from_key, to_key, type, crosses_concept FROM edges").get() as Record<
      string,
      unknown
    >;
    assert.deepEqual(
      { ...r },
      {
        from_id: "vertices/aaa",
        to_id: "vertices/bbb",
        from_key: "aaa",
        to_key: "bbb",
        type: "calls",
        crosses_concept: 0,
      }
    );
  });

  it("keeps `::` intact when the handle points at a skill doc", () => {
    putEdge("e1", { _from: "docs/wo::skill", _to: "concepts/wo", type: "describes", crosses_concept: true });
    const r = db.prepare("SELECT from_key, to_key, crosses_concept FROM edges").get() as Record<string, unknown>;
    assert.deepEqual({ ...r }, { from_key: "wo::skill", to_key: "wo", crosses_concept: 1 });
  });

  it("reads authored_by out of the nested agent object", () => {
    putEdge("e1", { _from: "vertices/a", _to: "vertices/b", type: "triggers", agent: { authored_by: "claude" } });
    putEdge("e2", { _from: "vertices/a", _to: "vertices/c", type: "calls", agent: { authored_by: null } });
    const rows = db.prepare("SELECT key FROM edges WHERE authored_by IS NOT NULL").all();
    assert.deepEqual(
      rows.map((r) => (r as { key: string }).key),
      ["e1"]
    );
  });
});

describe("indexes", () => {
  const planFor = (sql: string) =>
    db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all()
      .map((r) => (r as { detail: string }).detail)
      .join(" | ");

  it("uses the concept+status index rather than scanning", () => {
    const plan = planFor("SELECT doc FROM vertices WHERE concept = 'wo' AND status = 'live'");
    assert.match(plan, /idx_v_concept_status/);
  });

  it("uses the inbound edge index for traversals", () => {
    const plan = planFor("SELECT doc FROM edges WHERE to_id = 'vertices/a' AND type IN ('calls')");
    assert.match(plan, /idx_e_to_type/);
  });

  it("uses the file+line index for position lookups", () => {
    const plan = planFor("SELECT doc FROM vertices WHERE filepath = 'a.ts' AND start_line <= 5 AND end_line >= 5");
    assert.match(plan, /idx_v_file_line/);
  });
});

describe("rebuildSearchIndex", () => {
  const weights = `${FTS_WEIGHTS.name}, ${FTS_WEIGHTS.purpose}, ${FTS_WEIGHTS.tags}, ${FTS_WEIGHTS.body_md}`;
  const rank = (match: string) =>
    db
      .prepare(
        `SELECT ref_key, -bm25(search_fts, 0.0, 0.0, ${weights}) AS score
                  FROM search_fts WHERE search_fts MATCH ? ORDER BY score DESC`
      )
      .all(match)
      .map((r) => (r as { ref_key: string }).ref_key);

  beforeEach(() => {
    putVertex(
      "v1",
      vertex({
        name: "setWorkorderIndex",
        purpose: "re-indexes the whole array after reordering",
        tags: ["store", "util"],
      })
    );
    putVertex("v2", vertex({ _key: "v2", name: "plainHelper" }));
    putDoc("wo::skill", {
      _key: "wo::skill",
      concept: "wo",
      kind: "skill",
      path: "S.md",
      body_md: "the workorder store owns pending operations",
      body_hash: "h",
    });
    rebuildSearchIndex(db);
  });

  it("indexes vertices and docs into one table", () => {
    const rows = db
      .prepare("SELECT ref_kind, ref_key FROM search_fts ORDER BY ref_key")
      .all()
      .map((r) => ({ ...(r as object) }));
    assert.deepEqual(rows, [
      { ref_kind: "vertex", ref_key: "v1" },
      { ref_kind: "vertex", ref_key: "v2" },
      { ref_kind: "doc", ref_key: "wo::skill" },
    ]);
  });

  it("flattens tag arrays and defaults missing fields to empty", () => {
    const r = db.prepare("SELECT tags, purpose FROM search_fts WHERE ref_key = 'v1'").get() as Record<string, string>;
    assert.equal(r.tags, "store util");
    const r2 = db.prepare("SELECT tags, purpose FROM search_fts WHERE ref_key = 'v2'").get() as Record<string, string>;
    assert.deepEqual([r2.tags, r2.purpose], ["", ""]);
  });

  it("is idempotent — a second rebuild does not duplicate rows", () => {
    rebuildSearchIndex(db);
    assert.equal((db.prepare("SELECT count(*) c FROM search_fts").get() as { c: number }).c, 3);
  });

  it("stems, so a query term matches an inflected form", () => {
    assert.deepEqual(rank('"reorder"'), ["v1"]);
    assert.deepEqual(rank('"index"'), ["v1"]); // "re-indexes" -> re, index
  });

  it("does not split camelCase identifiers", () => {
    // unicode61 tokenizes `setWorkorderIndex` whole, so a bare "workorder"
    // reaches it only through purpose/tags/body — never through its name. The
    // ArangoSearch text_en analyzer behaved the same way; the exact-name sort
    // tier in search.ts is what makes a full identifier query land first.
    assert.deepEqual(rank('"workorder"'), ["wo::skill"]);
    assert.deepEqual(rank('"setworkorderindex"'), ["v1"]);
  });

  it("orders name over purpose over body under the column weights", () => {
    putVertex("n1", vertex({ _key: "n1", name: "pending" }));
    putVertex("n2", vertex({ _key: "n2", name: "other", purpose: "clears the pending buffer" }));
    rebuildSearchIndex(db);
    // wo::skill's body_md also contains "pending", so all three compete.
    assert.deepEqual(rank('"pending"'), ["n1", "n2", "wo::skill"]);
  });

  it("returns positive scores after negation, so larger is better", () => {
    const row = db
      .prepare(
        `SELECT -bm25(search_fts, 0.0, 0.0, ${weights}) AS score
                  FROM search_fts WHERE search_fts MATCH ? ORDER BY score DESC LIMIT 1`
      )
      .get('"index"') as { score: number };
    assert.ok(row.score > 0, `expected a positive score, got ${row.score}`);
  });
});

describe("doc column fidelity", () => {
  it("round-trips an explicit null distinctly from an absent key", () => {
    putVertex("v1", vertex({ document_ref: null }));
    const parsed = JSON.parse((db.prepare("SELECT doc FROM vertices").get() as { doc: string }).doc);
    assert.equal(parsed.document_ref, null);
    assert.ok("document_ref" in parsed);
    assert.ok(!("purpose" in parsed), "absent keys must stay absent");
  });

  it("preserves nested objects and arrays verbatim", () => {
    const v = vertex({
      tags: ["a", "b"],
      ast: { extracted_at: "t", extractor_version: "1" },
      agent: { authored_by: null, stale: false },
    });
    putVertex("v1", v);
    assert.deepEqual(JSON.parse((db.prepare("SELECT doc FROM vertices").get() as { doc: string }).doc), v);
  });
});
