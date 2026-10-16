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
