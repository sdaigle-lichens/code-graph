// Source changes nobody has extracted yet: `skills status` and `drift` see an edited, a new and a removed
// file under a concept's globs before any `extract`. The built CLI is spawned against temp projects.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { diffFileHashes, scanConceptFiles, unextractedChanges } from "./unextracted.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, "../..");
const DIST = path.join(PKG, "dist/cli.js");

let tmp: string;

beforeEach(() => {
  assert.ok(fs.existsSync(DIST), `${DIST} is missing — run \`pnpm build\` from the repository root first`);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cg-unextracted-"));
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

const A = "export function alpha(x: number): number {\n  return x + 1;\n}\n";
const B = "import { alpha } from './a';\nexport function beta(x: number): number {\n  return alpha(x) * 2;\n}\n";

function project() {
  execFileSync("git", ["-C", tmp, "init", "-q"]);
  write(
    "scribe.config.json",
    JSON.stringify({ project: "p", tsconfig: "tsconfig.json", concepts: { c: { globs: ["src/**/*.ts"] } } })
  );
  write("tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext" }, include: ["src"] }));
  write(".gitignore", "node_modules\nscribe-output\n");
  write("src/a.ts", A);
  write("src/b.ts", B);
  fs.symlinkSync(path.join(PKG, "node_modules"), path.join(tmp, "node_modules"), "dir");
  assert.equal(run(["extract", "c"]).code, 0);
  assert.equal(run(["bootstrap"]).code, 0);
  assert.equal(run(["apply", "c"]).code, 0);
}

const status = () =>
  JSON.parse(run(["skills", "status", "--json", "--root", tmp]).stdout).concepts.find((x: any) => x.concept === "c");
const drift = () => JSON.parse(run(["drift", "c", "--json"]).stdout);

describe("unextracted changes (end to end)", () => {
  it("a freshly extracted concept reports nothing unextracted, in status and drift", () => {
    project();
    const u = status().unextracted;
    assert.deepEqual([u.changed, u.new, u.removed, u.files.length], [0, 0, 0, 0]);
    const d = drift().unextracted;
    assert.deepEqual([d.changed, d.new, d.removed], [0, 0, 0]);
    assert.doesNotMatch(run(["skills", "status", "--root", tmp]).stdout, /unextracted/);
  });

  it("an edited file counts as changed while graph.changed stays 0", () => {
    project();
    write("src/a.ts", A.replace("x + 1", "x + 2"));
    const s = status();
    assert.equal(s.graph.changed, 0, "vertex-level changed only sees extracted drift");
    assert.deepEqual([s.unextracted.changed, s.unextracted.new, s.unextracted.removed], [1, 0, 0]);
    assert.deepEqual(s.unextracted.files, [{ path: "src/a.ts", kind: "changed" }]);
    assert.match(run(["skills", "status", "--root", tmp]).stdout, /unextracted: 1 changed, 0 new, 0 removed file\(s\)/);
    const d = drift();
    assert.equal(d.unextracted.changed, 1);
    assert.equal(d.changed.length, 0);
    const text = run(["drift", "c"]).stdout;
    assert.match(text, /unextracted: 1 changed/);
    assert.match(text, /src\/a\.ts/);
  });

  it("a new matching file counts as new; a non-matching or non-code file does not", () => {
    project();
    write("src/c.ts", "export const c = 1;\n");
    write("src/readme.md", "# not code\n");
    write("other/d.ts", "export const d = 1;\n");
    const u = status().unextracted;
    assert.deepEqual([u.changed, u.new, u.removed], [0, 1, 0]);
    assert.deepEqual(u.files, [{ path: "src/c.ts", kind: "new" }]);
  });

  it("a deleted file counts as removed", () => {
    project();
    fs.rmSync(path.join(tmp, "src/b.ts"));
    const u = status().unextracted;
    assert.deepEqual([u.changed, u.new, u.removed], [0, 0, 1]);
    assert.equal(drift().unextracted.removed, 1);
  });

  it("extract folds every kind of change in; a comment-only edit clears after extract", () => {
    project();
    write("src/a.ts", "// note\n" + A);
    write("src/c.ts", "export const c = 1;\n");
    fs.rmSync(path.join(tmp, "src/b.ts"));
    assert.equal(status().unextracted.files.length, 3);
    assert.equal(run(["extract", "c"]).code, 0);
    assert.equal(status().unextracted.files.length, 0);
    assert.equal(drift().unextracted.files.length, 0);
  });

  it("an ast.json from before meta.files reports no unextracted block until the next extract", () => {
    project();
    const p = path.join(tmp, "scribe-output/c.ast.json");
    const ast = JSON.parse(fs.readFileSync(p, "utf8"));
    delete ast.meta.files;
    fs.writeFileSync(p, JSON.stringify(ast, null, 2));
    assert.equal("unextracted" in status(), false);
    assert.equal(drift().unextracted, null);
    assert.equal(run(["extract", "c"]).code, 0);
    assert.equal(status().unextracted.files.length, 0);
  });

  it("re-extracting unchanged code keeps ast.json byte-identical, meta.files included", () => {
    project();
    const p = path.join(tmp, "scribe-output/c.ast.json");
    const first = fs.readFileSync(p, "utf8");
    assert.ok(Object.keys(JSON.parse(first).meta.files).length === 2);
    run(["extract", "c"]);
    assert.equal(fs.readFileSync(p, "utf8"), first);
  });
});

describe("unextracted helpers", () => {
  it("diffFileHashes sorts and classifies", () => {
    const d = diffFileHashes({ "a.ts": "1", "b.ts": "2", "gone.ts": "3" }, { "a.ts": "1", "b.ts": "9", "z.ts": "4" });
    assert.deepEqual(d.files, [
      { path: "b.ts", kind: "changed" },
      { path: "gone.ts", kind: "removed" },
      { path: "z.ts", kind: "new" },
    ]);
    assert.deepEqual([d.changed, d.new, d.removed], [1, 1, 1]);
  });

  it("scanConceptFiles skips node_modules, dist and scribe-output, and honours dot dirs in the glob", () => {
    write("src/a.ts", A);
    write("src/node_modules/x/i.ts", "export {};\n");
    write("src/dist/o.ts", "export {};\n");
    write(".hidden/h.ts", "export {};\n");
    assert.deepEqual(Object.keys(scanConceptFiles(tmp, ["src/**"])), ["src/a.ts"]);
    assert.deepEqual(Object.keys(scanConceptFiles(tmp, [".hidden/**/*.ts"])), [".hidden/h.ts"]);
  });

  it("unextractedChanges is null without an ast.json", () => {
    assert.equal(unextractedChanges(tmp, "nope", ["src/**"]), null);
  });
});
