// Batch forms of `extract` / `apply` / `drift` (several concepts or `--all`) and the never-applied
// drift line, end to end: the built CLI (dist/cli.js, plus one pass through the committed bundle) is
// spawned against temp projects with a real SQLite store. Nothing is stubbed.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { batchFailureSummary, ReportedError, resolveConceptArgs, runConceptBatch } from "./concept-batch.js";
import { bootstrapStore } from "./scribe/bootstrap.js";
import { isConceptApplied } from "./scribe/enrich.js";
import { docKey, putRecord } from "./scribe/rows.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, "..");
const REPO = path.resolve(PKG, "../..");
const DIST = path.join(PKG, "dist/cli.js");
const BUNDLE = path.join(REPO, "plugin/scripts/code-graph.cjs");

const DRIFT_SHAPE = ["changed", "concept", "doc", "missing", "new", "renameCandidates", "stale", "unextracted"];

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cg-batch-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], cli = DIST): Run {
  assert.ok(fs.existsSync(cli), `${cli} is missing — run \`pnpm build\` from the repository root first`);
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.NODE_OPTIONS;
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env, cwd: tmp });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

function write(rel: string, content: string): string {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

const skill = (name: string) => `---\nname: ${name}\ndescription: "x"\n---\n\n# ${name}\n\nBody of ${name}.\n`;
const astPath = (c: string) => path.join(tmp, "scribe-output", `${c}.ast.json`);
const count = (s: string, re: RegExp) => (s.match(new RegExp(re.source, "g")) ?? []).length;

/** Three docs-only concepts (no tsconfig, no ts-morph): g1, g2, g3, each with its own SKILL.md. */
function docsProject(names = ["g1", "g2", "g3"]) {
  const concepts: Record<string, unknown> = {};
  for (const n of names) {
    concepts[n] = { globs: [`docs/${n}/**/*.md`], skill: `docs/${n}/SKILL.md` };
    write(`docs/${n}/SKILL.md`, skill(n));
  }
  write("scribe.config.json", JSON.stringify({ project: "p", concepts }));
}

/** Docs rows (concept keys) currently in the store. */
function docRows(): string[] {
  const db = new DatabaseSync(path.join(tmp, "scribe-output/graph.db"), { readOnly: true });
  try {
    return (db.prepare("SELECT key FROM docs ORDER BY key").all() as Array<{ key: string }>).map((r) => r.key);
  } finally {
    db.close();
  }
}

describe("resolveConceptArgs / runConceptBatch / batchFailureSummary", () => {
  it("named concepts are de-duplicated in order; --all is config order; neither or both throw", () => {
    assert.deepEqual(resolveConceptArgs(["a", "b", "c"], ["c", "a", "c"], false), ["c", "a"]);
    assert.deepEqual(resolveConceptArgs(["a", "b", "c"], [], true), ["a", "b", "c"]);
    assert.throws(() => resolveConceptArgs(["a"], ["a"], true), /pass concept names or --all, not both/);
    assert.throws(() => resolveConceptArgs(["a"], [], false), /name at least one concept, or pass --all/);
  });

  it("runs every concept past a failure and returns the failures; a ReportedError is not printed again", async () => {
    const seen: string[] = [];
    const errors: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void errors.push(a.join(" "));
    let failed;
    try {
      failed = await runConceptBatch("apply", ["a", "b", "c", "d"], async (c) => {
        seen.push(c);
        if (c === "b") throw new Error("boom");
        if (c === "d") throw new ReportedError("already said");
      });
    } finally {
      console.error = orig;
    }
    assert.deepEqual(seen, ["a", "b", "c", "d"]);
    assert.deepEqual(failed, [
      { concept: "b", error: "boom" },
      { concept: "d", error: "already said" },
    ]);
    assert.deepEqual(errors, ["apply b failed: boom"]);
    assert.equal(batchFailureSummary("apply", failed, 4), "apply: 2 of 4 concept(s) failed: b, d");
  });
});

describe("isConceptApplied (real store)", () => {
  it("is true for a live vertex OR a docs row; archived-only and other concepts' rows do not count", () => {
    const store = bootstrapStore(path.join(tmp, "graph.db"));
    try {
      assert.equal(isConceptApplied(store, "c"), false, "empty store");
      putRecord(store, "vertices", "k-other", { concept: "other", status: "live", name: "x" });
      putRecord(store, "docs", docKey("other"), { concept: "other" });
      assert.equal(isConceptApplied(store, "c"), false, "another concept's rows");
      putRecord(store, "vertices", "k-arch", { concept: "c", status: "archived", name: "y" });
      assert.equal(isConceptApplied(store, "c"), false, "archived vertex only");
      putRecord(store, "vertices", "k-live", { concept: "c", status: "live", name: "z" });
      assert.equal(isConceptApplied(store, "c"), true, "live vertex");
      assert.equal(isConceptApplied(store, "d"), false);
      putRecord(store, "docs", docKey("d"), { concept: "d" });
      assert.equal(isConceptApplied(store, "d"), true, "docs row with no vertex (docs-only concept)");
    } finally {
      store.close();
    }
  });
});

describe("extract / apply / drift: argument errors", () => {
  for (const cmd of ["extract", "apply", "drift"]) {
    it(`${cmd}: names + --all and no names at all both exit 1 and touch nothing`, () => {
      docsProject();
      const both = run([cmd, "g1", "--all"]);
      assert.equal(both.code, 1, both.stdout + both.stderr);
      assert.match(both.stderr, /pass concept names or --all, not both/);
      const none = run([cmd]);
      assert.equal(none.code, 1, none.stdout + none.stderr);
      assert.match(none.stderr, /name at least one concept, or pass --all/);
      assert.ok(!fs.existsSync(path.join(tmp, "scribe-output")), "nothing extracted or applied");
    });
  }

  it("with no concepts configured, the batch forms still skip with exit 0", () => {
    write("scribe.config.json", JSON.stringify({ project: "p", concepts: {} }));
    for (const cmd of ["extract", "apply", "drift"]) {
      const r = run([cmd, "--all"]);
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /no concepts configured in scribe\.config\.json, skipped/);
    }
  });
});

