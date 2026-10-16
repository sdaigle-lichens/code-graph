import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applySchema, rebuildSearchIndex } from "../scribe/bootstrap.js";
import { putRecord } from "../scribe/rows.js";
import { searchStore, applyTokenBudget } from "./search.js";

function vertex(key: string, name: string, concept = "tasks") {
  return {
    _key: key,
    concept,
    status: "live",
    type: "function",
    name,
    filepath: `src/${name}.ts`,
    start_line: 1,
    end_line: 5,
  };
}

function edge(key: string, from: string, to: string, type = "calls") {
  return {
    _key: key,
    _from: `vertices/${from}`,
    _to: `vertices/${to}`,
    type,
    concept: "tasks",
    crosses_concept: false,
  };
}

/** A concept whose only searchable text is its skill doc ("cascade"), no vertex names or purpose match. */
function docOnlyStore(vertexCount: number): DatabaseSync {
  const store = new DatabaseSync(":memory:");
  applySchema(store);
  putRecord(store, "docs", "tasks::skill", {
    _key: "tasks::skill",
    concept: "tasks",
    path: ".claude/skills/tasks/SKILL.md",
    body_md: "Blocked by cascade rules for the queue.",
  });
  for (let i = 0; i < vertexCount; i++) putRecord(store, "vertices", `v${i}`, vertex(`v${i}`, `fn${i}`));
  // v0 is called by v1 and v2 and calls v3: a hub.
  putRecord(store, "edges", "e1", edge("e1", "v1", "v0"));
  putRecord(store, "edges", "e2", edge("e2", "v2", "v0"));
  putRecord(store, "edges", "e3", edge("e3", "v0", "v3"));
  rebuildSearchIndex(store);
  return store;
}

describe("searchStore — doc-only match", () => {
  it("gives doc-loaded vertices their one-hop edges and a real degree", async () => {
    const r = await searchStore(docOnlyStore(5), "cascade", { maxTokens: 4000, json: true });
    const hub = r.hits.find((h) => h.vertex?._key === "v0");
    assert.ok(hub, "hub vertex loaded through the skill doc");
    assert.ok(hub.degree > 0);
    assert.equal(hub.edges_out.length, 1);
    assert.ok(hub.edges_in.length > 0);
    assert.equal(r.hits[0].vertex?._key, "v0", "highest-degree vertex ranks first");
    assert.equal(r.docOnly, true);
  });

  it("keeps the concept in plain text under a tight budget and shows the hint", async () => {
    const r = await searchStore(docOnlyStore(5), "cascade", { maxTokens: 4000, json: false });
    const full = applyTokenBudget(r, 4000);
    assert.match(full, /Concept: tasks/);
    assert.match(full, /scribe/);
    // Under the ~93-token full render, so the leaf-dropping step runs (old behaviour emptied the cluster).
    const tight = applyTokenBudget(r, 100);
    assert.match(tight, /Concept: tasks/);
    assert.match(tight, /fn0/);
    assert.match(tight, /\b1 concepts matched/);
    assert.doesNotMatch(tight, /\b0 concepts matched/);
  });

  it("does not flag or hint a vertex-seeded search, and pulls only its own neighbours", async () => {
    const r = await searchStore(docOnlyStore(300), "fn0", { maxTokens: 4000, json: true });
    assert.notEqual(r.docOnly, true);
    assert.doesNotMatch(applyTokenBudget(r, 4000), /matched only through skill docs/);
    assert.ok(r.hits.length < 20, `got ${r.hits.length} hits`);
  });

  it("caps doc-loaded vertices on a large concept", async () => {
    const r = await searchStore(docOnlyStore(300), "cascade", { maxTokens: 4000, json: true });
    assert.ok(r.hits.length <= 20, `got ${r.hits.length} hits`);
    assert.ok(
      r.hits.some((h) => h.vertex?._key === "v0"),
      "the hub survives the cap"
    );
  });
});

function repeatedCallStore(): DatabaseSync {
  const store = new DatabaseSync(":memory:");
  applySchema(store);
  putRecord(store, "vertices", "target", vertex("target", "isValidSessionId"));
  putRecord(store, "vertices", "caller", { ...vertex("caller", "sweepStaleSessions"), start_line: 108 });
  putRecord(store, "vertices", "other", { ...vertex("other", "sideEffect", "sessions"), start_line: 3 });
  // caller calls target three times, once per call site
  for (const line of [112, 140, 155]) {
    putRecord(store, "edges", `c${line}`, { ...edge(`c${line}`, "caller", "target"), line, reason: "sweeps" });
  }
  // target reads the caller twice (no line) and crosses into another concept twice
  putRecord(store, "edges", "o1", edge("o1", "target", "caller", "reads"));
  putRecord(store, "edges", "o2", edge("o2", "target", "caller", "reads"));
  for (const line of [10, 20]) {
    putRecord(store, "edges", `x${line}`, {
      ...edge(`x${line}`, "target", "other"),
      line,
      crosses_concept: true,
    });
  }
  rebuildSearchIndex(store);
  return store;
}

describe("formatSearch — repeated call sites", () => {
  it("prints a caller that calls a vertex several times once, with its call-site lines", async () => {
    const r = await searchStore(repeatedCallStore(), "isValidSessionId", { maxTokens: 4000, json: false });
    const md = applyTokenBudget(r, 4000);
    const triggered = md.split("\n").filter((l) => l.includes("triggered by `sweepStaleSessions`"));
    assert.equal(triggered.length, 1);
    assert.match(triggered[0], /src\/sweepStaleSessions\.ts:108 \(lines 112, 140, 155\)/);
    assert.equal(md.match(/why: "sweeps"/g)?.length, 1);
  });

  it("deduplicates outgoing and cross-concept lines", async () => {
    const r = await searchStore(repeatedCallStore(), "isValidSessionId", { maxTokens: 4000, json: false });
    const md = applyTokenBudget(r, 4000);
    assert.equal(md.split("\n").filter((l) => l.includes("→ reads `sweepStaleSessions`")).length, 1);
    assert.match(md, /→ reads `sweepStaleSessions` \(tasks\) ×2/);
    const cross = md.split("\n").filter((l) => l.includes("**sessions**"));
    assert.equal(cross.length, 1);
    assert.match(cross[0], /\(lines 10, 20\)/);
  });

  it("keeps one entry per stored edge in the JSON result", async () => {
    const r = await searchStore(repeatedCallStore(), "isValidSessionId", { maxTokens: 4000, json: true });
    const hit = r.hits.find((h) => h.vertex?._key === "target")!;
    assert.equal(hit.edges_in.length, 3);
  });

  it("reports in the totals line the size of what is printed, within the budget", async () => {
    const r = await searchStore(docOnlyStore(60), "cascade", { maxTokens: 4000, json: false });
    for (const budget of [4000, 100]) {
      const md = applyTokenBudget(r, budget);
      const figure = Number(/~(\d+) tokens/.exec(md)![1]);
      assert.ok(Math.abs(figure - Math.ceil(md.length / 4)) <= 1, `figure ${figure} vs ${Math.ceil(md.length / 4)}`);
    }
  });
});
