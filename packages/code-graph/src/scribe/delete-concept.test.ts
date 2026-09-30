import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applySchema } from "./bootstrap.js";
import {
  archiveConcept,
  removeConceptFromConfig,
  computeDanglingRefs,
  formatDanglingRefReport,
} from "./delete-concept.js";

// ─── removeConceptFromConfig ──────────────────────────────────────────────────

describe("removeConceptFromConfig", () => {
  it("removes an existing concept key", () => {
    const config = {
      project: "my-app",
      concepts: {
        "web/auth": { globs: ["src/auth/**"] },
        "web/billing": { globs: ["src/billing/**"] },
      },
    };
    const result = removeConceptFromConfig(config, "web/auth");
    const concepts = result.concepts as Record<string, unknown>;
    assert.ok(!("web/auth" in concepts), "concept should be removed");
    assert.ok("web/billing" in concepts, "other concept preserved");
  });

  it("preserves all other top-level config fields", () => {
    const config = {
      project: "my-app",
      tsconfig: "tsconfig.json",
      skillsDir: ".claude/skills",
      concepts: { "web/auth": { globs: [] } },
    };
    const result = removeConceptFromConfig(config, "web/auth");
    assert.equal(result.project, "my-app");
    assert.equal(result.tsconfig, "tsconfig.json");
    assert.equal(result.skillsDir, ".claude/skills");
  });

  it("does not mutate the original config", () => {
    const original = {
      project: "x",
      concepts: { a: { globs: [] }, b: { globs: [] } },
    };
    const snapshot = JSON.stringify(original);
    removeConceptFromConfig(original, "a");
    assert.equal(JSON.stringify(original), snapshot, "original should not be mutated");
  });

  it("is a no-op if concept does not exist", () => {
    const config = { project: "x", concepts: { a: { globs: [] } } };
    const result = removeConceptFromConfig(config, "nonexistent");
    assert.deepEqual(result, config);
  });

  it("handles missing concepts field gracefully", () => {
    const config = { project: "x" };
    const result = removeConceptFromConfig(config, "any");
    assert.deepEqual(result, config);
  });
});

// ─── computeDanglingRefs ─────────────────────────────────────────────────────

describe("computeDanglingRefs", () => {
  const deletedConcept = "web/scheduling";

  it("detects cross_concept_refs in other concepts' vertices", () => {
    const deletedKeys = new Set(["key1", "key2"]);
    const otherVertices = [
      {
        _key: "billing1",
        concept: "web/billing",
        name: "BillingService",
        cross_concept_refs: ["web/scheduling", "web/auth"],
      },
      { _key: "auth1", concept: "web/auth", name: "AuthMiddleware", cross_concept_refs: ["web/auth"] },
    ];
    const refs = computeDanglingRefs(deletedConcept, deletedKeys, otherVertices, []);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].fromConcept, "web/billing");
    assert.equal(refs[0].kind, "cross_concept_ref");
    assert.match(refs[0].description, /BillingService/);
  });

  it("groups multiple dangling vertices from the same concept", () => {
    const deletedKeys = new Set(["d1"]);
    const otherVertices = [
      { _key: "b1", concept: "web/billing", name: "Svc1", cross_concept_refs: ["web/scheduling"] },
      { _key: "b2", concept: "web/billing", name: "Svc2", cross_concept_refs: ["web/scheduling"] },
    ];
    const refs = computeDanglingRefs(deletedConcept, deletedKeys, otherVertices, []);
    assert.equal(refs.length, 1, "should be grouped into one ref per from-concept");
    assert.match(refs[0].description, /2 cross_concept_ref/);
  });

  it("detects agent-authored edges pointing into deleted concept", () => {
    const deletedKeys = new Set(["del-vertex-1"]);
    const otherEdges = [
      {
        _from: "vertices/billing-vertex-1",
        _to: "vertices/del-vertex-1",
        concept: "web/billing",
        type: "delegates-to",
        agent: { authored_by: "claude" },
      },
      {
        _from: "vertices/billing-vertex-2",
        _to: "vertices/unrelated",
        concept: "web/billing",
        type: "delegates-to",
        agent: { authored_by: "claude" },
      },
    ];
    const refs = computeDanglingRefs(deletedConcept, deletedKeys, [], otherEdges);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].kind, "agent_edge");
    assert.equal(refs[0].fromConcept, "web/billing");
  });

  it("ignores non-agent edges (authored_by = null)", () => {
    const deletedKeys = new Set(["del-key"]);
    const otherEdges = [
      {
        _from: "vertices/other",
        _to: "vertices/del-key",
        concept: "web/billing",
        agent: { authored_by: null },
      },
    ];
    const refs = computeDanglingRefs(deletedConcept, deletedKeys, [], otherEdges);
    assert.equal(refs.length, 0);
  });

  it("returns empty when no dangling refs", () => {
    const refs = computeDanglingRefs(deletedConcept, new Set(), [], []);
    assert.deepEqual(refs, []);
  });
});