describe("extract batch", () => {
  it("several names and --all extract every concept; stderr summaries are prefixed with the concept", () => {
    docsProject();
    const r = run(["extract", "g1", "g3"]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(fs.existsSync(astPath("g1")) && fs.existsSync(astPath("g3")));
    assert.ok(!fs.existsSync(astPath("g2")), "only the named concepts");
    assert.match(r.stderr, /^g1: 0 vertices/m);
    assert.match(r.stderr, /^g3: 0 vertices/m);

    const all = run(["extract", "--all"]);
    assert.equal(all.code, 0, all.stderr);
    for (const c of ["g1", "g2", "g3"]) assert.ok(fs.existsSync(astPath(c)), c);
  });

  it("a failing concept does not stop the rest: exit 1, error printed once, summary names it", () => {
    docsProject();
    // g2 has no explicit skill and no <skillsDir>/g2/SKILL.md: a docs-only concept with no SKILL.md.
    const cfg = JSON.parse(fs.readFileSync(path.join(tmp, "scribe.config.json"), "utf8"));
    delete cfg.concepts.g2.skill;
    write("scribe.config.json", JSON.stringify(cfg));

    const r = run(["extract", "--all"]);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.ok(fs.existsSync(astPath("g1")) && fs.existsSync(astPath("g3")), "g1 and g3 still extracted");
    assert.ok(!fs.existsSync(astPath("g2")));
    assert.equal(count(r.stderr, /docs-only concept "g2" has no SKILL\.md/), 1, r.stderr);
    assert.match(r.stderr, /extract: 1 of 3 concept\(s\) failed: g2/);
  });

  it("an unknown concept in a batch fails alone (exit 1) and the others are extracted", () => {
    docsProject(["g1", "g2"]);
    const r = run(["extract", "g1", "ghost", "g2"]);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.ok(fs.existsSync(astPath("g1")) && fs.existsSync(astPath("g2")));
    assert.match(r.stderr, /ghost/);
    assert.match(r.stderr, /extract: 1 of 3 concept\(s\) failed: ghost/);
  });

  it("a single concept behaves as before: no prefix, no batch summary, exit 1 on failure", () => {
    docsProject();
    const ok = run(["extract", "g1"]);
    assert.equal(ok.code, 0, ok.stderr);
    assert.match(ok.stderr, /^0 vertices/m);
    assert.doesNotMatch(ok.stderr, /^g1: /m);

    fs.rmSync(path.join(tmp, "docs/g2/SKILL.md"));
    const bad = run(["extract", "g2"]);
    assert.equal(bad.code, 1);
    assert.doesNotMatch(bad.stderr, /concept\(s\) failed/);
  });
});

describe("apply batch", () => {
  it("several names / --all apply every concept (docs rows), a missing ast.json fails alone", () => {
    docsProject();
    assert.equal(run(["extract", "--all"]).code, 0);
    run(["bootstrap"]);

    const two = run(["apply", "g1", "g2"]);
    assert.equal(two.code, 0, two.stderr);
    assert.deepEqual(docRows(), [docKey("g1"), docKey("g2")]);

    fs.rmSync(astPath("g2"));
    const r = run(["apply", "--all"]);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.deepEqual(docRows(), [docKey("g1"), docKey("g2"), docKey("g3")], "g3 applied past the g2 failure");
    assert.equal(count(r.stderr, /g2\.ast\.json not found — run: code-graph extract g2/), 1, r.stderr);
    assert.match(r.stderr, /apply: 1 of 3 concept\(s\) failed: g2/);
    // Text reports of the concepts that ran are separated by a blank line.
    assert.match(r.stdout, /Concept: g1[\s\S]*\n\nConcept: g3/);
  });

  it("apply --dry-run --json batch prints one { concepts, failed } object", () => {
    docsProject(["g1", "g2"]);
    run(["extract", "--all"]);
    run(["bootstrap"]);
    run(["apply", "g1"]);
    const r = run(["apply", "--all", "--dry-run", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const body = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(body).sort(), ["concepts", "failed"]);
    assert.deepEqual(body.failed, []);
    assert.deepEqual(Object.keys(body.concepts[0]).sort(), DRIFT_SHAPE);
    assert.deepEqual(body.concepts[1], { concept: "g2", neverApplied: true, vertices: 0 });
    assert.deepEqual(docRows(), [docKey("g1")], "a dry run writes nothing");
  });

  it("apply --json without --dry-run is still refused in batch form", () => {
    docsProject();
    const r = run(["apply", "--all", "--json"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /--json needs --dry-run/);
  });
});

describe("drift batch", () => {
  it("--json over several concepts: one object, applied reports keep the full shape", () => {
    docsProject();
    run(["extract", "--all"]);
    run(["bootstrap"]);
    assert.equal(run(["apply", "--all"]).code, 0);

    const r = run(["drift", "g1", "g3", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim().split("\n").length, 1, "one JSON line");
    const body = JSON.parse(r.stdout);
    assert.deepEqual(
      body.concepts.map((c: any) => c.concept),
      ["g1", "g3"]
    );
    for (const c of body.concepts) assert.deepEqual(Object.keys(c).sort(), DRIFT_SHAPE);
    assert.deepEqual(body.failed, []);
  });

  it("--json with a failing concept: exit 1, valid JSON with the others and the failure listed", () => {
    docsProject();
    run(["extract", "--all"]);
    run(["bootstrap"]);
    run(["apply", "--all"]);
    fs.rmSync(astPath("g2"));
    const r = run(["drift", "--all", "--json"]);
    assert.equal(r.code, 1);
    const body = JSON.parse(r.stdout);
    assert.deepEqual(
      body.concepts.map((c: any) => c.concept),
      ["g1", "g3"]
    );
    assert.equal(body.failed.length, 1);
    assert.equal(body.failed[0].concept, "g2");
    assert.match(body.failed[0].error, /g2\.ast\.json not found/);
    assert.match(r.stderr, /drift: 1 of 3 concept\(s\) failed: g2/);
  });

  it("text --all prints each concept's report, separated by a blank line", () => {
    docsProject();
    run(["extract", "--all"]);
    run(["bootstrap"]);
    run(["apply", "--all"]);
    const r = run(["drift", "--all"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^Concept: g1\n[\s\S]*\n\nConcept: g2\n[\s\S]*\n\nConcept: g3\n/);
  });

  it("a single concept (named, or --all over a one-concept config) prints the bare report as before", () => {
    docsProject(["g1"]);
    run(["extract", "g1"]);
    run(["bootstrap"]);
    run(["apply", "g1"]);
    for (const args of [
      ["drift", "g1", "--json"],
      ["drift", "--all", "--json"],
    ]) {
      const r = run(args);
      assert.equal(r.code, 0, r.stderr);
      const d = JSON.parse(r.stdout);
      assert.deepEqual(Object.keys(d).sort(), DRIFT_SHAPE, args.join(" "));
    }
    fs.rmSync(astPath("g1"));
    const bad = run(["drift", "g1"]);
    assert.equal(bad.code, 1);
    assert.equal(count(bad.stderr, /g1\.ast\.json not found/), 1, bad.stderr);
    assert.doesNotMatch(bad.stderr, /concept\(s\) failed/);
  });
});

describe("drift on a never-applied concept", () => {
  function tsProject() {
    write(
      "scribe.config.json",
      JSON.stringify({
        project: "p",
        tsconfig: "tsconfig.json",
        concepts: { c: { globs: ["src/**/*.ts"] }, g1: { globs: ["docs/g1/**/*.md"], skill: "docs/g1/SKILL.md" } },
      })
    );
    write(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", strict: true }, include: ["src"] })
    );
    write("docs/g1/SKILL.md", skill("g1"));
    write(
      "src/a.ts",
      'export function alpha(x: number): number {\n  return x + 1;\n}\nexport function beta(): string {\n  return "b";\n}\n'
    );
    fs.symlinkSync(path.join(PKG, "node_modules"), path.join(tmp, "node_modules"), "dir");
  }

  it("text: one line with the vertex count; --json: {concept, neverApplied, vertices}; nothing written", () => {
    tsProject();
    assert.equal(run(["extract", "--all"]).code, 0);
    run(["bootstrap"]);
    const n = JSON.parse(fs.readFileSync(astPath("c"), "utf8")).vertices.length;
    assert.ok(n >= 2, `expected the two functions, got ${n}`);

    const text = run(["drift", "c"]);
    assert.equal(text.code, 0, text.stderr);
    assert.equal(
      text.stdout,
      `Concept: c  never applied, ${n} vertices to insert — run: code-graph apply c\n`,
      "exactly one line"
    );

    for (const args of [
      ["drift", "c", "--json"],
      ["apply", "c", "--dry-run", "--json"],
    ]) {
      const r = run(args);
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(JSON.parse(r.stdout), { concept: "c", neverApplied: true, vertices: n }, args.join(" "));
    }
    assert.deepEqual(docRows(), [], "drift wrote nothing");

    // Batch over a mix: once c is applied it gets the full report, g1 stays never-applied.
    assert.equal(run(["apply", "c"]).code, 0);
    const mix = run(["drift", "--all", "--json"]);
    assert.equal(mix.code, 0, mix.stderr);
    const body = JSON.parse(mix.stdout);
    assert.deepEqual(Object.keys(body.concepts[0]).sort(), DRIFT_SHAPE);
    assert.deepEqual(body.concepts[0].new, []);
    assert.deepEqual(body.concepts[1], { concept: "g1", neverApplied: true, vertices: 0 });

    const mixText = run(["drift", "--all"]);
    assert.equal(mixText.code, 0);
    assert.match(mixText.stdout, /^Concept: c\n/);
    assert.match(mixText.stdout, /\n\nConcept: g1  never applied, 0 vertices to insert — run: code-graph apply g1\n$/);
  });

  it("a docs-only concept with a docs row counts as applied (full report, not the never-applied line)", () => {
    docsProject(["g1"]);
    run(["extract", "g1"]);
    run(["bootstrap"]);
    assert.match(run(["drift", "g1"]).stdout, /never applied/);
    run(["apply", "g1"]);
    const r = run(["drift", "g1"]);
    assert.doesNotMatch(r.stdout, /never applied/);
    assert.match(r.stdout, /^Concept: g1\n {2}new: {8}0/);
  });
});

/** Rows of the real store (read-only), JSON docs parsed. */
function storeDocs(sql: string, ...params: string[]): any[] {
  const db = new DatabaseSync(path.join(tmp, "scribe-output/graph.db"), { readOnly: true });
  try {
    return (db.prepare(sql).all(...params) as Array<{ doc: string }>).map((r) => JSON.parse(r.doc));
  } finally {
    db.close();
  }
}
const liveVertices = (c: string) =>
  storeDocs("SELECT doc FROM vertices WHERE concept = ? AND status = 'live' ORDER BY key", c);
const skillHash = (c: string): string | undefined =>
  storeDocs("SELECT doc FROM docs WHERE key = ?", docKey(c)).map((d) => d.body_hash)[0];
const vertexRows = (c: string): string => JSON.stringify(storeDocs("SELECT doc FROM vertices WHERE concept = ?", c));

const TSCONFIG = JSON.stringify({
  compilerOptions: { target: "ES2022", module: "ESNext", strict: true },
  include: ["src"],
});
// Two independent functions: neither is named in the SKILL.md nor a hub, so neither is core.
const SRC =
  "export function computeTotalAmount(price: number, qty: number): number {\n  return price * qty;\n}\n" +
  'export function formatLabel(s: string): string {\n  return "[" + s + "]";\n}\n';
// computeTotalAmount -> computeTotalAmounts: same file and type, similarity well above 0.8 (a candidate).
const RENAMED = SRC.replace("computeTotalAmount(", "computeTotalAmounts(");

/** A code concept `c` (src/**\/*.ts) plus docs-only concepts, real tsconfig, ts-morph via node_modules. */
function codeProject(docs: string[] = [], withSource = true) {
  const concepts: Record<string, unknown> = { c: { globs: ["src/**/*.ts"], skill: "docs/c/SKILL.md" } };
  for (const n of docs) {
    concepts[n] = { globs: [`docs/${n}/**/*.md`], skill: `docs/${n}/SKILL.md` };
    write(`docs/${n}/SKILL.md`, skill(n));
  }
  write("scribe.config.json", JSON.stringify({ project: "p", tsconfig: "tsconfig.json", concepts }));
  write("tsconfig.json", TSCONFIG);
  write("docs/c/SKILL.md", skill("c"));
  fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
  if (withSource) write("src/a.ts", SRC);
  fs.symlinkSync(path.join(PKG, "node_modules"), path.join(tmp, "node_modules"), "dir");
}

function targetsSummary(c: string) {
  const r = run(["enrich", "targets", c, "--summary", "--json"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout);
}

describe("isConceptApplied drives apply's touched_at and enrich targets", () => {
  it("a concept applied with only a docs row, which later gains code, counts as applied: new vertices get touched_at and are listed as new", () => {
    // c starts docs-only (a code concept with no matching source cannot be extracted at all).
    codeProject([], false);
    const setGlobs = (globs: string[]) => {
      const cfg = JSON.parse(fs.readFileSync(path.join(tmp, "scribe.config.json"), "utf8"));
      cfg.concepts.c.globs = globs;
      write("scribe.config.json", JSON.stringify(cfg));
    };
    setGlobs(["docs/c/**/*.md"]);
    const ex = run(["extract", "c"]);
    assert.equal(ex.code, 0, ex.stdout + ex.stderr);
    assert.equal(JSON.parse(fs.readFileSync(astPath("c"), "utf8")).vertices.length, 0, "no code yet");
    run(["bootstrap"]);
    const first = run(["apply", "c"]);
    assert.equal(first.code, 0, first.stdout + first.stderr);
    assert.deepEqual(docRows(), [docKey("c")], "docs row written");
    assert.deepEqual(liveVertices("c"), [], "no vertex");
    assert.equal(targetsSummary("c").applied, true, "a docs row alone is applied");

    // The concept gains code: this is a task's touch, not the first ingest.
    setGlobs(["src/**/*.ts"]);
    write("src/a.ts", SRC);
    assert.equal(run(["extract", "c"]).code, 0);
    const before = targetsSummary("c");
    assert.equal(before.applied, true);
    assert.deepEqual(before.targets.map((t: any) => [t.name, t.reasons]).sort(), [
      ["computeTotalAmount", ["new"]],
      ["formatLabel", ["new"]],
    ]);
    assert.equal(before.core.leftOut, 0, "touched since the apply, not left out");

    const second = run(["apply", "c"]);
    assert.equal(second.code, 0, second.stdout + second.stderr);
    const vs = liveVertices("c");
    assert.deepEqual(vs.map((v) => v.name).sort(), ["computeTotalAmount", "formatLabel"]);
    for (const v of vs) assert.equal(typeof v.agent?.touched_at, "string", `${v.name} stamped touched_at`);

    // After the apply the store has them; touched_at keeps them listed as new.
    const after = targetsSummary("c");
    assert.deepEqual(after.targets.map((t: any) => [t.name, t.reasons]).sort(), [
      ["computeTotalAmount", ["new"]],
      ["formatLabel", ["new"]],
    ]);
    assert.equal(after.counts.new, 2);
    assert.equal(after.core.leftOut, 0);
    for (const t of after.targets) assert.equal(t.core, false, `${t.name} is new because touched, not core`);
  });

  it("a genuine first apply (empty store for the concept) stamps no touched_at; targets leave the non-core vertices out", () => {
    codeProject();
    assert.equal(run(["extract", "c"]).code, 0);
    run(["bootstrap"]);
    const pre = targetsSummary("c");
    assert.equal(pre.applied, false);
    assert.deepEqual(pre.targets, [], "nothing counts as touched before the first apply");
    assert.equal(pre.core.leftOut, 2);

    const r = run(["apply", "c"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const vs = liveVertices("c");
    assert.deepEqual(vs.map((v) => v.name).sort(), ["computeTotalAmount", "formatLabel"]);
    for (const v of vs) assert.equal(v.agent?.touched_at, undefined, `${v.name} has no touched_at`);

    const post = targetsSummary("c");
    assert.equal(post.applied, true);
    assert.deepEqual(post.targets, []);
    assert.equal(post.counts.new, 0);
    assert.equal(post.core.leftOut, 2);
  });
});

describe("apply --defer-renames in a batch", () => {
  /** c (code) + g1, g2 (docs-only) applied, then c gets a rename candidate and g1/g2 an edited SKILL.md. */
  function deferredSetup() {
    codeProject(["g1", "g2"]);
    assert.equal(run(["extract", "--all"]).code, 0);
    run(["bootstrap"]);
    assert.equal(run(["apply", "--all"]).code, 0);
    write("src/a.ts", RENAMED);
    write("docs/g1/SKILL.md", skill("g1") + "\nEdited.\n");
    write("docs/g2/SKILL.md", skill("g2") + "\nEdited.\n");
    assert.equal(run(["extract", "--all"]).code, 0);
    return { cRows: vertexRows("c"), g1Hash: skillHash("g1"), g2Hash: skillHash("g2") };
  }

  it("a deferred concept does not stop the rest; the batch exits 10", () => {
    const before = deferredSetup();
    const r = run(["apply", "--all", "--defer-renames"]);
    assert.equal(r.code, 10, r.stdout + r.stderr);
    assert.match(
      r.stdout,
      /Deferred: 1 rename candidate\(s\) need a decision; nothing was written\.\n {2}run: code-graph apply c/
    );
    assert.doesNotMatch(r.stdout, /Approve rename/, "never prompts");
    assert.doesNotMatch(r.stderr, /failed/);
    assert.equal(vertexRows("c"), before.cRows, "c left unwritten");
    assert.notEqual(skillHash("g1"), before.g1Hash, "g1 applied after the deferred c");
    assert.notEqual(skillHash("g2"), before.g2Hash, "g2 applied after the deferred c");
    assert.match(r.stdout, /Concept: c[\s\S]*\n\nConcept: g1[\s\S]*\n\nConcept: g2/);

    // The same drift is left for the person who applies c.
    const d = JSON.parse(run(["drift", "c", "--json"]).stdout);
    assert.equal(d.renameCandidates.length, 1);
  });

  it("named batch: the deferred concept in the middle does not stop the next one (exit 10)", () => {
    const before = deferredSetup();
    const r = run(["apply", "g1", "c", "g2", "--defer-renames"]);
    assert.equal(r.code, 10, r.stdout + r.stderr);
    assert.equal(vertexRows("c"), before.cRows);
    assert.notEqual(skillHash("g1"), before.g1Hash);
    assert.notEqual(skillHash("g2"), before.g2Hash);
  });

  it("deferred and failed in one batch: exit 1 (a failure wins over a deferral); the rest still applies", () => {
    const before = deferredSetup();
    fs.rmSync(astPath("g1"));
    const r = run(["apply", "--all", "--defer-renames"]);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /Deferred: 1 rename candidate\(s\) need a decision/);
    assert.equal(count(r.stderr, /g1\.ast\.json not found/), 1, r.stderr);
    assert.match(r.stderr, /apply: 1 of 3 concept\(s\) failed: g1$/m, "only the failure is named, not c");
    assert.equal(vertexRows("c"), before.cRows, "c still left unwritten");
    assert.equal(skillHash("g1"), before.g1Hash);
    assert.notEqual(skillHash("g2"), before.g2Hash, "g2 applied past both");
  });

  it("no rename candidate anywhere: the batch applies everything and exits 0", () => {
    const before = deferredSetup();
    write("src/a.ts", SRC);
    assert.equal(run(["extract", "c"]).code, 0);
    const r = run(["apply", "--all", "--defer-renames"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /Deferred/);
    assert.notEqual(skillHash("g1"), before.g1Hash);
  });

  it("a single `apply c --defer-renames` (named, or --all over a one-concept config) still exits 10", () => {
    const before = deferredSetup();
    const one = run(["apply", "c", "--defer-renames"]);
    assert.equal(one.code, 10, one.stdout + one.stderr);
    assert.match(one.stdout, /Deferred: 1 rename candidate/);
    assert.doesNotMatch(one.stdout + one.stderr, /concept\(s\) failed/);
    assert.equal(vertexRows("c"), before.cRows);
    assert.equal(skillHash("g1"), before.g1Hash, "only c was named");

    const cfg = JSON.parse(fs.readFileSync(path.join(tmp, "scribe.config.json"), "utf8"));
    cfg.concepts = { c: cfg.concepts.c };
    write("scribe.config.json", JSON.stringify(cfg));
    const all = run(["apply", "--all", "--defer-renames"]);
    assert.equal(all.code, 10, all.stdout + all.stderr);
    assert.equal(vertexRows("c"), before.cRows);
  });

  it("--defer-renames with --approve-drift is still refused in batch form (exit 1, nothing written)", () => {
    const before = deferredSetup();
    const r = run(["apply", "--all", "--defer-renames", "--approve-drift"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /--defer-renames and --approve-drift are mutually exclusive/);
    assert.equal(vertexRows("c"), before.cRows);
    assert.equal(skillHash("g1"), before.g1Hash);
  });
});

describe("the committed bundle carries the batch forms", () => {
  it("extract --all, apply --all and drift --all --json work through plugin/scripts/code-graph.cjs", () => {
    docsProject(["g1", "g2"]);
    assert.equal(run(["extract", "--all"], BUNDLE).code, 0);
    run(["bootstrap"], BUNDLE);
    assert.equal(run(["apply", "g1"], BUNDLE).code, 0);
    const r = run(["drift", "--all", "--json"], BUNDLE);
    assert.equal(r.code, 0, r.stderr);
    const body = JSON.parse(r.stdout);
    assert.equal(body.concepts[0].concept, "g1");
    assert.deepEqual(body.concepts[1], { concept: "g2", neverApplied: true, vertices: 0 });
  });
});
