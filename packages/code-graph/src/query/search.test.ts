import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applySchema, rebuildSearchIndex } from "../scribe/bootstrap.js";
import { putRecord } from "../scribe/rows.js";
import { searchStore, applyTokenBudget, budgetSearchJson, formatSearch } from "./search.js";

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

describe("budgetSearchJson", () => {
  const extra = { strength: "strong", gaps: { fixable: [], unenrichable: [] } };

  it("returns the result untouched, with no truncated flag, when it fits", async () => {
    const r = await searchStore(docOnlyStore(10), "cascade", { maxTokens: 4000, json: true });
    const out = budgetSearchJson(r, extra, 100000);
    assert.equal(out.truncated, undefined);
    assert.equal(out.strength, "strong");
    assert.equal((out.hits as unknown[]).length, r.hits.length);
  });

  it("trims an over-budget result to the budget, keeps shape, strength and gaps, and counts the drops", async () => {
    const r = await searchStore(docOnlyStore(60), "cascade", { maxTokens: 4000, json: true });
    const full = JSON.stringify(budgetSearchJson(r, extra, 1e9), null, 2).length / 4;
    const budget = 1500;
    assert.ok(full > budget, "fixture must exceed the budget");
    const out = budgetSearchJson(r, extra, budget);
    const text = JSON.stringify(out, null, 2);
    assert.ok(Math.ceil(text.length / 4) <= budget, `got ${Math.ceil(text.length / 4)} tokens`);
    const parsed = JSON.parse(text);
    assert.equal(parsed.truncated, true);
    assert.equal(parsed.strength, "strong");
    assert.deepEqual(parsed.gaps, extra.gaps);
    assert.equal(parsed.query, "cascade");
    assert.ok(Array.isArray(parsed.hits) && Array.isArray(parsed.clusters));
    assert.ok(parsed.dropped.hits > 0);
    assert.equal(parsed.hits.length + parsed.dropped.hits, r.hits.length);
    assert.ok(parsed.hits.length >= 1, "best hit survives");
  });

  it("keeps the best hit, compacted, when a single hit alone exceeds the budget", async () => {
    const store = new DatabaseSync(":memory:");
    applySchema(store);
    putRecord(store, "vertices", "hub", vertex("hub", "uniqueHubSymbol"));
    for (let i = 0; i < 300; i++) {
      putRecord(store, "vertices", `c${i}`, vertex(`c${i}`, `caller${i}`));
      putRecord(store, "edges", `e${i}`, { ...edge(`e${i}`, `c${i}`, "hub"), reason: "x".repeat(80) });
    }
    rebuildSearchIndex(store);
    const r = await searchStore(store, "uniqueHubSymbol", { maxTokens: 3000, json: true });
    const budget = 1000;
    const out = budgetSearchJson(r, extra, budget);
    const text = JSON.stringify(out, null, 2);
    assert.ok(Math.ceil(text.length / 4) <= budget, `got ${Math.ceil(text.length / 4)} tokens`);
    const parsed = JSON.parse(text);
    assert.equal(parsed.truncated, true);
    assert.equal(parsed.hits[0].vertex.name, "uniqueHubSymbol");
    assert.equal(parsed.clusters[0].hits[0].vertex.name, "uniqueHubSymbol");
    assert.ok(parsed.dropped.edges > 0);
    assert.equal(parsed.strength, "strong");
  });
});

