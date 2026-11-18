// Renames during an unattended update: a clear rename (one candidate on each side) is applied and its
// enriched entry is re-keyed; an ambiguous one (two candidates for the old vertex) does not block its
// concept, is not applied, keeps its enriched entry byte-identical, is recorded once in
// scribe-output/ambiguous-renames.json, and is listed in every report until a person settles it. Runs the
// real built CLI against a real temp git repo and store; the claude process is the only thing not run.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { claimUpdateRun, runUpdate, UPDATE_REPORT_FILE } from "./update-run.js";
import {
  cg,
  assertDist,
  buildBehindProject,
  cleanEnv,
  enrich,
  enrichedEntryText,
  enrichedKeys,
  gitInitCommit,
  makeBase,
  mustCg,
  writeProjectFiles,
  writeRel,
  astKey,
  DIST,
  readRel,
} from "./update-fixture.js";

const BEFORE =
  "/** Sum of the line prices. */\nexport function computeTotal(prices: number[]): number {\n" +
  "  return prices.reduce((s, p) => s + p, 0);\n}\n\n" +
  "/** Wraps a value in brackets. */\nexport function formatLabel(value: string): string {\n  return `[${value}]`;\n}\n";

// computeTotal is renamed (one candidate); formatLabel is removed and two new functions look like it (two candidates).
const AFTER =
  "/** Sum of the line prices. */\nexport function computeTotalAmounts(prices: number[]): number {\n" +
  "  return prices.reduce((s, p) => s + p, 0);\n}\n\n" +
  "/** Wraps a value in brackets. */\nexport function formatLabels(value: string): string {\n  return `[${value}]`;\n}\n\n" +
  "/** Wraps a value in angle brackets. */\nexport function formatLabelx(value: string): string {\n  return `<${value}>`;\n}\n";

let base: string;
let root: string;
let oldTotalKey: string;
let oldLabelKey: string;
let labelEntryBefore: string | null;

