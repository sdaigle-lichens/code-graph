import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { coreVertices, isThinCore, nameInBody, thinCoreMessage } from "./core.js";
import { analyzeConceptGaps, fetchConceptCounts, formatGapDiagnostic } from "../query/gaps.js";

const v = (name: string) => ({ _key: `k_${name}`, name });
const edge = (from: string, to: string, type = "calls") => ({
  _from: `vertices/k_${from}`,
  _to: `vertices/k_${to}`,
  type,
});

describe("nameInBody", () => {
  it("matches whole identifiers only", () => {
    assert.equal(nameInBody("runQuery", "Call `runQuery()` first"), true);
    assert.equal(nameInBody("run", "runQuery and rerun"), false);
    assert.equal(nameInBody("user", "the user_id field"), false);
    assert.equal(nameInBody("Foo", "Foo.bar"), true);
  });
  it("skips names shorter than 3 characters", () => {
    assert.equal(nameInBody("id", "the id of it"), false);
    assert.equal(nameInBody("get", "get it"), true);
  });
  it("treats regex metacharacters in names literally", () => {
    assert.equal(nameInBody("$store", "use $store here"), true);
    assert.equal(nameInBody("a.b", "axb"), false);
  });
});

describe("coreVertices", () => {
  it("includes vertices named in the SKILL body", () => {
    const c = coreVertices([v("alpha"), v("beta"), v("id")], [], "alpha and id");
    assert.deepEqual([...c.keys], ["k_alpha"]);
    assert.deepEqual([...c.named], ["k_alpha"]);
  });
  it("includes hubs with 3+ inbound calls/mounts from the concept", () => {
    const vs = [v("hub"), v("a"), v("b"), v("c"), v("two")];
    const es = [edge("a", "hub"), edge("b", "hub", "mounts"), edge("c", "hub"), edge("a", "two"), edge("b", "two")];
    const c = coreVertices(vs, es, null);
    assert.deepEqual([...c.hubs], ["k_hub"]);
    assert.deepEqual([...c.keys], ["k_hub"]);
  });
  it("ignores other edge types, self loops and sources outside the concept", () => {
    const vs = [v("hub"), v("a"), v("b")];
    const es = [
      edge("a", "hub", "imports"),
      edge("hub", "hub"),
      edge("b", "hub"),
      edge("zzz", "hub"),
      edge("a", "hub"),
    ];
    assert.equal(coreVertices(vs, es, null).keys.size, 0);
  });
  it("unions named and hubs", () => {
    const vs = [v("hub"), v("a"), v("b"), v("c"), v("named")];
    const es = [edge("a", "hub"), edge("b", "hub"), edge("c", "hub")];
    assert.deepEqual([...coreVertices(vs, es, "see named").keys].sort(), ["k_hub", "k_named"]);
  });
});

describe("thin core", () => {
  it("needs 50+ live and fewer than 5 core", () => {
    assert.equal(isThinCore(50, 4), true);
    assert.equal(isThinCore(49, 0), false);
    assert.equal(isThinCore(50, 5), false);
    assert.match(thinCoreMessage(2, 148), /2 of 148 vertices are core \(named in SKILL\.md or hubs\)/);
  });
  it("is reported by analyzeConceptGaps", () => {
    const counts = new Map([["big", { live: 60, enriched: 0, core: 3, coreEnriched: 0 }]]);
    const r = analyzeConceptGaps([{ name: "big", enrichable: true }], counts);
    assert.equal(r.concepts[0].thinCore, true);
    assert.deepEqual(
      r.thinCores.map((c) => c.concept),
      ["big"]
    );
  });
  it("is not thin below 50 live vertices, and shows in the gap diagnostic when thin", () => {
    const small = analyzeConceptGaps(
      [{ name: "s", enrichable: true }],
      new Map([["s", { live: 49, enriched: 0, core: 0, coreEnriched: 0 }]])
    );
    assert.equal(small.thinCores.length, 0);
    const big = analyzeConceptGaps(
      [{ name: "big", enrichable: true }],
      new Map([["big", { live: 148, enriched: 2, core: 2, coreEnriched: 2 }]])
    );
    assert.match(formatGapDiagnostic(big, []), /thin core[\s\S]*`big`[\s\S]*2 of 148 vertices are core/);
  });
});