describe("formatSearch — repeated call sites", () => {
  it("prints a caller that calls a vertex several times once, with its call-site lines", async () => {
    const r = await searchStore(repeatedCallStore(), "isValidSessionId", { maxTokens: 4000, json: false });
    const md = applyTokenBudget(r, 4000);
    const calledBy = md.split("\n").filter((l) => l.includes("← called by `sweepStaleSessions`"));
    assert.equal(calledBy.length, 1);
    assert.match(calledBy[0], /src\/sweepStaleSessions\.ts:108 \(lines 112, 140, 155\)/);
    assert.doesNotMatch(md, /triggered by/, "a calls edge is not labelled as a triggers edge");
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

describe("formatSearch — un-enriched hits", () => {
  function enrichmentStore(): DatabaseSync {
    const store = new DatabaseSync(":memory:");
    applySchema(store);
    putRecord(store, "vertices", "bare", vertex("bare", "setAgentDescription"));
    putRecord(store, "vertices", "rich", {
      ...vertex("rich", "getAgentDescription"),
      purpose: "Reads an agent's description",
    });
    rebuildSearchIndex(store);
    return store;
  }

  it("marks a hit with no purpose as not enriched in plain text, and only that hit", async () => {
    const r = await searchStore(enrichmentStore(), "setAgentDescription getAgentDescription", {
      maxTokens: 4000,
      json: false,
    });
    const lines = applyTokenBudget(r, 4000).split("\n");
    const bare = lines.find((l) => l.includes("`setAgentDescription`"))!;
    const rich = lines.find((l) => l.includes("`getAgentDescription`"))!;
    assert.match(bare, /`setAgentDescription` — _not enriched_$/);
    assert.match(rich, /`getAgentDescription` — Reads an agent's description$/);
    assert.doesNotMatch(rich, /not enriched/);
  });

  it("leaves --json unchanged: no marker, no added field", async () => {
    const r = await searchStore(enrichmentStore(), "setAgentDescription", { maxTokens: 4000, json: true });
    const hit = r.hits.find((h) => h.vertex?._key === "bare")!;
    assert.equal(hit.vertex!.purpose ?? null, null);
    assert.doesNotMatch(JSON.stringify(r), /not enriched/);
  });

  it("keeps the marker on kept hits under a tight budget, with the totals figure matching", async () => {
    const r = await searchStore(docOnlyStore(60), "cascade", { maxTokens: 4000, json: false });
    for (const budget of [4000, 150]) {
      const md = applyTokenBudget(r, budget);
      const hitLines = md.split("\n").filter((l) => /^- @src\/fn\d+\.ts/.test(l));
      assert.ok(hitLines.length > 0, `budget ${budget}: some hits kept`);
      for (const l of hitLines) assert.match(l, / — _not enriched_$/);
      const figure = Number(/~(\d+) tokens/.exec(md)![1]);
      assert.ok(Math.abs(figure - Math.ceil(md.length / 4)) <= 1, `figure ${figure} vs ${Math.ceil(md.length / 4)}`);
    }
  });

  it("treats an empty-string purpose as not enriched", async () => {
    const store = new DatabaseSync(":memory:");
    applySchema(store);
    putRecord(store, "vertices", "empty", { ...vertex("empty", "emptyPurposeFn"), purpose: "" });
    rebuildSearchIndex(store);
    const r = await searchStore(store, "emptyPurposeFn", { maxTokens: 4000, json: false });
    const line = applyTokenBudget(r, 4000)
      .split("\n")
      .find((l) => l.includes("`emptyPurposeFn`"))!;
    assert.match(line, /`emptyPurposeFn` — _not enriched_$/);
  });
});

describe("formatSearch — inbound edge labels", () => {
  /** inboundTarget is reached inbound by one edge of each impact type the search traverses. */
  function inboundStore(): DatabaseSync {
    const store = new DatabaseSync(":memory:");
    applySchema(store);
    putRecord(store, "vertices", "t", vertex("t", "inboundTarget"));
    const sources: Array<[string, string]> = [
      ["callerFn", "calls"],
      ["triggerFn", "triggers"],
      ["delegatorFn", "delegates-to"],
    ];
    for (const [name, type] of sources) {
      putRecord(store, "vertices", name, vertex(name, name));
      putRecord(store, "edges", `e-${name}`, edge(`e-${name}`, name, "t", type));
    }
    rebuildSearchIndex(store);
    return store;
  }

  it("labels each inbound edge by its type in plain text", async () => {
    const r = await searchStore(inboundStore(), "inboundTarget", { maxTokens: 4000, json: false });
    const md = applyTokenBudget(r, 4000);
    const inbound = md.split("\n").filter((l) => l.includes("  - ← "));
    assert.ok(
      inbound.some((l) => l.includes("← called by `callerFn`")),
      md
    );
    assert.ok(
      inbound.some((l) => l.includes("← triggered by `triggerFn`")),
      md
    );
    assert.ok(
      inbound.some((l) => l.includes("← delegated to by `delegatorFn`")),
      md
    );
    assert.equal(inbound.filter((l) => l.includes("triggered by")).length, 1, "only the triggers edge");
  });

  it("leaves --json unchanged: edges_in carry the raw stored edge type", async () => {
    const r = await searchStore(inboundStore(), "inboundTarget", { maxTokens: 4000, json: true });
    const hit = r.hits.find((h) => h.vertex?._key === "t")!;
    assert.deepEqual(hit.edges_in.map((x) => [x.from.name, x.edge.type]).sort(), [
      ["callerFn", "calls"],
      ["delegatorFn", "delegates-to"],
      ["triggerFn", "triggers"],
    ]);
    const text = JSON.stringify(r);
    assert.doesNotMatch(text, /called by|triggered by|delegated to by/);
  });

  it("labels the other edge types too when they reach a hit inbound", () => {
    const t = { ...vertex("t", "hitFn"), purpose: undefined } as any;
    const types: Array<[string, string]> = [
      ["mounts", "mounted by"],
      ["reads", "read by"],
      ["writes", "written by"],
      ["uses-hook", "used as a hook by"],
      ["subscribes", "subscribed to by"],
      ["has-type", "type of"],
    ];
    const hit = {
      vertex: t,
      edges_in: types.map(([type], i) => ({
        edge: edge(`x${i}`, `s${i}`, "t", type) as any,
        from: vertex(`s${i}`, `src${i}`) as any,
      })),
      edges_out: [],
      cross_edges: [],
      bm25: 1,
      degree: types.length,
      score: 1,
    };
    const md = formatSearch({
      query: "hitFn",
      hits: [hit],
      clusters: [{ concept: "tasks", skill: null, hits: [hit] }],
      totals: { concepts: 1, vertices: 1, docs: 0, tokens: 0 },
    });
    types.forEach(([, label], i) => assert.ok(md.includes(`← ${label} \`src${i}\``), `${label}\n${md}`));
    assert.doesNotMatch(md, /triggered by/);
  });
});
