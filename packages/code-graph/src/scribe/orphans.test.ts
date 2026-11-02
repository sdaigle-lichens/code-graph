// Orphaned enriched entries: remap on a file move, ambiguous and unmatched entries left in place and
// reported once, and the explicit `enrich prune` (dry run by default). Spawns the built CLI (dist/cli.js)
// against temp projects; nothing is stubbed.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { planOrphans } from "./enrich.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, "../..");
const DIST = path.join(PKG, "dist/cli.js");

let tmp: string;

beforeEach(() => {
  assert.ok(fs.existsSync(DIST), `${DIST} is missing — run \`pnpm build\` from the repository root first`);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cg-orphans-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function run(args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.NODE_OPTIONS;
  const r = spawnSync(process.execPath, [DIST, ...args], { encoding: "utf8", env, cwd: tmp });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

function write(rel: string, content: string): string {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(tmp, rel), "utf8"));
const ENRICHED = "scribe-output/c.enriched.json";
const keyOf = (name: string): string =>
  readJson("scribe-output/c.ast.json").vertices.find((v: any) => v.name === name)._key;
const enrichedKeys = (): string[] => readJson(ENRICHED).vertices.map((v: any) => v._key);

const ALPHA = "export function alpha(x: number): number {\n  return x + 1;\n}\n";
const BETA = "export function beta(x: number): number {\n  return x * 2;\n}\n";

function project() {
  write(
    "scribe.config.json",
    JSON.stringify({ project: "p", tsconfig: "tsconfig.json", concepts: { c: { globs: ["src/**/*.ts"] } } })
  );
  write(
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", strict: true }, include: ["src"] })
  );
  write("src/a.ts", ALPHA);
  write("src/b.ts", BETA);
  fs.symlinkSync(path.join(PKG, "node_modules"), path.join(tmp, "node_modules"), "dir");
}

/** extract, enrich alpha + beta, apply: the baseline every case moves a file away from. */
function enrichedAndApplied() {
  project();
  assert.equal(run(["extract", "c"]).code, 0);
  const partial = {
    concept: "c",
    vertices: [
      { _key: keyOf("alpha"), purpose: "adds one" },
      { _key: keyOf("beta"), purpose: "doubles" },
    ],
    edges: [],
  };
  assert.equal(run(["enrich", "merge", "c", write("partial.json", JSON.stringify(partial))]).code, 0);
  assert.equal(run(["apply", "c"]).code, 0);
}

function moveAlpha(to: string) {
  fs.rmSync(path.join(tmp, "src/a.ts"));
  write(to, ALPHA);
  assert.equal(run(["extract", "c"]).code, 0);
}

describe("apply remaps an enriched entry after a file move", () => {
  it("re-keys the unambiguous entry onto the moved vertex, keeping its purpose, and says so once", () => {
    enrichedAndApplied();
    const oldKey = keyOf("alpha");
    moveAlpha("src/moved/a.ts");
    const newKey = keyOf("alpha");
    assert.notEqual(oldKey, newKey);
    const r = run(["apply", "c"]);
    assert.equal(r.code, 0);
    assert.equal(r.stderr.trim().split("\n").length, 1, "one summary line");
    assert.match(r.stderr, /1 remapped onto moved vertices/);
    assert.doesNotMatch(r.stderr, /warning/);
    const entries = readJson(ENRICHED).vertices;
    assert.ok(!enrichedKeys().includes(oldKey));
    assert.equal(entries.find((v: any) => v._key === newKey).purpose, "adds one");
    // the second apply is quiet
    assert.equal(run(["apply", "c"]).stderr, "");
  });

  it("does not touch the file on a dry run", () => {
    enrichedAndApplied();
    const oldKey = keyOf("alpha");
    moveAlpha("src/moved/a.ts");
    const before = fs.readFileSync(path.join(tmp, ENRICHED), "utf8");
    const r = run(["apply", "c", "--dry-run"]);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /1 would be remapped/);
    assert.equal(fs.readFileSync(path.join(tmp, ENRICHED), "utf8"), before);
    assert.ok(enrichedKeys().includes(oldKey));
  });
});

describe("apply leaves unmatched and ambiguous entries in place", () => {
  it("reports an entry whose vertex was removed as one unmatched line, and deletes nothing", () => {
    enrichedAndApplied();
    const oldKey = keyOf("alpha");
    fs.rmSync(path.join(tmp, "src/a.ts"));
    assert.equal(run(["extract", "c"]).code, 0);
    const before = fs.readFileSync(path.join(tmp, ENRICHED), "utf8");
    const r = run(["apply", "c"]);
    assert.equal(r.code, 0);
    assert.equal(r.stderr.trim().split("\n").length, 1);
    assert.match(r.stderr, /1 unmatched/);
    assert.match(r.stderr, /enrich prune c/);
    assert.equal(fs.readFileSync(path.join(tmp, ENRICHED), "utf8"), before);
    assert.ok(enrichedKeys().includes(oldKey));
  });

  it("reports a move that lands on two same-name vertices as ambiguous", () => {
    enrichedAndApplied();
    fs.rmSync(path.join(tmp, "src/a.ts"));
    write("src/x/a.ts", ALPHA.replace("x + 1", "x + 3"));
    write("src/y/a.ts", ALPHA.replace("x + 1", "x + 2"));
    assert.equal(run(["extract", "c"]).code, 0);
    const before = fs.readFileSync(path.join(tmp, ENRICHED), "utf8");
    const r = run(["apply", "c"]);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /1 ambiguous/);
    assert.equal(r.stderr.trim().split("\n").length, 1);
    assert.equal(fs.readFileSync(path.join(tmp, ENRICHED), "utf8"), before);
  });
});