describe("gaps measure the ratio over the core", () => {
  it("a core-only-enriched concept reads as enriched", () => {
    const counts = new Map([["c", { live: 20, enriched: 4, core: 4, coreEnriched: 4 }]]);
    const r = analyzeConceptGaps([{ name: "c", enrichable: true }], counts);
    assert.equal(r.concepts[0].status, "enriched");
    assert.equal(r.concepts[0].ratio, 1);
    assert.equal(r.fixable.length, 0);
  });
  it("falls back to all live vertices when the core is empty", () => {
    const counts = new Map([["c", { live: 20, enriched: 4, core: 0, coreEnriched: 0 }]]);
    const r = analyzeConceptGaps([{ name: "c", enrichable: true }], counts);
    assert.equal(r.concepts[0].status, "partial");
    assert.equal(r.concepts[0].ratio, 0.2);
  });
  it("fetchConceptCounts derives the core from the docs row and in-concept edges", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE vertices (key TEXT PRIMARY KEY, doc TEXT NOT NULL,
      concept TEXT GENERATED ALWAYS AS (json_extract(doc, '$.concept')) VIRTUAL,
      status TEXT GENERATED ALWAYS AS (json_extract(doc, '$.status')) VIRTUAL,
      name TEXT GENERATED ALWAYS AS (json_extract(doc, '$.name')) VIRTUAL,
      purpose TEXT GENERATED ALWAYS AS (json_extract(doc, '$.purpose')) VIRTUAL);
      CREATE TABLE edges (key TEXT PRIMARY KEY, doc TEXT NOT NULL,
      from_id TEXT GENERATED ALWAYS AS (json_extract(doc, '$._from')) VIRTUAL,
      to_id TEXT GENERATED ALWAYS AS (json_extract(doc, '$._to')) VIRTUAL,
      type TEXT GENERATED ALWAYS AS (json_extract(doc, '$.type')) VIRTUAL,
      concept TEXT GENERATED ALWAYS AS (json_extract(doc, '$.concept')) VIRTUAL);
      CREATE TABLE docs (key TEXT PRIMARY KEY, doc TEXT NOT NULL,
      concept TEXT GENERATED ALWAYS AS (json_extract(doc, '$.concept')) VIRTUAL);`);
    const iv = db.prepare("INSERT INTO vertices(key, doc) VALUES (?, ?)");
    const mk = (name: string, purpose?: string) =>
      JSON.stringify({ concept: "c", status: "live", name, ...(purpose ? { purpose } : {}), agent: { stale: false } });
    iv.run("k_named", mk("namedFn", "does it"));
    iv.run("k_other", mk("otherFn"));
    iv.run("k_hub", mk("hubFn"));
    for (const s of ["a", "b", "c"]) iv.run(`k_${s}`, mk(`src_${s}`));
    const ie = db.prepare("INSERT INTO edges(key, doc) VALUES (?, ?)");
    ["a", "b", "c"].forEach((s, i) =>
      ie.run(`e${i}`, JSON.stringify({ concept: "c", type: "calls", _from: `vertices/k_${s}`, _to: "vertices/k_hub" }))
    );
    db.prepare("INSERT INTO docs(key, doc) VALUES (?, ?)").run(
      "c::skill",
      JSON.stringify({ concept: "c", body_md: "Entry point: namedFn." })
    );
    const counts = await fetchConceptCounts(db, { core: true });
    assert.deepEqual(counts.get("c"), { live: 6, enriched: 1, core: 2, coreEnriched: 1 });
    const r = analyzeConceptGaps([{ name: "c", enrichable: true }], counts);
    assert.equal(r.concepts[0].ratio, 0.5);
    assert.equal(r.concepts[0].status, "partial");
  });
});