beforeEach(() => {
  assertDist();
  base = makeBase();
  root = path.join(base, "repo");
  fs.mkdirSync(root, { recursive: true });
  writeProjectFiles(root);
  writeRel(root, "src/alpha/a.ts", BEFORE);
  gitInitCommit(root, "initial");
  mustCg(root, ["skills", "stamp", "alpha", "beta", "--bump", "initial"]);
  mustCg(root, ["skills", "stamp", "--bump", "initial"]);
  mustCg(root, ["extract", "alpha", "beta"]);
  mustCg(root, ["apply", "alpha", "beta"]);
  enrich(root, base, "alpha", {
    computeTotal: "Sums the line prices.",
    formatLabel: "Wraps a value in brackets.",
  });
  oldTotalKey = astKey(root, "alpha", "computeTotal");
  oldLabelKey = astKey(root, "alpha", "formatLabel");
  labelEntryBefore = enrichedEntryText(root, "alpha", oldLabelKey);
  writeRel(root, "src/alpha/a.ts", AFTER);
  mustCg(root, ["extract", "alpha"]);
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

/** The record file's `renames` list, or null when no record exists. */
function renamesFile(): { renames: unknown[] } | null {
  const p = path.join(root, "scribe-output", "ambiguous-renames.json");
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as { renames: unknown[] }) : null;
}

describe("dry run classifies the renames", () => {
  it("computeTotal has one candidate (clear); formatLabel has two (ambiguous)", () => {
    const r = cg(root, ["apply", "alpha", "--dry-run", "--json"]);
    assert.equal(r.code, 0, r.stderr || r.stdout);
    const doc = JSON.parse(r.stdout) as { renameCandidates?: Record<string, unknown>[] };
    const list = doc.renameCandidates ?? [];
    const forOld = (name: string) => list.filter((c) => JSON.stringify(c).includes(`"${name}"`));
    const total = forOld("computeTotal");
    const label = forOld("formatLabel");
    assert.equal(total.length, 1, `one candidate for computeTotal: ${r.stdout}`);
    assert.equal(total[0]?.ambiguous, false);
    // Greedy pairing lists one pair for formatLabel (to formatLabelx); formatLabels, a second look-alike, is
    // left as a new vertex. The pair is still flagged ambiguous because another new vertex matches it.
    assert.equal(label.length, 1, `formatLabel is paired once: ${r.stdout}`);
    assert.ok(
      label.every((c) => c.ambiguous === true),
      "the formatLabel pair is ambiguous"
    );
    assert.ok(JSON.stringify(doc).includes('"name":"formatLabels"'), "formatLabels is a second look-alike");
  });
});

describe("apply --approve-unambiguous-renames", () => {
  it("applies the concept (exit 0), applies the clear rename, and reports the ambiguous one as not applied", () => {
    const r = cg(root, ["apply", "alpha", "--approve-unambiguous-renames"]);
    assert.equal(r.code, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /Not applied: 1 ambiguous rename candidate\(s\)/);
    assert.match(r.stdout, /ambiguous: formatLabel → (formatLabels|formatLabelx)/);
  });

  it("re-keys the clear rename's enriched entry onto the new key, keeping its purpose, and leaves no orphan for it", () => {
    mustCg(root, ["apply", "alpha", "--approve-unambiguous-renames"]);
    const newTotalKey = astKey(root, "alpha", "computeTotalAmounts");
    const keys = enrichedKeys(root, "alpha");
    assert.ok(keys.includes(newTotalKey), "the enriched entry is on the new key");
    assert.ok(!keys.includes(oldTotalKey), "no enriched entry is left on the old computeTotal key");
    assert.match(enrichedEntryText(root, "alpha", newTotalKey) ?? "", /Sums the line prices\./);
  });

  it("keeps the ambiguous entry in the enriched file byte-identical (orphaned, not deleted, not remapped)", () => {
    mustCg(root, ["apply", "alpha", "--approve-unambiguous-renames"]);
    assert.ok(labelEntryBefore, "test setup: the formatLabel entry existed");
    assert.equal(enrichedEntryText(root, "alpha", oldLabelKey), labelEntryBefore, "unchanged");
    assert.ok(enrichedKeys(root, "alpha").includes(oldLabelKey));
  });

  it("records the ambiguous rename once in scribe-output/ambiguous-renames.json, and a re-apply does not duplicate it", () => {
    mustCg(root, ["apply", "alpha", "--approve-unambiguous-renames"]);
    const first = renamesFile();
    assert.ok(first, "the record file exists");
    assert.equal(first.renames.length, 1, `one record: ${JSON.stringify(first)}`);
    assert.ok(JSON.stringify(first.renames[0]).includes("formatLabel"), "the record names formatLabel");
    mustCg(root, ["apply", "alpha", "--approve-unambiguous-renames"]);
    const second = renamesFile();
    assert.equal(second?.renames.length, 1, "a re-apply does not add a second record");
  });

  it("does not block a concept whose only rename is ambiguous: beta is applied in the same batch", () => {
    // beta is unchanged, so this batch is alpha (ambiguous rename) plus beta (no change): both exit 0.
    const r = cg(root, ["apply", "alpha", "beta", "--approve-unambiguous-renames"]);
    assert.equal(r.code, 0, r.stderr || r.stdout);
  });
});

describe("flags that cannot be combined", () => {
  it("--approve-unambiguous-renames with --dry-run exits 1 and says why", () => {
    const r = cg(root, ["apply", "alpha", "--approve-unambiguous-renames", "--dry-run"]);
    assert.equal(r.code, 1);
    assert.match(`${r.stdout}${r.stderr}`, /cannot be combined with --approve-drift, --defer-renames or --dry-run/);
  });

  it("--approve-unambiguous-renames with --defer-renames exits 1 and says why", () => {
    const r = cg(root, ["apply", "alpha", "--approve-unambiguous-renames", "--defer-renames"]);
    assert.equal(r.code, 1);
    assert.match(`${r.stdout}${r.stderr}`, /cannot be combined/);
  });
});

describe("the ambiguous rename is listed in every report until a person settles it", () => {
  it("a session's --finish-update writes the section into the report", () => {
    mustCg(root, ["apply", "alpha", "--approve-unambiguous-renames"]);
    const env = cleanEnv();
    assert.equal(cg(root, ["refresh-skills", "--claim-update", "--concepts", "alpha"], env).code, 0);
    const fin = cg(root, ["refresh-skills", "--finish-update"], env);
    assert.equal(fin.code, 0, fin.stderr || fin.stdout);
    const report = readRel(root, path.join("scribe-output", UPDATE_REPORT_FILE));
    assert.match(report, /^## Ambiguous renames left for a person$/m);
    assert.match(report, /formatLabel/);
  });

  it("a runner's report (claude exits 0, no manifest) lists it too", async () => {
    mustCg(root, ["apply", "alpha", "--approve-unambiguous-renames"]);
    const stateDir = path.join(root, "scribe-output");
    const claim = claimUpdateRun(stateDir, {
      by: "hook",
      concepts: ["alpha"],
      now: Date.now(),
      interval: 0,
      keepLock: true,
    });
    if (!claim.claimed) assert.fail(`the test run must claim: ${claim.reason}`);
    await runUpdate(root, claim.token, ["alpha"], {
      claude: async () => ({ code: 0, stdout: "", stderr: "" }),
      env: cleanEnv(),
      cliScript: DIST,
    });
    const report = readRel(root, path.join("scribe-output", UPDATE_REPORT_FILE));
    assert.match(report, /^## Ambiguous renames left for a person$/m);
    assert.match(report, /formatLabel/);
  });
});