describe("enrich prune", () => {
  it("lists the leftovers by default and writes nothing", () => {
    enrichedAndApplied();
    const oldKey = keyOf("alpha");
    fs.rmSync(path.join(tmp, "src/a.ts"));
    assert.equal(run(["extract", "c"]).code, 0);
    const before = fs.readFileSync(path.join(tmp, ENRICHED), "utf8");
    const r = run(["enrich", "prune", "c"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /would be dropped/);
    assert.match(r.stdout, new RegExp(`${oldKey} alpha \\[unmatched\\] adds one`));
    assert.match(r.stdout, /dry run/);
    assert.equal(fs.readFileSync(path.join(tmp, ENRICHED), "utf8"), before);
  });

  it("--yes drops only the leftovers; apply is quiet afterwards", () => {
    enrichedAndApplied();
    const betaKey = keyOf("beta");
    fs.rmSync(path.join(tmp, "src/a.ts"));
    assert.equal(run(["extract", "c"]).code, 0);
    const r = run(["enrich", "prune", "c", "--yes"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /1 orphaned entry dropped/);
    assert.deepEqual(enrichedKeys(), [betaKey]);
    assert.equal(run(["apply", "c"]).stderr, "");
  });

  it("never drops an entry apply could remap", () => {
    enrichedAndApplied();
    moveAlpha("src/moved/a.ts");
    const r = run(["enrich", "prune", "c", "--yes"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /no orphaned entries to drop/);
    assert.match(r.stdout, /1 more map onto a moved vertex/);
    assert.equal(enrichedKeys().length, 2);
  });
});

describe("enrich targets mentions orphans", () => {
  it("adds an orphans count to the JSON and one text line", () => {
    enrichedAndApplied();
    fs.rmSync(path.join(tmp, "src/a.ts"));
    assert.equal(run(["extract", "c"]).code, 0);
    assert.equal(JSON.parse(run(["enrich", "targets", "c", "--json"]).stdout).orphans, 1);
    assert.match(run(["enrich", "targets", "c"]).stdout, /1 orphaned enriched entry not in ast.json/);
  });
});

/** A vertex row as the store holds it (`doc` JSON), live or archived; undefined when the key was never inserted. */
function storeDoc(key: string): any {
  const db = new DatabaseSync(path.join(tmp, "scribe-output/graph.db"));
  try {
    const row = db.prepare("SELECT doc FROM vertices WHERE key = ?").get(key) as { doc: string } | undefined;
    return row ? JSON.parse(row.doc) : undefined;
  } finally {
    db.close();
  }
}

/** The _key of the vertex `name` in `file` (a path relative to the project) in <concept>.ast.json. */
const keyAt = (concept: string, file: string, name: string): string =>
  readJson(`scribe-output/${concept}.ast.json`).vertices.find(
    (v: any) => v.name === name && String(v.filepath).endsWith(file)
  )._key;

/** Two concepts over disjoint folders: c owns src/c, d owns src/d. */
function twoConceptProject() {
  write(
    "scribe.config.json",
    JSON.stringify({
      project: "p",
      tsconfig: "tsconfig.json",
      concepts: { c: { globs: ["src/c/**/*.ts"] }, d: { globs: ["src/d/**/*.ts"] } },
    })
  );
  write(
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", strict: true }, include: ["src"] })
  );
  write("src/c/a.ts", ALPHA);
  write("src/c/b.ts", BETA);
  fs.symlinkSync(path.join(PKG, "node_modules"), path.join(tmp, "node_modules"), "dir");
}

describe("orphan remap, store and isolation", () => {
  it("stores the remapped vertex with its purpose live, and archives the old key", () => {
    enrichedAndApplied();
    const oldKey = keyOf("alpha");
    moveAlpha("src/moved/a.ts");
    assert.equal(run(["apply", "c"]).code, 0);
    const newKey = keyOf("alpha");
    assert.equal(storeDoc(newKey).status, "live");
    assert.equal(storeDoc(newKey).purpose, "adds one");
    assert.equal(storeDoc(oldKey).status, "archived");
  });

  it("does not remap onto a same-named vertex that belongs to another concept", () => {
    twoConceptProject();
    assert.equal(run(["extract", "c"]).code, 0);
    const oldKey = keyAt("c", "src/c/a.ts", "alpha");
    assert.equal(
      run([
        "enrich",
        "merge",
        "c",
        write(
          "partial.json",
          JSON.stringify({ concept: "c", vertices: [{ _key: oldKey, purpose: "adds one" }], edges: [] })
        ),
      ]).code,
      0
    );
    assert.equal(run(["apply", "c"]).code, 0);
    // alpha leaves c and reappears, same name, in d's folder
    fs.rmSync(path.join(tmp, "src/c/a.ts"));
    write("src/d/a.ts", ALPHA);
    assert.equal(run(["extract", "c"]).code, 0);
    assert.equal(run(["extract", "d"]).code, 0);
    assert.equal(run(["apply", "d"]).code, 0);
    const dKey = keyAt("d", "src/d/a.ts", "alpha");
    const r = run(["apply", "c"]);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /1 unmatched/);
    assert.doesNotMatch(r.stderr, /remapped/);
    assert.ok(enrichedKeys().includes(oldKey), "c's entry stays where it is");
    assert.ok(!enrichedKeys().includes(dKey), "no entry was moved onto d's vertex");
  });

  it("reports two orphans that want one vertex as ambiguous, and prune drops both only with --yes", () => {
    project();
    write("src/a2.ts", ALPHA.replace("x + 1", "x + 3"));
    assert.equal(run(["extract", "c"]).code, 0);
    const alphaA = keyAt("c", "src/a.ts", "alpha");
    const alphaA2 = keyAt("c", "src/a2.ts", "alpha");
    const betaKey = keyOf("beta");
    const partial = {
      concept: "c",
      vertices: [
        { _key: alphaA, purpose: "adds one" },
        { _key: alphaA2, purpose: "adds three" },
        { _key: betaKey, purpose: "doubles" },
      ],
      edges: [],
    };
    assert.equal(run(["enrich", "merge", "c", write("partial.json", JSON.stringify(partial))]).code, 0);
    assert.equal(run(["apply", "c"]).code, 0);
    // both alphas leave, one new alpha arrives: both orphans want the same vertex
    fs.rmSync(path.join(tmp, "src/a.ts"));
    fs.rmSync(path.join(tmp, "src/a2.ts"));
    write("src/new.ts", ALPHA);
    assert.equal(run(["extract", "c"]).code, 0);
    const before = fs.readFileSync(path.join(tmp, ENRICHED), "utf8");
    const r = run(["apply", "c"]);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /2 ambiguous/);
    assert.equal(r.stderr.trim().split("\n").length, 1);
    assert.equal(fs.readFileSync(path.join(tmp, ENRICHED), "utf8"), before);

    const dry = run(["enrich", "prune", "c"]);
    assert.match(dry.stdout, new RegExp(`${alphaA} alpha \\[ambiguous\\]`));
    assert.match(dry.stdout, new RegExp(`${alphaA2} alpha \\[ambiguous\\]`));
    assert.equal(fs.readFileSync(path.join(tmp, ENRICHED), "utf8"), before);

    const yes = run(["enrich", "prune", "c", "--yes"]);
    assert.match(yes.stdout, /2 orphaned entries dropped/);
    assert.deepEqual(enrichedKeys(), [betaKey]);
    assert.equal(run(["apply", "c"]).stderr, "");
  });

  it("reports an entry whose key the store never saw as unmatched, and prune names it", () => {
    enrichedAndApplied();
    const ghost = "0".repeat(32);
    const doc = readJson(ENRICHED);
    doc.vertices.push({ _key: ghost, purpose: "ghost" });
    fs.writeFileSync(path.join(tmp, ENRICHED), JSON.stringify(doc, null, 2));
    const r = run(["apply", "c"]);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /1 unmatched/);
    assert.equal(r.stderr.trim().split("\n").length, 1);
    const json = JSON.parse(run(["enrich", "prune", "c", "--json"]).stdout);
    assert.equal(json.dryRun, true);
    assert.equal(json.dropped, false);
    assert.deepEqual(json.orphans, [{ key: ghost, reason: "unmatched", name: null, purpose: "ghost" }]);
    assert.equal(enrichedKeys().includes(ghost), true);
  });

  it("apply --defer-renames still persists the remap and touches nothing else in the store", () => {
    enrichedAndApplied();
    const oldKey = keyOf("alpha");
    fs.rmSync(path.join(tmp, "src/a.ts"));
    write("src/moved/a.ts", ALPHA);
    // a same-file rename gives drift a rename candidate, which makes apply defer the concept
    write("src/b.ts", BETA.replace("function beta", "function betaX"));
    assert.equal(run(["extract", "c"]).code, 0);
    const newKey = keyOf("alpha");
    const r = run(["apply", "c", "--defer-renames"]);
    assert.equal(r.code, 10);
    assert.match(r.stderr, /1 remapped onto moved vertices/);
    assert.ok(enrichedKeys().includes(newKey), "the entry follows the moved vertex");
    assert.ok(!enrichedKeys().includes(oldKey));
    assert.equal(storeDoc(oldKey).status, "live", "the deferred apply wrote nothing to the store");
  });
});