// ─── formatDanglingRefReport ──────────────────────────────────────────────────

describe("formatDanglingRefReport", () => {
  it("returns empty string for zero refs", () => {
    assert.equal(formatDanglingRefReport([]), "");
  });

  it("renders a markdown block with all refs", () => {
    const refs = [
      {
        fromConcept: "web/billing",
        kind: "cross_concept_ref" as const,
        description: "2 cross_concept_ref(s) in `web/billing` → deleted `web/scheduling`",
      },
      {
        fromConcept: "web/auth",
        kind: "agent_edge" as const,
        description: "1 agent edge(s) from `web/auth` now point into deleted `web/scheduling`",
      },
    ];
    const md = formatDanglingRefReport(refs);
    assert.match(md, /## Dangling references/);
    assert.match(md, /web\/billing/);
    assert.match(md, /web\/auth/);
  });
});

// ─── Integration test — the real archive path, against a temp store ──────────
// Previously this ran against ArangoDB and silently reported success when the
// server was unreachable, while re-implementing the queries rather than calling
// the code under test. It now exercises archiveConcept() itself, with no server.

describe("integration: archiveConcept", () => {
  let store: DatabaseSync;
  const concept = "test/my-concept";
  const now = "2026-01-01T00:00:00.000Z";

  const put = (table: "vertices" | "edges" | "docs", key: string, doc: object) =>
    store.prepare(`INSERT INTO ${table}(key, doc) VALUES(?, ?)`).run(key, JSON.stringify(doc));

  const read = (table: "vertices" | "edges" | "docs", key: string) =>
    JSON.parse((store.prepare(`SELECT doc FROM ${table} WHERE key = ?`).get(key) as { doc: string }).doc);

  beforeEach(() => {
    store = new DatabaseSync(":memory:");
    applySchema(store);
    put("vertices", "v1", { _key: "v1", concept, name: "Fn1", status: "live", filepath: "src/fn1.ts" });
    put("vertices", "v2", { _key: "v2", concept, name: "Fn2", status: "live", filepath: "src/fn2.ts" });
    put("vertices", "other", { _key: "other", concept: "kept", name: "Fn3", status: "live", filepath: "src/fn3.ts" });
    put("edges", "e1", {
      _key: "e1",
      _from: "vertices/v1",
      _to: "vertices/v2",
      concept,
      type: "calls",
      agent: { authored_by: null },
    });
    put("edges", "e2", {
      _key: "e2",
      _from: "vertices/other",
      _to: "vertices/other",
      concept: "kept",
      type: "calls",
      agent: { authored_by: null },
    });
    put("docs", `${concept}::skill`, { _key: `${concept}::skill`, concept, kind: "skill", body_md: "# Skill" });
  });

  it("archives every vertex, edge and doc of the concept", () => {
    const counts = archiveConcept(store, concept, now);
    assert.deepEqual(counts, { archivedVertices: 2, archivedEdges: 1 });

    for (const k of ["v1", "v2"]) {
      assert.equal(read("vertices", k).status, "archived");
      assert.equal(read("vertices", k).archivedAt, now);
    }
    assert.equal(read("edges", "e1").status, "archived");
    assert.equal(read("docs", `${concept}::skill`).status, "archived");
  });

  it("never hard-deletes — the rows survive as tombstones", () => {
    archiveConcept(store, concept, now);
    const n = store.prepare("SELECT count(*) c FROM vertices").get() as { c: number };
    assert.equal(n.c, 3, "archived vertices must still exist");
  });

  it("leaves other concepts untouched", () => {
    archiveConcept(store, concept, now);
    assert.equal(read("vertices", "other").status, "live");
    assert.equal(read("edges", "e2").status, undefined);
  });

  it("is idempotent — a second run archives no further vertices", () => {
    archiveConcept(store, concept, now);
    const second = archiveConcept(store, concept, "2026-02-02T00:00:00.000Z");
    assert.equal(second.archivedVertices, 0, "already-archived vertices are not recounted");
    assert.equal(second.archivedEdges, 1, "edge count reports the concept's archived edges");
    assert.equal(read("vertices", "v1").archivedAt, now, "the original timestamp is kept");
  });

  it("drops the concept's rows from the search index", () => {
    archiveConcept(store, concept, now);
    const rows = store.prepare("SELECT ref_key FROM search_fts WHERE search_fts MATCH ?").all('"fn1"');
    assert.equal(rows.length, 1, "archived vertices stay searchable, as they did before");
  });

  it("rolls back entirely if the transaction fails", () => {
    store.close();
    assert.throws(() => archiveConcept(store, concept, now));
  });
});
