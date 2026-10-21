import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applySchema, rebuildSearchIndex } from "../scribe/bootstrap.js";
import { putRecord } from "../scribe/rows.js";
import {
  searchStore,
  applyTokenBudget,
  assessConfidence,
  lowConfidenceLine,
  LOW_CONFIDENCE_MIN_SCORE,
  LOW_CONFIDENCE_MIN_ENRICHED,
} from "./search.js";

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

describe("assessConfidence", () => {
  const top = (over: Record<string, unknown> = {}) => ({
    concept: "tasks",
    skillPath: ".claude/skills/tasks/SKILL.md" as string | null,
    bestScore: 10,
    exact: false,
    ...over,
  });
  const gap = (over: Record<string, unknown> = {}) =>
    ({ status: "enriched", ratio: 1, coreVertices: 0, liveVertices: 10, ...over }) as any;

  it("is not low with no top cluster", () => {
    assert.deepEqual(assessConfidence(null, null), { low: false });
  });

  it("is low just under LOW_CONFIDENCE_MIN_SCORE and not low at it", () => {
    const under = assessConfidence(top({ bestScore: LOW_CONFIDENCE_MIN_SCORE - 0.01 }), gap());
    assert.equal(under.low, true);
    assert.match(under.reason!, /weak match/);
    assert.match(under.reason!, /concept tasks/);
    assert.equal(under.fallbackSkill, ".claude/skills/tasks/SKILL.md");
    assert.deepEqual(assessConfidence(top({ bestScore: LOW_CONFIDENCE_MIN_SCORE }), gap()), { low: false });
    assert.deepEqual(assessConfidence(top({ bestScore: LOW_CONFIDENCE_MIN_SCORE + 5 }), gap()), { low: false });
  });

  it("is low just under LOW_CONFIDENCE_MIN_ENRICHED and not low at it", () => {
    const under = assessConfidence(top(), gap({ status: "partial", ratio: LOW_CONFIDENCE_MIN_ENRICHED - 0.01 }));
    assert.equal(under.low, true);
    assert.match(under.reason!, /mostly un-enriched/);
    assert.deepEqual(assessConfidence(top(), gap({ status: "partial", ratio: LOW_CONFIDENCE_MIN_ENRICHED })), {
      low: false,
    });
  });

  it("is low for an un-enriched top concept even with a strong score", () => {
    const r = assessConfidence(top({ bestScore: 50 }), gap({ status: "un-enriched", ratio: 0 }));
    assert.equal(r.low, true);
    assert.match(r.reason!, /un-enriched/);
    assert.doesNotMatch(r.reason!, /mostly/);
  });

  it("names core vertices in the reason when the ratio is measured over a core", () => {
    const r = assessConfidence(top(), gap({ status: "partial", ratio: 0.2, coreVertices: 5 }));
    assert.match(r.reason!, /20% of core vertices/);
  });

  it("exempts an exact name hit, even un-enriched or weak", () => {
    assert.deepEqual(assessConfidence(top({ exact: true, bestScore: 0.1 }), gap({ status: "un-enriched", ratio: 0 })), {
      low: false,
    });
  });

  it("exempts a docs-only (un-applied) concept", () => {
    assert.deepEqual(
      assessConfidence(top({ bestScore: 0 }), gap({ status: "un-applied", ratio: 0, liveVertices: 0 })),
      { low: false }
    );
  });

  it("omits fallbackSkill when the cluster has no skill, and the line then names SKILL.md generically", () => {
    const r = assessConfidence(top({ skillPath: null, bestScore: 0 }), gap());
    assert.equal(r.fallbackSkill, undefined);
    const line = lowConfidenceLine(r);
    assert.match(line, /^> Low confidence: /);
    assert.match(line, /grep/);
    assert.match(line, /read the concept's SKILL\.md\.$/);
  });

  it("puts the skill path in the fallback line", () => {
    const line = lowConfidenceLine(assessConfidence(top({ bestScore: 0 }), gap()));
    assert.match(line, /grep, or read the concept's SKILL\.md \(\.claude\/skills\/tasks\/SKILL\.md\)\.$/);
  });
});

describe("searchStore — confidence", () => {
  const FULL = "parseGapsHandledAcknowledgement";
  const STRONG = "parse gaps handled acknowledgement";

  /** `enrichedFillers` of 9 filler vertices carry a purpose; the matching vertex has one iff `matchEnriched`. */
  function confStore(enrichedFillers: number, matchEnriched: boolean): DatabaseSync {
    const store = new DatabaseSync(":memory:");
    applySchema(store);
    putRecord(store, "docs", "tasks::skill", {
      _key: "tasks::skill",
      concept: "tasks",
      path: ".claude/skills/tasks/SKILL.md",
      body_md: "Queue handling notes.",
    });
    putRecord(store, "vertices", "m", {
      ...vertex("m", FULL),
      ...(matchEnriched ? { purpose: "Parses the gaps handled acknowledgement" } : {}),
    });
    for (let i = 0; i < 9; i++) {
      putRecord(store, "vertices", `f${i}`, {
        ...vertex(`f${i}`, `filler${i}`),
        ...(i < enrichedFillers ? { purpose: "unrelated" } : {}),
      });
    }
    rebuildSearchIndex(store);
    return store;
  }
  const run = (store: DatabaseSync, q: string, json = false) => searchStore(store, q, { maxTokens: 4000, json });
  const best = (r: Awaited<ReturnType<typeof run>>) => Math.max(...r.clusters[0].hits.map((h) => h.bm25));

  it("is not low for a strong match in a fully enriched concept", async () => {
    const r = await run(confStore(9, true), STRONG);
    assert.ok(best(r) >= LOW_CONFIDENCE_MIN_SCORE, `fixture score ${best(r)}`);
    assert.deepEqual(r.confidence, { low: false });
    assert.doesNotMatch(applyTokenBudget(r, 4000), /Low confidence/);
  });

  it("is low for a weak match in a fully enriched concept, and prints the fallback line", async () => {
    const r = await run(confStore(9, true), "gaps");
    assert.ok(best(r) < LOW_CONFIDENCE_MIN_SCORE, `fixture score ${best(r)}`);
    assert.equal(r.confidence?.low, true);
    assert.match(r.confidence!.reason!, /weak match/);
    assert.equal(r.confidence!.fallbackSkill, ".claude/skills/tasks/SKILL.md");
    const md = applyTokenBudget(r, 4000);
    assert.match(md.split("\n")[2], /^> Low confidence: weak match/, "line sits right under the totals");
    assert.match(md, /grep, or read the concept's SKILL\.md \(\.claude\/skills\/tasks\/SKILL\.md\)/);
    assert.match(md, /parseGapsHandledAcknowledgement/, "results are still printed");
  });

  it("is low for a strong match whose top concept is entirely un-enriched", async () => {
    const r = await run(confStore(0, false), STRONG);
    assert.ok(best(r) >= LOW_CONFIDENCE_MIN_SCORE, `fixture score ${best(r)}`);
    assert.equal(r.confidence?.low, true);
    assert.match(r.confidence!.reason!, /^concept tasks is un-enriched/);
  });

  it("is low when under LOW_CONFIDENCE_MIN_ENRICHED of the concept is enriched, and not at it", async () => {
    // 10 live vertices (match + 9 fillers): 4 enriched is 0.4, 5 enriched is exactly 0.5.
    const under = await run(confStore(4, false), STRONG);
    assert.ok(best(under) >= LOW_CONFIDENCE_MIN_SCORE, `fixture score ${best(under)}`);
    assert.equal(under.confidence?.low, true);
    assert.match(under.confidence!.reason!, /mostly un-enriched \(40% of vertices have a purpose\)/);
    const at = await run(confStore(5, false), STRONG);
    assert.ok(best(at) >= LOW_CONFIDENCE_MIN_SCORE, `fixture score ${best(at)}`);
    assert.deepEqual(at.confidence, { low: false });
  });

  it("trusts an exact name query in an un-enriched concept", async () => {
    const r = await run(confStore(0, false), FULL);
    assert.deepEqual(r.confidence, { low: false });
    assert.doesNotMatch(applyTokenBudget(r, 4000), /Low confidence/);
  });

  it("matches the exact name case-insensitively", async () => {
    const r = await run(confStore(0, false), FULL.toLowerCase());
    assert.deepEqual(r.confidence, { low: false });
  });

  it("trusts a docs-only concept: its SKILL.md is the answer", async () => {
    const store = new DatabaseSync(":memory:");
    applySchema(store);
    putRecord(store, "docs", "notes::skill", {
      _key: "notes::skill",
      concept: "notes",
      path: ".claude/skills/notes/SKILL.md",
      body_md: "Describes the zebra migration policy.",
    });
    rebuildSearchIndex(store);
    const r = await run(store, "zebra");
    assert.equal(r.clusters[0].concept, "notes");
    assert.deepEqual(r.confidence, { low: false });
  });

  it("carries the flag in the JSON-serialised result", async () => {
    const r = await run(confStore(0, false), STRONG, true);
    const parsed = JSON.parse(JSON.stringify(r));
    assert.equal(parsed.confidence.low, true);
    assert.match(parsed.confidence.reason, /un-enriched/);
  });
});
