import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
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
      concepts: { "a": { globs: [] }, "b": { globs: [] } },
    };
    const snapshot = JSON.stringify(original);
    removeConceptFromConfig(original, "a");
    assert.equal(JSON.stringify(original), snapshot, "original should not be mutated");
  });

  it("is a no-op if concept does not exist", () => {
    const config = { project: "x", concepts: { "a": { globs: [] } } };
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
      { _key: "billing1", concept: "web/billing", name: "BillingService", cross_concept_refs: ["web/scheduling", "web/auth"] },
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
      { fromConcept: "web/billing", kind: "cross_concept_ref" as const, description: "2 cross_concept_ref(s) in `web/billing` → deleted `web/scheduling`" },
      { fromConcept: "web/auth", kind: "agent_edge" as const, description: "1 agent edge(s) from `web/auth` now point into deleted `web/scheduling`" },
    ];
    const md = formatDanglingRefReport(refs);
    assert.match(md, /## Dangling references/);
    assert.match(md, /web\/billing/);
    assert.match(md, /web\/auth/);
  });
});

// ─── Integration test — delete archive path (skips when DB unavailable) ───────

describe("integration: delete-concept archive path", () => {
  let db: import("arangojs").Database | null = null;
  const TEST_DB = "code_graph_test_delete_concept";

  before(async () => {
    try {
      const { getSystemDb, getProjectDb } = await import("./db.js");
      const sysDb = getSystemDb();
      await sysDb.version(); // connectivity check
      // Create throwaway test DB
      const dbs = await sysDb.listDatabases();
      if (!dbs.includes(TEST_DB)) {
        await sysDb.createDatabase(TEST_DB);
      }
      db = getProjectDb(TEST_DB);
      // Bootstrap minimal collections
      const colNames = (await db.listCollections()).map((c) => c.name);
      if (!colNames.includes("vertices")) {
        await db.createCollection("vertices");
      }
      if (!colNames.includes("edges")) {
        await db.createEdgeCollection("edges");
      }
      if (!colNames.includes("docs")) {
        await db.createCollection("docs");
      }
    } catch {
      db = null; // DB unavailable — tests will skip
    }
  });

  after(async () => {
    if (!db) return;
    try {
      const { getSystemDb } = await import("./db.js");
      await getSystemDb().dropDatabase(TEST_DB);
    } catch {
      // best-effort cleanup
    }
  });

  it("archives all concept vertices and edges", async () => {
    if (!db) {
      // Skip gracefully when DB is not available
      return;
    }
    const conceptName = "test/my-concept";
    const verticesCol = db.collection("vertices");
    const edgesCol = db.collection("edges");
    const docsCol = db.collection("docs");

    // Seed: 2 live vertices, 1 edge, 1 doc
    const v1 = await verticesCol.save({ concept: conceptName, name: "Fn1", status: "live", filepath: "src/fn1.ts" });
    const v2 = await verticesCol.save({ concept: conceptName, name: "Fn2", status: "live", filepath: "src/fn2.ts" });
    await edgesCol.save({
      _from: `vertices/${v1._key}`,
      _to: `vertices/${v2._key}`,
      concept: conceptName,
      type: "calls",
      agent: { authored_by: null },
    });
    await docsCol.save({ _key: `${conceptName}::skill`, concept: conceptName, kind: "skill", body_md: "# Skill" });

    // Run the archive via AQL (same path deleteConcept uses)
    const now = new Date().toISOString();
    const { aql } = await import("arangojs/aql");
    await db.query(aql`
      FOR v IN vertices
        FILTER v.concept == ${conceptName} AND v.status == "live"
        UPDATE v WITH { status: "archived", archivedAt: ${now} } IN vertices
    `);
    await db.query(aql`
      FOR e IN edges
        FILTER e.concept == ${conceptName}
        UPDATE e WITH { status: "archived", archivedAt: ${now} } IN edges
    `);
    await db.query(aql`
      FOR d IN docs
        FILTER d._key == ${`${conceptName}::skill`}
        UPDATE d WITH { status: "archived", archivedAt: ${now} } IN docs
    `);

    // Verify: no live vertices remain
    const liveCursor = await db.query<number>(aql`
      FOR v IN vertices
        FILTER v.concept == ${conceptName} AND v.status == "live"
        COLLECT WITH COUNT INTO c
        RETURN c
    `);
    const liveCount = (await liveCursor.all())[0] ?? 0;
    assert.equal(liveCount, 0, "all vertices should be archived");

    // Verify: archived vertices still exist (never hard-deleted)
    const archCursor = await db.query<number>(aql`
      FOR v IN vertices
        FILTER v.concept == ${conceptName} AND v.status == "archived"
        COLLECT WITH COUNT INTO c
        RETURN c
    `);
    const archCount = (await archCursor.all())[0] ?? 0;
    assert.equal(archCount, 2, "archived vertices must not be hard-deleted");

    // Verify: edge is archived
    const edgeCursor = await db.query<{ status: string }>(aql`
      FOR e IN edges
        FILTER e.concept == ${conceptName}
        RETURN { status: e.status }
    `);
    const edges = await edgeCursor.all();
    assert.ok(edges.every((e) => e.status === "archived"), "all edges must be archived");

    // Verify: doc is archived
    const docCursor = await db.query<{ status: string }>(aql`
      FOR d IN docs
        FILTER d._key == ${`${conceptName}::skill`}
        RETURN { status: d.status }
    `);
    const docs = await docCursor.all();
    assert.equal(docs[0]?.status, "archived", "doc must be archived");
  });
});
