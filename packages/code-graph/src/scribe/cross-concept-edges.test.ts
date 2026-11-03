// Cross-concept edges recorded at extract time. The built CLI (dist/cli.js) is spawned against temp
// projects; nothing is stubbed.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, "../..");
const DIST = path.join(PKG, "dist/cli.js");

let tmp: string;

beforeEach(() => {
  assert.ok(fs.existsSync(DIST), `${DIST} is missing — run \`pnpm build\` from the repository root first`);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cg-crossedge-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function run(args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.NODE_OPTIONS;
  const r = spawnSync(process.execPath, [DIST, ...args], { encoding: "utf8", env, cwd: tmp });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

function write(rel: string, content: string): void {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LIB =
  "export function inner(): number {\n  return 1;\n}\nexport function moveTask(): number {\n  return inner();\n}\n";
const UI = "import { moveTask } from '../lib/store';\nexport function useDrag(): number {\n  return moveTask();\n}\n";
const UI2 =
  "import { moveTask } from '../lib/store';\nexport function notifyOverdue(): number {\n  return moveTask();\n}\n";

type Concepts = Record<string, { globs: string[] }>;

function project(concepts: Concepts, libSrc = LIB): void {
  write("scribe.config.json", JSON.stringify({ project: "p", tsconfig: "tsconfig.json", concepts }));
  write(
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", strict: true }, include: ["src"] })
  );
  write("src/lib/store.ts", libSrc);
  write("src/ui/drag.ts", UI);
  write("src/ui2/overdue.ts", UI2);
  fs.symlinkSync(path.join(PKG, "node_modules"), path.join(tmp, "node_modules"), "dir");
}

const TWO: Concepts = { ui: { globs: ["src/ui/**/*.ts"] }, lib: { globs: ["src/lib/**/*.ts"] } };

const ast = (c: string) => JSON.parse(fs.readFileSync(path.join(tmp, `scribe-output/${c}.ast.json`), "utf8"));
const vkey = (c: string, name: string) => ast(c).vertices.find((v: any) => v.name === name)._key;

function dbRows(sql: string): any[] {
  const db = new DatabaseSync(path.join(tmp, "scribe-output/graph.db"));
  try {
    return db.prepare(sql).all() as any[];
  } finally {
    db.close();
  }
}

describe("cross-concept edges at extract time", () => {
  it("emits crosses_concept true to the other concept's vertex key, with the target never extracted", () => {
    project(TWO);
    assert.equal(run(["extract", "ui"]).code, 0);
    assert.equal(fs.existsSync(path.join(tmp, "scribe-output/lib.ast.json")), false, "lib was not extracted");
    const a = ast("ui");
    const cross = a.edges.filter((e: any) => e.crosses_concept === true);
    assert.equal(cross.length, 1);
    assert.equal(cross[0].type, "calls");
    assert.equal(cross[0].concept, "ui");
    assert.equal(cross[0]._from, `vertices/${vkey("ui", "useDrag")}`);

    // Same key once lib is extracted.
    assert.equal(run(["extract", "lib"]).code, 0);
    assert.equal(cross[0]._to, `vertices/${vkey("lib", "moveTask")}`);
    for (const e of ast("lib").edges) assert.equal(e.crosses_concept, false, "in-concept edges stay local");
  });

  it("keeps crosses_concept true in the store when the target concept is not applied yet, and queries hide the edge", () => {
    project(TWO);
    run(["extract", "ui"]);
    run(["bootstrap"]);
    assert.equal(run(["apply", "ui"]).code, 0);
    const rows = dbRows("SELECT crosses_concept AS c, to_key FROM edges WHERE concept = 'ui'");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].c, 1);
    assert.equal(dbRows(`SELECT 1 FROM vertices WHERE key = '${rows[0].to_key}'`).length, 0, "dangling _to");

    const concept = run(["query", "concept", "ui", "--json"]);
    assert.equal(concept.code, 0, concept.stderr);
    assert.equal(JSON.parse(concept.stdout).edges.length, 0, "dangling cross edge hidden");
    assert.equal(run(["query", "impact", "useDrag", "--direction", "out"]).code, 0);
    assert.equal(run(["query", "file", "src/ui/drag.ts"]).code, 0);
    assert.equal(run(["query", "vertex", "useDrag"]).code, 0);

    // Applying the target makes the caller visible.
    run(["extract", "lib"]);
    assert.equal(run(["apply", "lib"]).code, 0);
    const imp = run(["query", "impact", "moveTask", "--direction", "in"]);
    assert.equal(imp.code, 0, imp.stderr);
    assert.match(imp.stdout, /useDrag/);
    assert.equal(JSON.parse(run(["query", "concept", "ui", "--json"]).stdout).edges.length, 1);
  });

  it("impact --direction in and query cross work on a fresh extract + apply with several callers", () => {
    project({ ...TWO, ui2: { globs: ["src/ui2/**/*.ts"] } });
    for (const c of ["ui", "ui2", "lib"]) assert.equal(run(["extract", c]).code, 0);
    run(["bootstrap"]);
    for (const c of ["ui", "ui2", "lib"]) assert.equal(run(["apply", c]).code, 0);

    const imp = run(["query", "impact", "moveTask", "--direction", "in"]);
    assert.equal(imp.code, 0, imp.stderr);
    assert.match(imp.stdout, /useDrag/);
    assert.match(imp.stdout, /notifyOverdue/);

    const cross = run(["query", "cross", "ui", "lib"]);
    assert.equal(cross.code, 0, cross.stderr);
    assert.match(cross.stdout, /useDrag/);
    assert.doesNotMatch(cross.stdout, /notifyOverdue/);
    const rev = run(["query", "cross", "lib", "ui2"]);
    assert.equal(rev.code, 0);
    assert.match(rev.stdout, /notifyOverdue/);
  });

  it("in-concept impact is unchanged by the foreign resolver", () => {
    project(TWO);
    for (const c of ["ui", "lib"]) run(["extract", c]);
    run(["bootstrap"]);
    for (const c of ["ui", "lib"]) run(["apply", c]);
    const out = run(["query", "impact", "moveTask", "--direction", "out"]);
    assert.equal(out.code, 0);
    assert.match(out.stdout, /Direct callees/);
    assert.match(out.stdout, /`inner`/);
    assert.doesNotMatch(out.stdout, /useDrag/);
    // the in-concept edge in lib's ast.json is local and single
    const edges = ast("lib").edges;
    assert.equal(edges.length, 1);
    assert.equal(edges[0].crosses_concept, false);
  });

  it("a file matched by several other concepts resolves to the first in config order", () => {
    // ui is extracted; a and b both match src/lib; order decides.
    project({ ui: TWO.ui, a: { globs: ["src/lib/**/*.ts"] }, b: { globs: ["src/lib/**/*.ts"] } });
    run(["extract", "ui"]);
    run(["extract", "a"]);
    run(["extract", "b"]);
    const to = ast("ui").edges.find((e: any) => e.crosses_concept)._to;
    assert.equal(to, `vertices/${vkey("a", "moveTask")}`);
    assert.notEqual(to, `vertices/${vkey("b", "moveTask")}`);

    // Reverse the order: b now wins.
    fs.rmSync(path.join(tmp, "scribe-output"), { recursive: true, force: true });
    write(
      "scribe.config.json",
      JSON.stringify({
        project: "p",
        tsconfig: "tsconfig.json",
        concepts: { ui: TWO.ui, b: { globs: ["src/lib/**/*.ts"] }, a: { globs: ["src/lib/**/*.ts"] } },
      })
    );
    run(["extract", "ui"]);
    run(["extract", "b"]);
    assert.equal(ast("ui").edges.find((e: any) => e.crosses_concept)._to, `vertices/${vkey("b", "moveTask")}`);
  });

  it("the concept being extracted wins locally for a file it matches itself", () => {
    // ui also globs src/lib; lib (a different concept) matches it too. Extracting ui keeps the edge local.
    project({ ui: { globs: ["src/ui/**/*.ts", "src/lib/**/*.ts"] }, lib: TWO.lib });
    run(["extract", "ui"]);
    const a = ast("ui");
    assert.equal(
      a.edges.some((e: any) => e.crosses_concept),
      false
    );
    assert.ok(a.edges.some((e: any) => e._to === `vertices/${vkey("ui", "moveTask")}`));
  });

  it("a call to a foreign file no concept owns emits no edge", () => {
    project({ ui: TWO.ui });
    run(["extract", "ui"]);
    assert.equal(ast("ui").edges.length, 0);
  });

  it("an archived target is hidden from impact, cross, concept and file queries without crashing", () => {
    project({ ...TWO });
    for (const c of ["ui", "lib"]) run(["extract", c]);
    run(["bootstrap"]);
    for (const c of ["ui", "lib"]) run(["apply", c]);
    assert.equal(run(["query", "cross", "ui", "lib"]).code, 0);

    // moveTask disappears from lib; apply archives it; ui still holds the (now dangling) edge.
    write("src/lib/store.ts", "export function inner(): number {\n  return 1;\n}\n");
    run(["extract", "lib"]);
    assert.equal(run(["apply", "lib"]).code, 0);
    const archived = dbRows("SELECT doc FROM vertices WHERE concept = 'lib'")
      .map((r) => JSON.parse(r.doc))
      .find((v) => v.name === "moveTask");
    assert.equal(archived.status, "archived");

    assert.equal(JSON.parse(run(["query", "concept", "ui", "--json"]).stdout).edges.length, 0);
    const cross = run(["query", "cross", "ui", "lib"]);
    assert.doesNotMatch(cross.stdout, /moveTask/);
    assert.equal(run(["query", "file", "src/ui/drag.ts"]).code, 0);
    const v = run(["query", "impact", "useDrag", "--direction", "out"]);
    assert.equal(v.code, 0, v.stderr);
    assert.doesNotMatch(v.stdout, /moveTask/);
  });

  it("re-extract of unchanged code with cross edges is byte-stable", async () => {
    project(TWO);
    assert.equal(run(["extract", "ui"]).code, 0);
    const p = path.join(tmp, "scribe-output/ui.ast.json");
    const first = fs.readFileSync(p, "utf8");
    await sleep(1100);
    assert.equal(run(["extract", "ui"]).code, 0);
    assert.equal(fs.readFileSync(p, "utf8"), first);
  });
});
