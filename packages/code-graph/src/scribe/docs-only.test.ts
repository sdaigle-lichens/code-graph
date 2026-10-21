// Docs-only concepts and the freshness/drift JSON surfaces, end to end: the built CLI (dist/cli.js)
// is spawned against temp projects with a real SQLite store. Nothing is stubbed.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDocsOnly } from "./ast-output.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, "../..");
const DIST = path.join(PKG, "dist/cli.js");

let tmp: string;

beforeEach(() => {
  assert.ok(fs.existsSync(DIST), `${DIST} is missing — run \`pnpm build\` from the repository root first`);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cg-docsonly-"));
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

const SKILL = `---\nname: guide\ndescription: "x"\n---\n\n# Guide\n\nThe zebrafish migration runbook explains cutover.\n`;

function config(extra: Record<string, unknown> = {}, concepts: Record<string, unknown> = {}) {
  write(
    "scribe.config.json",
    JSON.stringify({
      project: "p",
      concepts: { guide: { globs: ["docs/**/*.md"], skill: "docs/SKILL.md" }, ...concepts },
      ...extra,
    })
  );
}

function git(...args: string[]): string {
  return execFileSync(
    "git",
    ["-C", tmp, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  ).trim();
}

describe("isDocsOnly", () => {
  const base = { project: "p", configRoot: "/x", concepts: {} as Record<string, any> };
  it("is true with no tsconfig, or when no glob names a TS/JS file; false otherwise", () => {
    const c = { globs: ["src/**/*.ts"] };
    assert.equal(isDocsOnly({ ...base, concepts: { a: c } } as any, "a"), true, "no tsconfig");
    assert.equal(isDocsOnly({ ...base, tsconfig: "t.json", concepts: { a: c } } as any, "a"), false);
    assert.equal(
      isDocsOnly({ ...base, tsconfig: "t.json", concepts: { a: { globs: ["docs/**/*.md"] } } } as any, "a"),
      true
    );
    assert.equal(
      isDocsOnly({ ...base, tsconfig: "t.json", concepts: { a: { globs: ["a/*.md", "b/*.tsx"] } } } as any, "a"),
      false
    );
    assert.equal(
      isDocsOnly({ ...base, tsconfig: "t.json", concepts: { a: { globs: ["a/*.{ts,tsx}"] } } } as any, "a"),
      false
    );
    assert.equal(isDocsOnly({ ...base, tsconfig: "t.json", concepts: {} } as any, "ghost"), false, "unknown concept");
    for (const g of ["src/**", "src/**/*", "packages/x/src"]) {
      assert.equal(
        isDocsOnly({ ...base, tsconfig: "t.json", concepts: { a: { globs: [g] } } } as any, "a"),
        false,
        `${g} with a tsconfig is a code concept`
      );
    }
  });
});

describe("docs-only extract / apply / search", () => {
  it("loads a config with no tsconfig, extracts 0 vertices + skill, applies a docs row, and search finds it", () => {
    config();
    write("docs/SKILL.md", SKILL);
    write("docs/a.md", "x");

    const ex = run(["extract", "guide"]);
    assert.equal(ex.code, 0, ex.stderr);
    assert.match(ex.stderr, /docs-only/);
    const ast = JSON.parse(fs.readFileSync(path.join(tmp, "scribe-output/guide.ast.json"), "utf8"));
    assert.equal(ast.concept, "guide");
    assert.deepEqual(ast.vertices, []);
    assert.deepEqual(ast.edges, []);
    assert.equal(ast.skill.path, "docs/SKILL.md");
    assert.equal(ast.skill.body, SKILL);
    assert.match(ast.skill.contentHash, /^sha256:[0-9a-f]{64}$/);

    run(["bootstrap"]);
    const ap = run(["apply", "guide"]);
    assert.equal(ap.code, 0, ap.stderr);

    const s = run(["search", "zebrafish", "--json"]);
    assert.equal(s.code, 0, s.stderr + s.stdout);
    assert.match(s.stdout, /zebrafish|guide/i);
    const parsed = JSON.parse(s.stdout);
    const clusters = parsed.clusters ?? parsed.results ?? [];
    assert.ok(JSON.stringify(parsed).includes("guide"), "the docs-only concept is returned");
    const guide = (Array.isArray(clusters) ? clusters : []).find(
      (c: any) => c.concept === "guide" || c.name === "guide"
    );
    if (guide) assert.deepEqual(guide.hits ?? guide.vertices ?? [], [], "an empty-hit cluster");
  });

  it("never reports a docs-only concept as a graph gap (search note, query concept exit code)", () => {
    config();
    write("docs/SKILL.md", SKILL);
    write("docs/a.md", "x");
    run(["extract", "guide"]);
    run(["bootstrap"]);
    assert.equal(run(["apply", "guide"]).code, 0);

    const s = run(["search", "zebrafish"]);
    assert.equal(s.code, 0, s.stderr + s.stdout);
    assert.match(s.stdout, /zebrafish/i);
    assert.doesNotMatch(s.stdout + s.stderr, /concepts enriched|un-applied|un-enriched/);

    // a docs-only concept with zero vertices must not exit 6 with a build diagnostic
    const q = run(["query", "concept", "guide"]);
    assert.notEqual(q.code, 6, q.stdout + q.stderr);
    assert.doesNotMatch(q.stdout + q.stderr, /un-applied|un-enriched|extract/);

    // an undeclared concept still exits 6 with the note
    const u = run(["query", "concept", "ghost"]);
    assert.equal(u.code, 6);
    assert.match(u.stderr, /not declared in scribe\.config\.json/);
  });

  it("resolves the SKILL.md from a marked skill named after the concept", () => {
    write("scribe.config.json", JSON.stringify({ project: "p", concepts: { guide: { globs: ["docs/**/*.md"] } } }));
    write(
      ".claude/skills/guide/SKILL.md",
      `---\nname: guide\nmetadata:\n  type: concept-skill\n  version: "1.0"\n  last-update: abc123\n---\n\nbody\n`
    );
    const ex = run(["extract", "guide"]);
    assert.equal(ex.code, 0, ex.stderr);
    const ast = JSON.parse(fs.readFileSync(path.join(tmp, "scribe-output/guide.ast.json"), "utf8"));
    assert.equal(ast.skill.path, ".claude/skills/guide/SKILL.md");
  });

  it("exits 1 with a clear message when no SKILL.md resolves", () => {
    config();
    const ex = run(["extract", "guide"]);
    // explicit-but-missing skill path surfaces as a read error, not success
    assert.equal(ex.code, 1);
    assert.ok(!fs.existsSync(path.join(tmp, "scribe-output/guide.ast.json")));

    write("scribe.config.json", JSON.stringify({ project: "p", concepts: { other: { globs: ["docs/**/*.md"] } } }));
    const ex2 = run(["extract", "other"]);
    assert.equal(ex2.code, 1);
    assert.match(ex2.stderr, /docs-only concept "other" has no SKILL\.md/);
  });
});

describe("drift --json / apply --dry-run --json", () => {
  const SHAPE = ["changed", "concept", "doc", "missing", "new", "renameCandidates", "stale", "unextracted"];

  function tsProject() {
    write(
      "scribe.config.json",
      JSON.stringify({ project: "p", tsconfig: "tsconfig.json", concepts: { c: { globs: ["src/**/*.ts"] } } })
    );
    write(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", strict: true }, include: ["src"] })
    );
    write("src/a.ts", "export function alpha(x: number): number {\n  return x + 1;\n}\n");
    fs.symlinkSync(path.join(PKG, "node_modules"), path.join(tmp, "node_modules"), "dir");
  }

  it("emits the documented shape, shows 'changed' after an edit + re-extract, and --json alone exits 1", () => {
    tsProject();
    assert.equal(run(["extract", "c"]).code, 0);
    run(["bootstrap"]);
    assert.equal(run(["apply", "c"]).code, 0);

    const clean = run(["drift", "c", "--json"]);
    assert.equal(clean.code, 0, clean.stderr);
    const d0 = JSON.parse(clean.stdout);
    assert.deepEqual(Object.keys(d0).sort(), SHAPE);
    assert.equal(d0.concept, "c");
    assert.deepEqual(d0.changed, []);
    assert.deepEqual(d0.new, []);
    assert.deepEqual(d0.missing, []);
    assert.deepEqual(d0.renameCandidates, []);
    assert.equal(typeof d0.doc.bodyHashChanged, "boolean");

    write("src/a.ts", "export function alpha(x: number): number {\n  return x + 2;\n}\n");
    assert.equal(run(["extract", "c"]).code, 0);
    for (const args of [
      ["drift", "c", "--json"],
      ["apply", "c", "--dry-run", "--json"],
    ]) {
      const r = run(args);
      assert.equal(r.code, 0, r.stderr);
      const d = JSON.parse(r.stdout.trim());
      assert.deepEqual(Object.keys(d).sort(), SHAPE);
      assert.deepEqual(d.changed, [{ name: "alpha", type: "function", file: "src/a.ts" }]);
      assert.deepEqual(d.new, []);
    }

    const bad = run(["apply", "c", "--json"]);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /--json needs --dry-run/);
  });

  it("reports a new vertex and a missing one by {name,type,file}", () => {
    tsProject();
    run(["extract", "c"]);
    run(["bootstrap"]);
    run(["apply", "c"]);
    write(
      "src/a.ts",
      'export function beta(x: number): number {\n  return x * 3 + 7;\n}\nexport function gamma(): string {\n  return "g";\n}\n'
    );
    run(["extract", "c"]);
    const d = JSON.parse(run(["drift", "c", "--json"]).stdout.trim());
    const refs = [...d.new, ...d.missing];
    for (const r of refs) assert.deepEqual(Object.keys(r).sort(), ["file", "name", "type"]);
    assert.ok(d.new.some((v: any) => v.name === "gamma"));
    assert.ok(d.missing.some((v: any) => v.name === "alpha") || d.renameCandidates.length > 0);
  });
});

describe("skills status: graph freshness and unknown freshness", () => {
  function gitProject() {
    git("init", "-q");
    config({}, {});
    write("docs/SKILL.md", SKILL);
    write("docs/a.md", "x");
  }

  it("has no `graph` key without a store, and adds none for a docs-only concept (no live vertices)", () => {
    gitProject();
    git("add", "-A");
    git("commit", "-q", "-m", "one");
    const before = JSON.parse(run(["skills", "status", "--json", "--root", tmp]).stdout);
    for (const c of before.concepts) assert.equal("graph" in c, false);

    run(["extract", "guide"]);
    run(["bootstrap"]);
    assert.equal(run(["apply", "guide"]).code, 0);
    const after = JSON.parse(run(["skills", "status", "--json", "--root", tmp]).stdout);
    const guide = after.concepts.find((c: any) => c.concept === "guide");
    assert.ok(guide);
    assert.equal("graph" in guide, false, "docs-only concept keeps its git window");
  });

  it("includes per-concept graph freshness when graph.db exists and the concept has live vertices", () => {
    git("init", "-q");
    write(
      "scribe.config.json",
      JSON.stringify({ project: "p", tsconfig: "tsconfig.json", concepts: { c: { globs: ["src/**/*.ts"] } } })
    );
    write(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext" }, include: ["src"] })
    );
    write("src/a.ts", "export function alpha(x: number): number {\n  return x + 1;\n}\n");
    fs.symlinkSync(path.join(PKG, "node_modules"), path.join(tmp, "node_modules"), "dir");
    write(".gitignore", "node_modules\nscribe-output\n");

    const noStore = JSON.parse(run(["skills", "status", "--json", "--root", tmp]).stdout);
    assert.equal("graph" in noStore.concepts[0], false);

    assert.equal(run(["extract", "c"]).code, 0);
    run(["bootstrap"]);
    assert.equal(run(["apply", "c"]).code, 0);

    const r = run(["skills", "status", "--json", "--root", tmp]);
    assert.equal(r.code, 0, r.stderr);
    const c = JSON.parse(r.stdout).concepts.find((x: any) => x.concept === "c");
    assert.equal(c.graph.extracted, true);
    assert.equal(typeof c.graph.extractedAt, "string");
    assert.equal(c.graph.enriched, false);
    assert.equal(c.graph.vertices, 1);
    assert.equal(c.graph.enrichedVertices, 0);
    assert.equal(c.graph.changed, 0);
    assert.equal(c.graph.stale, 0);

    write("src/a.ts", "export function alpha(x: number): number {\n  return x + 9;\n}\n");
    run(["extract", "c"]);
    const c2 = JSON.parse(run(["skills", "status", "--json", "--root", tmp]).stdout).concepts.find(
      (x: any) => x.concept === "c"
    );
    assert.equal(c2.graph.changed, 1);

    const text = run(["skills", "status", "--root", tmp]);
    assert.match(text.stdout, /graph: 1 changed, 0 stale/);
  });

  it("malformed or unknown last-update sha -> unknown freshness (JSON and text)", () => {
    git("init", "-q");
    write(
      "scribe.config.json",
      JSON.stringify({ project: "p", concepts: { a: { globs: ["src/**"] }, b: { globs: ["src/**"] } } })
    );
    write("src/x.ts", "1");
    const mk = (n: string, sha: string) =>
      write(
        `.claude/skills/${n}/SKILL.md`,
        `---\nname: ${n}\nmetadata:\n  type: concept-skill\n  version: "1.0"\n  last-update: ${sha}\n---\n\nb\n`
      );
    mk("a", "--output=evil");
    mk("b", "0123456789abcdef0123456789abcdef01234567");
    git("add", "-A");
    git("commit", "-q", "-m", "one");

    const r = run(["skills", "status", "--json", "--root", tmp]);
    assert.equal(r.code, 0, r.stderr);
    const rep = JSON.parse(r.stdout);
    const a = rep.concepts.find((c: any) => c.concept === "a");
    const b = rep.concepts.find((c: any) => c.concept === "b");
    assert.equal(a.reason, "malformed-sha");
    assert.equal(a.commitsSince, null);
    assert.equal(a.unknownFreshness, true);
    assert.equal(b.reason, "unknown-commit");
    assert.equal(b.unknownFreshness, true);
    assert.ok(!fs.existsSync(path.join(tmp, "evil")), "no option reached git");

    const text = run(["skills", "status", "--root", tmp]);
    assert.equal(text.code, 0);
    assert.equal((text.stdout.match(/unknown freshness/g) ?? []).length, 2);
  });
});
