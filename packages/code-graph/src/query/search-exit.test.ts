// `code-graph search` exit code 7 (low confidence), spawned for real against a temp project with a
// store written through the real schema: both the committed plugin bundle and the tsc build.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applySchema, rebuildSearchIndex } from "../scribe/bootstrap.js";
import { putRecord } from "../scribe/rows.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, "../..");
const REPO = path.resolve(PKG, "../..");
const CLIS = [
  { name: "bundle", path: path.join(REPO, "plugin/scripts/code-graph.cjs") },
  { name: "dist", path: path.join(PKG, "dist/cli.js") },
];

const NAME = "parseGapsHandledAcknowledgement";
const STRONG = "parse gaps handled acknowledgement";

let tmp: string;

function vertex(key: string, name: string, extra: Record<string, unknown> = {}, concept = "tasks") {
  return {
    _key: key,
    concept,
    status: "live",
    type: "function",
    name,
    filepath: `src/${name}.ts`,
    start_line: 1,
    end_line: 5,
    ...extra,
  };
}

/** A project whose `tasks` concept has 10 live vertices, `enriched` of them with a purpose (the match is never one). */
function project(enriched: number): void {
  fs.writeFileSync(path.join(tmp, "scribe.config.json"), JSON.stringify({ project: "t" }));
  fs.mkdirSync(path.join(tmp, "scribe-output"), { recursive: true });
  const db = new DatabaseSync(path.join(tmp, "scribe-output", "graph.db"));
  applySchema(db);
  putRecord(db, "docs", "tasks::skill", {
    _key: "tasks::skill",
    concept: "tasks",
    path: ".claude/skills/tasks/SKILL.md",
    body_md: "Queue handling notes.",
  });
  putRecord(db, "vertices", "m", vertex("m", NAME));
  for (let i = 0; i < 9; i++) {
    putRecord(db, "vertices", `f${i}`, vertex(`f${i}`, `filler${i}`, i < enriched ? { purpose: "unrelated" } : {}));
  }
  rebuildSearchIndex(db);
  db.close();
}

function run(cli: string, args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.NODE_OPTIONS;
  const res = spawnSync(process.execPath, [cli, "search", ...args], { encoding: "utf8", env, cwd: tmp });
  return { code: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

before(() => {
  for (const c of CLIS) assert.ok(fs.existsSync(c.path), `${c.path} is missing: run pnpm build from the root first`);
});
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cg-search-exit-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

for (const cli of CLIS) {
  describe(`search exit code 7 (${cli.name})`, () => {
    it("exits 7 on an un-enriched top concept, prints results and the fallback line", () => {
      project(0);
      const r = run(cli.path, [STRONG]);
      assert.equal(r.code, 7, r.stderr);
      assert.match(r.stdout, new RegExp(NAME));
      assert.match(r.stdout, /> Low confidence: concept tasks is un-enriched/);
      assert.match(r.stdout, /grep, or read the concept's SKILL\.md \(\.claude\/skills\/tasks\/SKILL\.md\)/);
    });

    it("exits 7 on a weak match in a fully enriched concept", () => {
      project(9);
      // The matching vertex is un-enriched, so 9/10 = 0.9 clears the enriched share: only the score is weak.
      const r = run(cli.path, ["gaps"]);
      assert.equal(r.code, 7, r.stderr);
      assert.match(r.stdout, /> Low confidence: weak match/);
    });

    it("exits 0 with no fallback line on a strong match in a mostly enriched concept", () => {
      project(9);
      const r = run(cli.path, [STRONG]);
      assert.equal(r.code, 0, r.stderr);
      assert.doesNotMatch(r.stdout, /Low confidence/);
      assert.match(r.stdout, new RegExp(NAME));
    });

    it("exits 0 for an exact symbol-name query in an un-enriched concept", () => {
      project(0);
      const r = run(cli.path, [NAME]);
      assert.equal(r.code, 0, r.stderr);
      assert.doesNotMatch(r.stdout, /Low confidence/);
    });

    it("--json sets low_confidence and low_confidence_reason and still exits 7 with results", () => {
      project(0);
      const r = run(cli.path, [STRONG, "--json"]);
      assert.equal(r.code, 7, r.stderr);
      const out = JSON.parse(r.stdout);
      assert.equal(out.low_confidence, true);
      assert.match(out.low_confidence_reason, /concept tasks is un-enriched/);
      assert.ok(out.hits.length > 0);
    });

    it("--json reports low_confidence false, no reason, exit 0 when confident", () => {
      project(9);
      const r = run(cli.path, [STRONG, "--json"]);
      assert.equal(r.code, 0, r.stderr);
      const out = JSON.parse(r.stdout);
      assert.equal(out.low_confidence, false);
      assert.equal("low_confidence_reason" in out, false);
    });

    it("keeps exit 6 for a query with no hits, not 7", () => {
      project(0);
      const r = run(cli.path, ["zzzzqqqq"]);
      assert.equal(r.code, 6, r.stderr);
    });
  });
}
