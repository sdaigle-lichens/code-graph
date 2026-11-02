// The eval CLI wiring for `--store`: the stripped copy is the default, `as-is` measures the store
// untouched, the store line and results JSON name what was measured, and the temp copy is removed on
// success and on failure. Spawns the built CLI against a temp project and a temp store, so the real
// graph is never opened.

import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applySchema, rebuildSearchIndex } from "../scribe/bootstrap.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, "../..");
const CLI = path.join(PKG, "dist/cli.js");

let tmp: string;
let project: string;
let childTmp: string;
let tasks: string;

function seedStore(file: string, opts: { staleFts?: boolean } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  applySchema(db);
  const v = (key: string, name: string, extra: object) =>
    db.prepare("INSERT INTO vertices(key, doc) VALUES(?, ?)").run(
      key,
      JSON.stringify({
        _key: key,
        concept: "c",
        type: "function",
        name,
        filepath: "src/a.ts",
        start_line: 1,
        end_line: 2,
        status: "live",
        ...extra,
      })
    );
  v("v1", "alphaThing", { purpose: "reticulates splines", tags: ["spline"] });
  v("v2", "betaThing", {});
  rebuildSearchIndex(db);
  if (opts.staleFts) db.exec("UPDATE meta SET value = '1' WHERE key = 'fts_format'");
  db.close();
}

function readRows(file: string): { purposes: number; docs: string; fts: string } {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const purposes = (
      db.prepare("SELECT count(*) AS n FROM vertices WHERE json_extract(doc,'$.purpose') IS NOT NULL").get() as {
        n: number;
      }
    ).n;
    const docs = db
      .prepare("SELECT key, doc FROM vertices ORDER BY key")
      .all()
      .map((r) => `${r.key}=${r.doc}`)
      .join("\n");
    const fts =
      (db.prepare("SELECT value FROM meta WHERE key = 'fts_format'").get() as { value: string } | undefined)?.value ??
      "";
    return { purposes, docs, fts };
  } finally {
    db.close();
  }
}

function eval_(args: string[], tasksPath = tasks) {
  const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: childTmp };
  delete env.NODE_OPTIONS;
  delete env.CLAUDE_PROJECT_DIR;
  const r = spawnSync(process.execPath, [CLI, "--root", project, "eval", "--tasks", tasksPath, ...args], {
    encoding: "utf8",
    env,
    cwd: tmp,
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const leftovers = () => fs.readdirSync(childTmp).filter((n) => n.startsWith("code-graph-eval-"));

function latestResults(): { store: string; passed: number } {
  const dir = path.join(project, "eval");
  const files = fs
    .readdirSync(dir)
    .filter((n) => n.startsWith("results-"))
    .sort();
  return JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]!), "utf8"));
}

before(() => {
  assert.ok(fs.existsSync(CLI), `${CLI} is missing, run pnpm build first`);
});

// Fresh fixtures per test: each test calls freshFixtures() first.
function freshFixtures() {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cg-eval-cli-")));
  project = path.join(tmp, "proj");
  childTmp = path.join(tmp, "child-tmp");
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(childTmp);
  fs.writeFileSync(path.join(project, "scribe.config.json"), JSON.stringify({ project: "proj", concepts: {} }));
  seedStore(path.join(project, "scribe-output", "graph.db"));
  tasks = path.join(tmp, "tasks.json");
  fs.writeFileSync(
    tasks,
    JSON.stringify([
      {
        id: "alpha",
        prompt: "alpha thing",
        mode: "search",
        expected: { vertices_in_top_k: [{ name: "alphaThing", k: 3 }] },
      },
    ])
  );
}

afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe("eval CLI --store", () => {
  it("rejects an unknown --store value before opening the store", () => {
    freshFixtures();
    const file = path.join(project, "scribe-output", "graph.db");
    const prior = readRows(file);
    const r = eval_(["--store", "bogus"]);
    assert.equal(r.code, 1);
    assert.match(r.err, /--store must be "stripped" or "as-is", got "bogus"/);
    assert.deepEqual(leftovers(), []);
    assert.deepEqual(readRows(file), prior);
  });

  it("default run is the stripped copy: store line after build: and after the verdict, and in the results JSON", () => {
    freshFixtures();
    const r = eval_([]);
    assert.equal(r.code, 0, r.err);
    const lines = r.out.split("\n");
    const build = lines.findIndex((l) => l.startsWith("build: "));
    const storeLines = lines.map((l, i) => [l, i] as const).filter(([l]) => l.startsWith("store: "));
    assert.equal(storeLines.length, 2, r.out);
    assert.match(
      storeLines[0]![0],
      /^store: un-enriched \(stripped copy, purposes and tags removed, index rebuilt; 1 of 2 vertices/
    );
    assert.ok(storeLines[0]![1] > build, "store line follows the build line");
    assert.ok(storeLines[1]![1] > lines.findIndex((l) => /^green: /.test(l)), "store line repeats after the verdict");
    assert.equal(latestResults().store, storeLines[0]![0]);
  });

  it("--store as-is measures the real store and labels it enriched", () => {
    freshFixtures();
    const r = eval_(["--store", "as-is"]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^store: enriched \(as-is, not stripped; 1 of 2 vertices carry a purpose/m);
    assert.match(latestResults().store, /^store: enriched \(as-is/);
  });

  it("the stripped run leaves the real store's rows (purposes, tags, docs, FTS format) unchanged", () => {
    freshFixtures();
    const file = path.join(project, "scribe-output", "graph.db");
    const prior = readRows(file);
    assert.equal(eval_([]).code, 0);
    assert.deepEqual(readRows(file), prior);
  });

  it("removes the temp copy after a successful run", () => {
    freshFixtures();
    assert.equal(eval_([]).code, 0);
    assert.deepEqual(leftovers(), []);
  });

  it("removes the temp copy when the run fails after it is opened", () => {
    freshFixtures();
    const r = eval_([], path.join(tmp, "does-not-exist.json"));
    assert.equal(r.code, 1);
    assert.match(r.err, /ENOENT/);
    assert.deepEqual(leftovers(), []);
  });

  // The eval never rewrites the real store: the stripped copy is rebuilt anyway, and as-is measures
  // the store exactly as stored.
  it("a stale-format real store is not rewritten by the stripped run", () => {
    freshFixtures();
    const file = path.join(project, "scribe-output", "graph.db");
    fs.rmSync(file);
    seedStore(file, { staleFts: true });
    assert.equal(readRows(file).fts, "1");
    assert.equal(eval_([]).code, 0);
    assert.equal(readRows(file).fts, "1");
  });

  it("a stale-format real store is not rewritten by --store as-is", () => {
    freshFixtures();
    const file = path.join(project, "scribe-output", "graph.db");
    fs.rmSync(file);
    seedStore(file, { staleFts: true });
    assert.equal(eval_(["--store", "as-is"]).code, 0);
    assert.equal(readRows(file).fts, "1");
  });
});

describe("eval exit code: stripped copy passes, as-is store regresses", () => {
  // alphaThing matches the task by name alone. zetaWidget matches it only through its purpose and
  // tags, which the stripped copy removes: so the same store passes stripped and regresses as-is.
  const FIXTURE_HINT =
    "This fixture depends on search ranking (NAME_HIT_FACTOR): if a ranking change broke it, " +
    "adjust the fixture's names/purpose here, not the eval exit-code wiring.";

  function regressionFixtures() {
    freshFixtures();
    const file = path.join(project, "scribe-output", "graph.db");
    fs.rmSync(file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    applySchema(db);
    const v = (key: string, name: string, extra: object) =>
      db.prepare("INSERT INTO vertices(key, doc) VALUES(?, ?)").run(
        key,
        JSON.stringify({
          _key: key,
          concept: "c",
          type: "function",
          name,
          filepath: "src/a.ts",
          start_line: 1,
          end_line: 2,
          status: "live",
          ...extra,
        })
      );
    v("v1", "alphaOnly", {});
    v("v2", "zetaWidget", { purpose: "alpha beta gamma delta alpha beta gamma delta alpha beta gamma delta" });
    // Filler rows keep the FTS idf positive (a two-row corpus scores every shared term at ~0).
    for (let i = 1; i <= 5; i++) v(`f${i}`, `filler${i}Thing`, {});
    rebuildSearchIndex(db);
    db.close();
    fs.writeFileSync(
      tasks,
      JSON.stringify([
        {
          id: "alpha",
          prompt: "alpha beta gamma delta",
          mode: "search",
          expected: { vertices_in_top_k: [{ name: "alphaOnly", k: 1 }] },
        },
      ])
    );
  }

  it("--store as-is exits non-zero and names the regressed task", () => {
    regressionFixtures();
    const r = eval_(["--store", "as-is"]);
    const hint = `${FIXTURE_HINT}\n${r.out}${r.err}`;
    assert.notEqual(r.code, 0, hint);
    assert.equal(r.code, 1, hint);
    assert.match(r.out, /^REGRESSIONS: /m, hint);
    assert.match(r.out, /^failed: alpha$/m, hint);
  });

  it("the default stripped copy exits 0 on the same store", () => {
    regressionFixtures();
    const r = eval_([]);
    assert.equal(r.code, 0, `${FIXTURE_HINT}\n${r.out}${r.err}`);
    assert.match(r.out, /^green: 1\/1 passed/m);
  });
});
