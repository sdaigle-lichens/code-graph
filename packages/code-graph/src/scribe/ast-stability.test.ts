// Byte-stable .ast.json across re-extracts, the real version in meta, and the version-drift check.
// The built CLI (dist/cli.js) is spawned against temp projects; nothing is stubbed.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, "../..");
const REPO = path.resolve(PKG, "../..");
const DIST = path.join(PKG, "dist/cli.js");

let tmp: string;

beforeEach(() => {
  assert.ok(fs.existsSync(DIST), `${DIST} is missing — run \`pnpm build\` from the repository root first`);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cg-aststable-"));
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const A_SRC = "export function alpha(x: number): number {\n  return x + 1;\n}\n";
const B_SRC = "import { alpha } from './a';\nexport function beta(x: number): number {\n  return alpha(x) * 2;\n}\n";

function tsProject() {
  write(
    "scribe.config.json",
    JSON.stringify({ project: "p", tsconfig: "tsconfig.json", concepts: { c: { globs: ["src/**/*.ts"] } } })
  );
  write(
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", strict: true }, include: ["src"] })
  );
  write("src/a.ts", A_SRC);
  write("src/b.ts", B_SRC);
  fs.symlinkSync(path.join(PKG, "node_modules"), path.join(tmp, "node_modules"), "dir");
}

const astPath = () => path.join(tmp, "scribe-output/c.ast.json");
const readAst = () => fs.readFileSync(astPath(), "utf8");

describe("ast.json is byte-stable across re-extracts", () => {
  it("an unchanged concept re-extracts to a byte-identical file, even across a clock tick", async () => {
    tsProject();
    assert.equal(run(["extract", "c"]).code, 0);
    const first = readAst();
    await sleep(1100);
    assert.equal(run(["extract", "c"]).code, 0);
    assert.equal(readAst(), first);

    const ast = JSON.parse(first);
    assert.ok(ast.vertices.length >= 2 && ast.edges.length >= 1, "fixture has vertices and edges");
    for (const v of ast.vertices) {
      assert.equal("extracted_at" in v.ast, false, "vertex ast carries no timestamp");
      assert.equal("extractor_version" in v.ast, false, "version lives in meta only");
    }
    assert.match(ast.meta.extractor_version, /^code-graph@\d+\.\d+\.\d+/);
    for (const e of ast.edges) assert.deepEqual(e.ast, {});
    assert.equal(typeof ast.meta.extracted_at, "string");
  });

  it("meta.extractor_version is the real package version, not a placeholder", () => {
    tsProject();
    run(["extract", "c"]);
    const ast = JSON.parse(readAst());
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8"));
    assert.equal(ast.meta.extractor_version, `code-graph@${pkg.version}`);
    assert.notEqual(pkg.version, "0.1.0");
    assert.equal(run(["--version"]).stdout.trim(), pkg.version);
  });

  it("changing one file changes only its vertices/edges and bumps meta.extracted_at", async () => {
    tsProject();
    run(["extract", "c"]);
    const before = JSON.parse(readAst());
    await sleep(1100);
    write("src/a.ts", "export function alpha(x: number): number {\n  return x + 5;\n}\n");
    assert.equal(run(["extract", "c"]).code, 0);
    const after = JSON.parse(readAst());

    assert.notEqual(after.meta.extracted_at, before.meta.extracted_at);
    assert.equal(after.meta.extractor_version, before.meta.extractor_version);

    const byKey = (xs: any[]) => new Map(xs.map((x) => [x._key, x]));
    const bv = byKey(before.vertices);
    const av = byKey(after.vertices);
    assert.deepEqual([...av.keys()], [...bv.keys()]);
    const changed = [...av.keys()].filter((k) => JSON.stringify(av.get(k)) !== JSON.stringify(bv.get(k)));
    assert.equal(changed.length, 1);
    assert.equal(av.get(changed[0]).name, "alpha");
    assert.notEqual(av.get(changed[0]).contentHash, bv.get(changed[0]).contentHash);
    assert.deepEqual(after.edges, before.edges, "no edge changed");
  });

  it("recovers from an unparseable or missing previous ast.json", () => {
    tsProject();
    assert.equal(fs.existsSync(astPath()), false);
    assert.equal(run(["extract", "c"]).code, 0, "no previous file");
    const good = readAst();
    fs.writeFileSync(astPath(), "{ not json");
    assert.equal(run(["extract", "c"]).code, 0);
    const ast = JSON.parse(readAst());
    assert.equal(ast.vertices.length, JSON.parse(good).vertices.length);
    assert.equal(typeof ast.meta.extracted_at, "string");
  });

  it("an older ast.json with per-vertex extracted_at is rewritten cleanly", () => {
    tsProject();
    run(["extract", "c"]);
    const old = JSON.parse(readAst());
    for (const v of old.vertices) v.ast.extracted_at = "2020-01-01T00:00:00.000Z";
    fs.writeFileSync(astPath(), JSON.stringify(old, null, 2));
    assert.equal(run(["extract", "c"]).code, 0);
    const now = JSON.parse(readAst());
    for (const v of now.vertices) assert.equal("extracted_at" in v.ast, false);
  });

  it("a plugin upgrade with no content change leaves the file byte-identical (old meta version kept)", async () => {
    tsProject();
    run(["extract", "c"]);
    // Fake a file last written by an older release.
    const old = JSON.parse(readAst());
    old.meta.extractor_version = "code-graph@0.0.1";
    fs.writeFileSync(astPath(), JSON.stringify(old, null, 2));
    const faked = readAst();
    await sleep(1100);
    assert.equal(run(["extract", "c"]).code, 0);
    assert.equal(readAst(), faked);

    // A real content change records the current version and a new timestamp.
    write("src/a.ts", "export function alpha(x: number): number {\n  return x + 7;\n}\n");
    run(["extract", "c"]);
    const after = JSON.parse(readAst());
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8"));
    assert.equal(after.meta.extractor_version, `code-graph@${pkg.version}`);
    assert.notEqual(after.meta.extracted_at, old.meta.extracted_at);
  });

  it("apply stamps ast.extractor_version into store vertices from meta, and an older per-vertex file still applies", () => {
    tsProject();
    run(["extract", "c"]);
    const old = JSON.parse(readAst());
    old.meta.extractor_version = "code-graph@0.0.1";
    fs.writeFileSync(astPath(), JSON.stringify(old, null, 2));
    run(["bootstrap"]);
    assert.equal(run(["apply", "c"]).code, 0);
    const versions = () => {
      const db = new DatabaseSync(path.join(tmp, "scribe-output/graph.db"));
      try {
        const rows = db.prepare("SELECT doc FROM vertices WHERE concept = 'c'").all() as { doc: string }[];
        return rows.map((r) => JSON.parse(r.doc).ast.extractor_version);
      } finally {
        db.close();
      }
    };
    assert.deepEqual([...new Set(versions())], ["code-graph@0.0.1"]);

    // legacy shape: per-vertex version and timestamp
    for (const v of old.vertices) {
      v.ast.extractor_version = "code-graph@0.0.2";
      v.ast.extracted_at = "2020-01-01T00:00:00.000Z";
    }
    fs.writeFileSync(astPath(), JSON.stringify(old, null, 2));
    assert.equal(run(["apply", "c"]).code, 0);
  });

  it("a legacy file with per-vertex extractor_version is rewritten once, then stays byte-identical", async () => {
    tsProject();
    run(["extract", "c"]);
    const old = JSON.parse(readAst());
    for (const v of old.vertices) v.ast.extractor_version = "code-graph@0.0.1";
    fs.writeFileSync(astPath(), JSON.stringify(old, null, 2));
    await sleep(1100);
    assert.equal(run(["extract", "c"]).code, 0);
    const rewritten = readAst();
    for (const v of JSON.parse(rewritten).vertices) assert.equal("extractor_version" in v.ast, false);
    await sleep(1100);
    run(["extract", "c"]);
    assert.equal(readAst(), rewritten);
  });

  it("a previous file lacking meta.extractor_version is treated as changed", () => {
    tsProject();
    run(["extract", "c"]);
    const old = JSON.parse(readAst());
    delete old.meta.extractor_version;
    fs.writeFileSync(astPath(), JSON.stringify(old, null, 2));
    run(["extract", "c"]);
    assert.match(JSON.parse(readAst()).meta.extractor_version, /^code-graph@/);
  });

  it("a docs-only concept re-extracts byte-identically", async () => {
    write(
      "scribe.config.json",
      JSON.stringify({ project: "p", concepts: { guide: { globs: ["docs/**/*.md"], skill: "docs/SKILL.md" } } })
    );
    write("docs/SKILL.md", "---\nname: guide\n---\n\nbody\n");
    assert.equal(run(["extract", "guide"]).code, 0);
    const p = path.join(tmp, "scribe-output/guide.ast.json");
    const first = fs.readFileSync(p, "utf8");
    await sleep(1100);
    assert.equal(run(["extract", "guide"]).code, 0);
    assert.equal(fs.readFileSync(p, "utf8"), first);
  });

  it("a skill-only change rewrites the file and advances meta.extracted_at", async () => {
    write(
      "scribe.config.json",
      JSON.stringify({ project: "p", concepts: { guide: { globs: ["docs/**/*.md"], skill: "docs/SKILL.md" } } })
    );
    write("docs/SKILL.md", "---\nname: guide\n---\n\nbody\n");
    assert.equal(run(["extract", "guide"]).code, 0);
    const p = path.join(tmp, "scribe-output/guide.ast.json");
    const before = JSON.parse(fs.readFileSync(p, "utf8"));
    await sleep(1100);
    write("docs/SKILL.md", "---\nname: guide\n---\n\nchanged body\n");
    assert.equal(run(["extract", "guide"]).code, 0);
    const after = JSON.parse(fs.readFileSync(p, "utf8"));
    assert.deepEqual(after.vertices, before.vertices);
    assert.deepEqual(after.edges, before.edges);
    assert.notDeepEqual(after.skill, before.skill);
    assert.notEqual(after.meta.extracted_at, before.meta.extracted_at);
  });

  it("an edge-only change (same vertices) advances meta.extracted_at", async () => {
    const { writeAstOutput } = await import(path.join(PKG, "dist/scribe/ast-output.js"));
    const config: any = { configRoot: tmp };
    const v = (name: string) => ({
      _key: `c/src/a.ts:${name}`,
      name,
      status: "live",
      ast: {},
      agent: { authored_by: null, stale: false },
    });
    const vertices = [v("one"), v("two")];
    const edge = { _from: "c/src/a.ts:one", _to: "c/src/a.ts:two", type: "calls", ast: {} };
    writeAstOutput(config, "e", vertices as any, [edge] as any, undefined);
    const p = path.join(tmp, "scribe-output/e.ast.json");
    const before = JSON.parse(fs.readFileSync(p, "utf8"));

    await sleep(1100);
    writeAstOutput(config, "e", vertices as any, [edge] as any, undefined);
    assert.equal(JSON.parse(fs.readFileSync(p, "utf8")).meta.extracted_at, before.meta.extracted_at, "unchanged");

    await sleep(1100);
    writeAstOutput(config, "e", vertices as any, [] as any, undefined);
    const after = JSON.parse(fs.readFileSync(p, "utf8"));
    assert.deepEqual(after.vertices, before.vertices);
    assert.equal(after.edges.length, 0);
    assert.notEqual(after.meta.extracted_at, before.meta.extracted_at);
  });
});

describe("apply stamps extracted_at into the store; skills status freshness still reports", () => {
  it("graph.extractedAt is a timestamp after apply, and changed counts follow a re-extract", () => {
    execFileSync("git", ["-C", tmp, "init", "-q"]);
    tsProject();
    write(".gitignore", "node_modules\nscribe-output\n");
    assert.equal(run(["extract", "c"]).code, 0);
    run(["bootstrap"]);
    assert.equal(run(["apply", "c"]).code, 0);

    const status = () =>
      JSON.parse(run(["skills", "status", "--json", "--root", tmp]).stdout).concepts.find(
        (x: any) => x.concept === "c"
      );
    const g = status().graph;
    assert.equal(g.extracted, true);
    assert.ok(!Number.isNaN(Date.parse(g.extractedAt)), `extractedAt parses: ${g.extractedAt}`);
    assert.equal(g.vertices, 2);
    assert.equal(g.changed, 0);
    assert.equal(g.stale, 0);

    // re-extract of unchanged source must not read as drift
    run(["extract", "c"]);
    assert.equal(status().graph.changed, 0);

    write("src/a.ts", "export function alpha(x: number): number {\n  return x + 9;\n}\n");
    run(["extract", "c"]);
    assert.equal(status().graph.changed, 1);
    assert.equal(run(["apply", "c"]).code, 0);
    assert.equal(status().graph.changed, 0);
  });
});

describe("check-versions: published version strings must match", () => {
  const script = path.join(PKG, "scripts/check-versions.mjs");

  /** Lay out a fake repo (script + the three json files) so the script resolves its own root there. */
  function fakeRepo(versions: { pkg: string; plugin: string; market: string }) {
    const dest = path.join(tmp, "repo/packages/code-graph/scripts");
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(script, path.join(dest, "check-versions.mjs"));
    write("repo/packages/code-graph/package.json", JSON.stringify({ version: versions.pkg }));
    write("repo/plugin/.claude-plugin/plugin.json", JSON.stringify({ version: versions.plugin }));
    write(
      "repo/.claude-plugin/marketplace.json",
      JSON.stringify({ plugins: [{ name: "x", version: versions.market }] })
    );
    return path.join(dest, "check-versions.mjs");
  }

  function check(file: string) {
    const r = spawnSync(process.execPath, [file], { encoding: "utf8" });
    return { code: r.status ?? -1, stderr: r.stderr };
  }

  it("passes on the real repo (all three files agree)", () => {
    const r = check(script);
    assert.equal(r.code, 0, r.stderr);
    const v = (rel: string) => JSON.parse(fs.readFileSync(path.join(REPO, rel), "utf8"));
    assert.equal(v("plugin/.claude-plugin/plugin.json").version, v("packages/code-graph/package.json").version);
    assert.equal(
      v(".claude-plugin/marketplace.json").plugins[0].version,
      v("packages/code-graph/package.json").version
    );
  });

  it("passes when aligned and fails naming each file when any one differs", () => {
    assert.equal(check(fakeRepo({ pkg: "1.2.3", plugin: "1.2.3", market: "1.2.3" })).code, 0);
    for (const bad of [
      { pkg: "9.9.9", plugin: "1.2.3", market: "1.2.3" },
      { pkg: "1.2.3", plugin: "9.9.9", market: "1.2.3" },
      { pkg: "1.2.3", plugin: "1.2.3", market: "9.9.9" },
    ]) {
      const r = check(fakeRepo(bad));
      assert.equal(r.code, 1, JSON.stringify(bad));
      assert.match(r.stderr, /version drift/);
      assert.match(r.stderr, /package\.json/);
      assert.match(r.stderr, /plugin\.json/);
      assert.match(r.stderr, /marketplace\.json/);
    }
  });

  it("still runs when invoked through a symlinked path", () => {
    const file = fakeRepo({ pkg: "9.9.9", plugin: "1.2.3", market: "1.2.3" });
    const link = path.join(tmp, "link");
    fs.symlinkSync(path.join(tmp, "repo"), link, "dir");
    const r = check(path.join(link, path.relative(path.join(tmp, "repo"), file)));
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /version drift/);
  });

  it("does nothing when imported", () => {
    const file = fakeRepo({ pkg: "9.9.9", plugin: "1.2.3", market: "1.2.3" });
    const r = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(file).href)});`],
      { encoding: "utf8" }
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
  });
});