describe("planOrphans", () => {
  const v = (key: string, name: string, hash: string) =>
    ({ _key: key, name, type: "function", contentHash: hash }) as any;
  const doc = (...keys: string[]) => ({ concept: "c", vertices: keys.map((k) => ({ _key: k })), edges: [] });
  const ast = (...vs: any[]) => ({ concept: "c", vertices: vs, edges: [] }) as any;

  it("falls back to contentHash when the name changed, and only when exactly one vertex has it", () => {
    const id = () => ({ name: "old", type: "function", contentHash: "h" }) as any;
    assert.deepEqual(planOrphans(ast(v("n1", "new", "h")), doc("o"), id).remapped, [{ from: "o", to: "n1" }]);
    const two = planOrphans(ast(v("n1", "p", "h"), v("n2", "q", "h")), doc("o"), id);
    assert.deepEqual(two.ambiguous, ["o"]);
  });

  it("leaves two orphans that want the same vertex ambiguous", () => {
    const id = () => ({ name: "a", type: "function", contentHash: "h" }) as any;
    const plan = planOrphans(ast(v("n1", "a", "h")), doc("o1", "o2"), id);
    assert.deepEqual(plan.remapped, []);
    assert.deepEqual(plan.ambiguous.sort(), ["o1", "o2"]);
  });

  it("does not claim a vertex that already has an entry", () => {
    const id = () => ({ name: "a", type: "function", contentHash: "h" }) as any;
    const plan = planOrphans(ast(v("n1", "a", "h")), doc("o", "n1"), id);
    assert.deepEqual(plan.unmatched, ["o"]);
  });
});
