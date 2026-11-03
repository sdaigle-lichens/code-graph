import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applySchema, rebuildSearchIndex } from "../scribe/bootstrap.js";
import { putRecord } from "../scribe/rows.js";
import { searchStore, SearchNoResultsError } from "./search.js";

// Ticket 061: on a store where only some concepts are enriched, enrichment must not push down the
// hits of an un-enriched concept. These pin eval tasks 2 and 6 against a fixture (the eval itself is
// informational on the real store, so a regression here must fail `pnpm test`).

function vertex(key: string, name: string, concept: string, extra: Record<string, unknown> = {}) {
  return {
    _key: key,
    concept,
    status: "live",
    type: "function",
    name,
    filepath: `src/${concept}/${name}.ts`,
    start_line: 1,
    end_line: 5,
    ...extra,
  };
}

function edge(key: string, from: string, to: string) {
  return {
    _key: key,
    _from: `vertices/${from}`,
    _to: `vertices/${to}`,
    type: "calls",
    concept: "search",
    crosses_concept: false,
  };
}

function newStore(): DatabaseSync {
  const store = new DatabaseSync(":memory:");
  applySchema(store);
  return store;
}

describe("searchStore on a partly enriched store", () => {
  it("eval task 6: a docs-only concept stays in the top clusters when enriched vertices outrank its doc", async () => {
    const store = newStore();
    // Enriched concepts: a dozen vertices whose purposes match the query words several times over.
    for (let i = 0; i < 6; i++) {
      putRecord(
        store,
        "vertices",
        `a${i}`,
        vertex(`a${i}`, `handler${i}`, "alpha", {
          purpose: "docs only concept skill resolution for concept skill docs",
          tags: ["docs", "concept", "skill"],
        })
      );
      putRecord(
        store,
        "vertices",
        `b${i}`,
        vertex(`b${i}`, `worker${i}`, "beta", {
          purpose: "resolves the concept skill and docs only concept resolution",
          tags: ["skill", "resolution"],
        })
      );
    }
    // Docs-only concept, never enriched, no vertices: only its skill doc can match.
    putRecord(store, "docs", "gamma::skill", {
      _key: "gamma::skill",
      concept: "gamma",
      path: ".claude/skills/gamma/SKILL.md",
      body_md: "How a docs-only concept resolves its skill: the resolution order starts at skillsDir. ".repeat(3),
    });
    rebuildSearchIndex(store);

    const r = await searchStore(store, "docs-only concept skill resolution", { maxTokens: 6000, json: false });
    const top3 = r.clusters.slice(0, 3).map((c) => c.concept);
    assert.ok(top3.includes("gamma"), `gamma missing from top 3 clusters: ${top3.join(", ")}`);
    assert.equal(r.docOnly, false, "vertex seeds exist, so the search is not doc-only");
    // The reserved doc seed adds a cluster, never vertex hits of its own.
    assert.ok(r.hits.every((h) => h.vertex?.concept !== "gamma"));
  });

  it("eval task 2: a name hit stays in the top 6 against enriched, better connected peers that match only through purpose and tags", async () => {
    const store = newStore();
    // The target matches only through its name word "expand"; its purpose shares no query word.
    putRecord(
      store,
      "vertices",
      "t0",
      vertex("t0", "expandDoc", "search", { purpose: "captures a skill document for a concept" })
    );
    // Other name hits, enriched.
    for (const [k, n] of [
      ["n0", "expandVertex"],
      ["n1", "queryImpact"],
      ["n2", "formatImpact"],
    ]) {
      putRecord(store, "vertices", k, vertex(k, n, "search", { purpose: "walks edges and reports neighbours" }));
    }
    // Enriched peers: names match nothing, purpose and tags carry two query words, and a ring of
    // calls gives them a higher degree than the target (called once, by p0).
    const peers = 8;
    for (let i = 0; i < peers; i++) {
      putRecord(
        store,
        "vertices",
        `p${i}`,
        vertex(`p${i}`, `walker${i}`, "search", { purpose: "graph traversal over edges", tags: ["graph", "traversal"] })
      );
      putRecord(store, "edges", `r${i}`, edge(`r${i}`, `p${i}`, `p${(i + 1) % peers}`));
      putRecord(store, "edges", `s${i}`, edge(`s${i}`, `p${i}`, `p${(i + 3) % peers}`));
    }
    putRecord(store, "edges", "x0", edge("x0", "p0", "t0"));
    // Filler keeps the query words rare enough for bm25 idf to matter, as in a real store.
    for (let i = 0; i < 40; i++) putRecord(store, "vertices", `f${i}`, vertex(`f${i}`, `filler${i}`, "other"));
    rebuildSearchIndex(store);

    const r = await searchStore(store, "expand graph traversal impact", { maxTokens: 6000, json: false });
    const names = r.hits.filter((h) => h.vertex).map((h) => h.vertex!.name);
    const rank = names.indexOf("expandDoc") + 1;
    assert.ok(rank >= 1 && rank <= 6, `expandDoc at ${rank || "absent"}, want top 6 (got ${names.join(", ")})`);
  });

  it("ticket 065: a function named exactly like a query word stays in the top 3 against enriched type-defs and a helper whose purposes repeat the query words", async () => {
    const store = newStore();
    // The target: a hub function whose whole name is the query word "apply"; its purpose shares nothing else.
    putRecord(
      store,
      "vertices",
      "t0",
      vertex("t0", "apply", "pipeline", { purpose: "writes a concept into the store" })
    );
    for (let i = 0; i < 10; i++) {
      putRecord(store, "vertices", `c${i}`, vertex(`c${i}`, `caller${i}`, "pipeline"));
      putRecord(store, "edges", `e${i}`, edge(`e${i}`, `c${i}`, "t0"));
    }
    // Enriched type-defs and a helper: names carry two query words, purposes repeat several.
    for (const [k, n, type] of [
      ["d0", "NeverAppliedDrift", "type-def"],
      ["d1", "DriftJson", "type-def"],
      ["d2", "isConceptApplied", "function"],
    ]) {
      putRecord(
        store,
        "vertices",
        k,
        vertex(k, n, "pipeline", {
          type,
          purpose:
            "scribe apply drift detection: reports drift when a concept was applied, detection of drift on apply",
          tags: ["drift", "apply", "detection", "scribe"],
        })
      );
    }
    for (let i = 0; i < 40; i++) putRecord(store, "vertices", `f${i}`, vertex(`f${i}`, `filler${i}`, "other"));
    rebuildSearchIndex(store);

    const r = await searchStore(store, "scribe apply drift detection", { maxTokens: 6000, json: false });
    const names = r.hits.filter((h) => h.vertex).map((h) => h.vertex!.name);
    const rank = names.indexOf("apply") + 1;
    assert.ok(rank >= 1 && rank <= 3, `apply at ${rank || "absent"}, want top 3 (got ${names.slice(0, 6).join(", ")})`);
    // The boost is blended-score only: the reported bm25 is the plain one.
    const apply = r.hits.find((h) => h.vertex?.name === "apply")!;
    const peer = r.hits.find((h) => h.vertex?.name === "NeverAppliedDrift")!;
    assert.ok(apply.bm25 < peer.bm25, "reported bm25 is unboosted");
  });

  it("ticket 065: a type-def whose whole name equals a query word gets no equality boost (a function with that name outranks it)", async () => {
    const store = newStore();
    // Same name, same purpose (no query word), no edges: only the type-def exclusion separates them.
    putRecord(store, "vertices", "td", vertex("td", "apply", "pipeline", { type: "type-def", purpose: "a shape" }));
    putRecord(store, "vertices", "fn", vertex("fn", "apply", "pipeline", { purpose: "a shape" }));
    for (let i = 0; i < 10; i++) putRecord(store, "vertices", `f${i}`, vertex(`f${i}`, `filler${i}`, "other"));
    rebuildSearchIndex(store);

    const r = await searchStore(store, "apply drift", { maxTokens: 6000, json: false });
    const td = r.hits.find((h) => h.vertex?._key === "td");
    const fn = r.hits.find((h) => h.vertex?._key === "fn");
    assert.ok(td && fn, "both same-named vertices are hits");
    assert.ok(
      fn.score > td.score,
      `function apply (score ${fn.score}) must outrank type-def apply (score ${td.score})`
    );
  });

  it("ticket 065: a stopword-only query throws SearchNoResultsError rather than boosting anything", async () => {
    const store = newStore();
    putRecord(store, "vertices", "t0", vertex("t0", "apply", "pipeline"));
    rebuildSearchIndex(store);
    await assert.rejects(searchStore(store, "the a of", { maxTokens: 6000, json: false }), SearchNoResultsError);
  });
});
