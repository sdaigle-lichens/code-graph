// `search --json --max-tokens N` on a 16-concept store: the compact `gaps` block counts against the
// budget, lists each concept once, and is trimmed before any hit is.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applySchema, rebuildSearchIndex } from "../scribe/bootstrap.js";
import { putRecord } from "../scribe/rows.js";
import { analyzeConceptGaps, compactGaps, isCompactGaps, type CompactGaps, type ConceptCounts } from "./gaps.js";
import { searchStore, budgetSearchJson } from "./search.js";

const N = 400;
const names = Array.from({ length: 16 }, (_, i) => `feature-area-${String(i).padStart(2, "0")}`);

function sixteenConceptStore(): DatabaseSync {
  const store = new DatabaseSync(":memory:");
  applySchema(store);
  names.forEach((concept, i) => {
    for (let j = 0; j < 4; j++) {
      const key = `${i}-${j}`;
      putRecord(store, "vertices", key, {
        _key: key,
        concept,
        status: "live",
        type: "function",
        name: `handleRequest${i}x${j}`,
        filepath: `src/${concept}/h${j}.ts`,
        start_line: 1,
        end_line: 5,
      });
    }
  });
  rebuildSearchIndex(store);
  return store;
}

const gapsFor = (): CompactGaps => {
  const counts: ConceptCounts = new Map();
  // First 4 concepts partly enriched, the rest not at all; the last 2 have no skill.
  names.forEach((c, i) => counts.set(c, { live: 4, enriched: i < 4 ? 3 : 0 }));
  return compactGaps(
    analyzeConceptGaps(
      names.map((name, i) => ({ name, enrichable: i < 14 })),
      counts
    )
  );
};

describe("compactGaps", () => {
  it("lists each concept once, one line each", () => {
    const g = gapsFor();
    assert.equal(isCompactGaps(g), true);
    assert.equal(g.concepts.length, 16);
    const ids = g.concepts.map((l) => l.slice(0, l.indexOf(":")));
    assert.equal(new Set(ids).size, 16);
    assert.equal(g.concepts[0], "feature-area-00: partial 3/4");
    assert.equal(g.concepts[15], "feature-area-15: un-enriched 0/4 no-skill");
  });

  it("omits enriched concepts from the lines but counts them", () => {
    const counts: ConceptCounts = new Map([["a", { live: 2, enriched: 2 }]]);
    const g = compactGaps(
      analyzeConceptGaps(
        [
          { name: "a", enrichable: true },
          { name: "b", enrichable: true },
        ],
        counts
      )
    );
    assert.deepEqual(g, { enriched: 1, enrichable: 2, concepts: ["b: un-applied 0/0"] });
  });

  it("isCompactGaps rejects the full report shape", () => {
    assert.equal(isCompactGaps({ fixable: [], unenrichable: [] }), false);
    assert.equal(isCompactGaps(null), false);
  });
});

describe("budgetSearchJson with compact gaps (16 concepts)", () => {
  it("keeps the whole payload within ~4N bytes with gaps included, and says what it cut", async () => {
    const r = await searchStore(sixteenConceptStore(), "handle", { maxTokens: 4000, json: true });
    assert.ok(r.hits.length > 3, "fixture must produce several hits");
    const extra = { strength: "strong", low_confidence: false, gaps: gapsFor() };
    const fullBytes = JSON.stringify(budgetSearchJson(r, extra, 1e9), null, 2).length;
    assert.ok(fullBytes > 4 * N, `fixture (${fullBytes} bytes) must exceed the budget`);
    const text = JSON.stringify(budgetSearchJson(r, extra, N), null, 2);
    assert.ok(text.length <= 4 * N, `got ${text.length} bytes for N=${N}`);
    const parsed = JSON.parse(text);
    assert.equal(parsed.truncated, true);
    const lines: string[] = parsed.gaps.concepts;
    assert.equal(new Set(lines).size, lines.length, "no line twice");
    assert.equal(lines.length + parsed.dropped.gaps, 16);
    assert.equal(parsed.gaps.enriched, 0);
    assert.equal(parsed.gaps.enrichable, 14);
  });

  it("keeps every gap line when the budget is generous", async () => {
    const r = await searchStore(sixteenConceptStore(), "handleRequest0x0", { maxTokens: 4000, json: true });
    const out = budgetSearchJson(r, { gaps: gapsFor() }, 1e6) as { gaps: CompactGaps; truncated?: boolean };
    assert.equal(out.gaps.concepts.length, 16);
    assert.equal(out.truncated, undefined);
  });

  it("trims gap lines to the concepts the results are about before dropping any hit", async () => {
    const r = await searchStore(sixteenConceptStore(), "handleRequest0x0", { maxTokens: 4000, json: true });
    const extra = { gaps: gapsFor() };
    const size = (e: Record<string, unknown>) => JSON.stringify(budgetSearchJson(r, e, 1e9), null, 2).length;
    const all = size(extra);
    const none = size({ gaps: { enriched: 0, enrichable: 14, concepts: [] } });
    // Fits the result plus a few gap lines, not all 16.
    const budget = Math.ceil((none + (all - none) / 3) / 4);
    const out = budgetSearchJson(r, extra, budget) as {
      gaps: CompactGaps;
      hits: unknown[];
      dropped: { hits: number; gaps: number };
    };
    assert.ok(out.gaps.concepts.length >= 1 && out.gaps.concepts.length < 16);
    assert.equal(out.dropped.hits, 0);
    assert.equal(out.hits.length, r.hits.length);
    assert.equal(out.gaps.concepts.length + out.dropped.gaps, 16);
    assert.ok(out.gaps.concepts.every((l) => r.clusters.some((c) => l.startsWith(`${c.concept}:`))));
  });

  it("passes a non-compact gaps block through untouched", async () => {
    const r = await searchStore(sixteenConceptStore(), "handle", { maxTokens: 4000, json: true });
    const out = budgetSearchJson(r, { gaps: { fixable: [], unenrichable: [] } }, 300) as {
      gaps: unknown;
      dropped: { gaps: number };
    };
    assert.deepEqual(out.gaps, { fixable: [], unenrichable: [] });
    assert.equal(out.dropped.gaps, 0);
  });
});
