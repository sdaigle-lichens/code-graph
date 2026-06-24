import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeConceptGaps,
  classifyStrength,
  buildSuccessNote,
  formatGapDiagnostic,
  type ConceptCounts,
  type DeclaredConcept,
} from "./gaps.js";
import type { SearchResult } from "./search.js";

const counts = (entries: Record<string, [number, number]>): ConceptCounts => {
  const m: ConceptCounts = new Map();
  for (const [k, [live, enriched]] of Object.entries(entries)) m.set(k, { live, enriched });
  return m;
};

const enrichable = (...names: string[]): DeclaredConcept[] =>
  names.map((name) => ({ name, enrichable: true }));

describe("analyzeConceptGaps — status bands", () => {
  it("classifies un-applied (zero live vertices)", () => {
    const r = analyzeConceptGaps(enrichable("a"), counts({}));
    assert.equal(r.concepts[0].status, "un-applied");
    assert.equal(r.concepts[0].ratio, 0);
    assert.equal(r.fixable.length, 1);
  });

  it("classifies un-enriched (vertices, zero purpose)", () => {
    const r = analyzeConceptGaps(enrichable("a"), counts({ a: [5, 0] }));
    assert.equal(r.concepts[0].status, "un-enriched");
    assert.equal(r.fixable.length, 1);
  });

  it("classifies partial (some purpose, below threshold)", () => {
    const r = analyzeConceptGaps(enrichable("a"), counts({ a: [10, 5] }));
    assert.equal(r.concepts[0].status, "partial");
    assert.equal(r.concepts[0].ratio, 0.5);
    assert.equal(r.fixable.length, 1);
  });

  it("classifies enriched (at/above threshold)", () => {
    const full = analyzeConceptGaps(enrichable("a"), counts({ a: [10, 10] }));
    assert.equal(full.concepts[0].status, "enriched");
    const atThreshold = analyzeConceptGaps(enrichable("a"), counts({ a: [10, 9] }));
    assert.equal(atThreshold.concepts[0].status, "enriched", "0.9 ratio == default threshold");
    assert.equal(full.fixable.length, 0);
  });
});

describe("analyzeConceptGaps — enrichability", () => {
  it("routes un-enrichable gaps away from fixable and out of the ratio", () => {
    const declared: DeclaredConcept[] = [
      { name: "built", enrichable: true },
      { name: "noskill", enrichable: false },
    ];
    const r = analyzeConceptGaps(declared, counts({ built: [4, 4], noskill: [3, 0] }));
    assert.equal(r.fixable.length, 0, "un-enrichable concept is not fixable");
    assert.equal(r.unenrichable.length, 1);
    assert.equal(r.unenrichable[0].concept, "noskill");
    // ratio counts only enrichable concepts: 1 enriched / 1 enrichable
    assert.equal(r.enrichedCount, 1);
    assert.equal(r.enrichableTotal, 1);
  });
});

describe("buildSuccessNote", () => {
  it("returns null when everything enrichable is enriched", () => {
    const r = analyzeConceptGaps(enrichable("a"), counts({ a: [10, 10] }));
    assert.equal(buildSuccessNote(r), null);
  });

  it("returns null when there are no enrichable concepts", () => {
    const r = analyzeConceptGaps([{ name: "x", enrichable: false }], counts({ x: [2, 0] }));
    assert.equal(buildSuccessNote(r), null);
  });

  it("reports the enriched/enrichable ratio when there is a fixable gap", () => {
    const declared = enrichable("a", "b", "c");
    const r = analyzeConceptGaps(declared, counts({ a: [4, 4], b: [4, 4], c: [4, 0] }));
    assert.match(buildSuccessNote(r)!, /graph 2\/3 concepts enriched/);
  });
});

describe("classifyStrength", () => {
  const resultWith = (vertexHits: number): SearchResult =>
    ({
      query: "q",
      hits: Array.from({ length: vertexHits }, () => ({ vertex: {} })),
      clusters: [],
      totals: { concepts: 0, vertices: 0, docs: 0, tokens: 0 },
    }) as unknown as SearchResult;

  it("marks sparse results thin", () => {
    assert.equal(classifyStrength(resultWith(2)), "thin");
    assert.equal(classifyStrength(resultWith(0)), "thin");
  });

  it("marks rich results strong (no self-doubt)", () => {
    assert.equal(classifyStrength(resultWith(3)), "strong");
    assert.equal(classifyStrength(resultWith(12)), "strong");
  });
});

describe("formatGapDiagnostic", () => {
  it("emits the build pipeline for fixable concepts", () => {
    const r = analyzeConceptGaps(enrichable("workorder-store"), counts({}));
    const md = formatGapDiagnostic(r, []);
    assert.match(md, /code-graph extract workorder-store/);
    assert.match(md, /scribe-enrich workorder-store/);
    assert.match(md, /code-graph apply workorder-store/);
  });

  it("flags un-enrichable concepts instead of offering the pipeline", () => {
    const r = analyzeConceptGaps([{ name: "noskill", enrichable: false }], counts({ noskill: [2, 0] }));
    const md = formatGapDiagnostic(r, []);
    assert.match(md, /no SKILL\.md/);
    assert.doesNotMatch(md, /scribe-enrich noskill/);
  });

  it("lists uncovered files and caps the list", () => {
    const r = analyzeConceptGaps([], counts({}));
    const files = Array.from({ length: 30 }, (_, i) => `src/f${i}.ts`);
    const md = formatGapDiagnostic(r, files, { uncoveredCap: 25 });
    assert.match(md, /covered by no concept/);
    assert.match(md, /and 5 more/);
  });
});
