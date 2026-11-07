// Gaps in `code-graph scout` that scout-cli.test.ts does not reach: a relative scope path under --root with
// the config in a git subdirectory, the git root alone, ts-morph missing after an index, exact session
// sizes at the cap through the CLI, mixed ignored and skipped lines, and raw scope-file bytes. Real CLI and
// bundle runs on a throwaway project, no model call. Requires `pnpm build` first, like scout-cli.test.ts.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, "../..");
const DIST = path.join(PKG, "dist/cli.js");
const BUNDLE = path.resolve(PKG, "../../plugin/scripts/code-graph.cjs");
const TS_MORPH = path.join(PKG, "node_modules", "ts-morph");
const TIMEOUT_MS = 120_000;

let tmp = "";
let cache = "";

function run(cli: string, cwd: string, args: string[]) {
  const env = { ...process.env, XDG_CACHE_HOME: cache };
  delete env.CLAUDE_PLUGIN_DATA;
  delete env.CLAUDE_PROJECT_DIR;
  return spawnSync("node", [cli, ...args], { cwd, encoding: "utf8", env, timeout: TIMEOUT_MS });
}

/** A two-concept project under `name`, with ts-morph linked in from the repo. `config` may omit the tsconfig key. */
function project(name: string, opts: { declareTsconfig?: boolean } = {}): string {
  const root = path.join(tmp, name);
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  write("src/shared/util.ts", "export function usedFn(x: number): number {\n  return x + 1;\n}\n");
  write(
    "src/app/main.ts",
    `import { usedFn } from "../shared/util";\nexport function mainFn(): number {\n  return usedFn(1);\n}\n`
  );
  write("scripts/gen.cjs", "module.exports = {};\n");
  write(".claude/skills/app/SKILL.md", "# app\n\nThe app concept.\n");
  write(".claude/skills/shared/SKILL.md", "# shared\n\nThe shared concept.\n");
  write(
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { module: "esnext", moduleResolution: "bundler" }, include: ["src/**/*.ts"] })
  );
  const config: Record<string, unknown> = {
    project: name,
    concepts: {
      app: { globs: ["src/app/**/*.ts"], skill: ".claude/skills/app/SKILL.md" },
      shared: { globs: ["src/shared/**/*.ts"], skill: ".claude/skills/shared/SKILL.md" },
    },
  };
  if (opts.declareTsconfig !== false) config.tsconfig = "tsconfig.json";
  write("scribe.config.json", JSON.stringify(config));
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.symlinkSync(TS_MORPH, path.join(root, "node_modules", "ts-morph"), "dir");
  return root;
}

function index(root: string) {
  const built = run(DIST, root, ["extract", "--all"]);
  assert.equal(built.status, 0, built.stderr);
  const applied = run(DIST, root, ["apply", "--all", "--approve-drift"]);
  assert.equal(applied.status, 0, applied.stderr);
}

function scopeFile(dir: string, lines: string[], eol = "\n"): string {
  const file = path.join(dir, "scope.txt");
  fs.writeFileSync(file, lines.join(eol) + eol);
  return file;
}

before(() => {
  for (const f of [DIST, BUNDLE, TS_MORPH]) assert.ok(fs.existsSync(f), `${f} is missing, run pnpm build first`);
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cg-scout-gaps-")));
  cache = path.join(tmp, "empty-cache");
  fs.mkdirSync(cache);
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("scout with the config in a git subdirectory, relative paths", () => {
  let repo = "";
  let root = "";
  before(() => {
    repo = path.join(tmp, "mono-rel");
    root = project("mono-rel/packages/app");
    fs.mkdirSync(path.join(repo, ".git"));
    index(root);
  });

  it("a relative scope path under --root resolves against the config directory", () => {
    // Scope lines are git-root relative even when the scope file path is config-relative.
    scopeFile(root, ["packages/app/src/app/main.ts"]);
    const r = run(DIST, repo, ["--root", root, "scout", "scope.txt", "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const plan = JSON.parse(r.stdout);
    assert.equal(plan.root, repo);
    assert.deepEqual(plan.sessions[0].files, ["packages/app/src/app/main.ts"]);
  });

  it("the same relative path with --root names the missing scope file (no fallback to the git root)", () => {
    // scope.txt exists at the git root only: a relative path must not find it there.
    scopeFile(repo, ["packages/app/src/app/main.ts"]);
    fs.rmSync(path.join(root, "scope.txt"), { force: true });
    const r = run(DIST, repo, ["--root", root, "scout", "scope.txt"]);
    assert.equal(r.status, 11, r.stderr);
    assert.match(r.stderr, /cannot read scope file scope\.txt/);
    fs.rmSync(path.join(repo, "scope.txt"), { force: true });
  });

  it("from the git root with no --root, the config in a subdirectory is not found: exit 5", () => {
    const scope = scopeFile(repo, ["packages/app/src/app/main.ts"]);
    const r = run(DIST, repo, ["scout", scope]);
    assert.equal(r.status, 5, r.stdout + r.stderr);
    assert.equal(r.stdout, "");
    fs.rmSync(scope, { force: true });
  });
});

describe("scout stops and plans, real CLI", () => {
  // The bundle loads ts-morph through the project (project-deps.ts). dist does not: catalog.ts imports it
  // statically, so dist finds the package's own copy. That difference is reported, not pinned here.
  it("bundle: ts-morph missing from the project after an index: one stderr line naming deps install, exit 12", () => {
    const root = project("no-morph");
    index(root);
    fs.rmSync(path.join(root, "node_modules", "ts-morph"));
    const r = run(BUNDLE, root, ["scout", scopeFile(root, ["src/app/main.ts"])]);
    assert.equal(r.status, 12, r.stdout + r.stderr);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr.trim().split("\n").length, 1, r.stderr);
    assert.match(r.stderr, /deps install/);
    assert.ok(!fs.existsSync(path.join(root, "scribe-output", "scout")));
  });

  it("declared tsconfig missing: exit 12, no fallback to another tsconfig", () => {
    const root = project("declared-missing");
    index(root);
    fs.rmSync(path.join(root, "tsconfig.json"));
    fs.writeFileSync(path.join(root, "src", "other.json"), "{}");
    const r = run(DIST, root, ["scout", scopeFile(root, ["src/app/main.ts"])]);
    assert.equal(r.status, 12, r.stderr);
    assert.match(r.stderr, /no tsconfig/);
  });

  for (const [name, cli] of [
    ["dist", DIST],
    ["bundle", BUNDLE],
  ] as const) {
    it(`${name}: tsconfig key omitted names the key, not the index: exit 12, one line`, () => {
      // extract makes every concept docs-only without the key, so `extract` + `apply` cannot fix this.
      const root = project(`no-key-${name}`, { declareTsconfig: false });
      index(root);
      const r = run(cli, root, ["scout", scopeFile(root, ["src/app/main.ts"])]);
      assert.equal(r.status, 12, r.stdout + r.stderr);
      assert.equal(r.stdout, "");
      assert.equal(r.stderr.trim().split("\n").length, 1);
      assert.match(r.stderr, /no `tsconfig` key in scribe\.config\.json/);
      assert.doesNotMatch(r.stderr, /no index/);
    });
  }

  it("tsconfig key omitted with no store: names the key and creates no store", () => {
    const root = project("no-key-no-store", { declareTsconfig: false });
    const r = run(DIST, root, ["scout", scopeFile(root, ["src/app/main.ts"])]);
    assert.equal(r.status, 12, r.stdout + r.stderr);
    assert.match(r.stderr, /no `tsconfig` key/);
    assert.ok(!fs.existsSync(path.join(root, "scribe-output")));
  });

  it("tsconfig key removed from a built store: no auto-detection, the key is named", () => {
    const root = project("key-removed");
    index(root);
    const file = path.join(root, "scribe.config.json");
    const { tsconfig: _removed, ...config } = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify(config));
    const r = run(DIST, root, ["scout", scopeFile(root, ["src/app/main.ts"])]);
    assert.equal(r.status, 12, r.stdout + r.stderr);
    assert.match(r.stderr, /no `tsconfig` key/);
    assert.ok(!fs.existsSync(path.join(root, "scribe-output", "scout")));
  });

  it("a scope mixing ignored and skipped lines, with a session: both counted, no nothing-scanned line", () => {
    const root = project("mixed");
    index(root);
    const scope = scopeFile(root, ["src/app/main.ts", "scripts/gen.cjs", "src/gone.ts"]);
    const r = run(DIST, root, ["scout", scope]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^ignored: 1 file outside the code index$/m);
    assert.match(r.stdout, /^skipped lines: 1: src\/gone\.ts \(no such file\)$/m);
    assert.match(r.stdout, /^session 1: .*session-1\.md: src\/app\/main\.ts$/m);
    assert.doesNotMatch(r.stdout, /nothing scanned/);
    assert.doesNotMatch(r.stdout, /PROPOSALS/);
  });

  it("a scope with no session and both ignored and skipped lines: the ignored reason wins, both counts stay", () => {
    const root = project("mixed-empty");
    index(root);
    const scope = scopeFile(root, ["scripts/gen.cjs", "src/gone.ts"]);
    const r = run(DIST, root, ["scout", scope]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^ignored: 1 file outside the code index$/m);
    assert.match(r.stdout, /^skipped lines: 1: src\/gone\.ts \(no such file\)$/m);
    assert.match(
      r.stdout,
      /^nothing scanned: no file in scope is in the code index \(1 ignored\); this is not a clean result/m
    );
    assert.equal(r.stdout.match(/^nothing scanned:/gm)?.length, 1);
  });

  it("CRLF endings, blank lines, a ./ prefix and a NUL byte: good lines kept, the NUL line named as a bad line", () => {
    const root = project("bytes");
    index(root);
    const file = path.join(root, "scope.txt");
    fs.writeFileSync(file, "src/app/main.ts\r\n\r\n./src/shared/util.ts\r\nsrc/app/\u0000x.ts\r\n");
    const r = run(DIST, root, ["scout", file, "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const plan = JSON.parse(r.stdout);
    assert.equal(plan.scope, 2);
    assert.deepEqual(plan.sessions[0].files, ["src/app/main.ts", "src/shared/util.ts"]);
    assert.equal(plan.skippedLines.length, 1);
    assert.equal(plan.skippedLines[0].reason, "no such file");
  });

  it("the bundle prints the same plain lines as dist for a mixed scope", () => {
    const root = project("bundle-plain");
    index(root);
    const scope = scopeFile(root, ["src/app/main.ts", "scripts/gen.cjs", "src/gone.ts"]);
    const fromDist = run(DIST, root, ["scout", scope]).stdout.replace(/session-1\.md/, "session-N.md");
    const fromBundle = run(BUNDLE, root, ["scout", scope]).stdout.replace(/session-1\.md/, "session-N.md");
    assert.equal(fromBundle, fromDist);
  });
});

describe("scout session cap at the CLI, exactly 11 and 12 files", () => {
  let root = "";
  let twelve: string[] = [];
  before(() => {
    root = project("cap-edges");
    // Twelve unlinked files in the shared concept: nothing links them, so they pack, not chain.
    twelve = Array.from({ length: 12 }, (_, i) => {
      fs.writeFileSync(path.join(root, "src/shared", `z${i}.ts`), `export const z${i} = ${i};\n`);
      return `src/shared/z${i}.ts`;
    });
    index(root);
  });

  it("a scope of exactly 11 files is one session with no not-scanned line", () => {
    const r = run(DIST, root, ["scout", scopeFile(root, twelve.slice(0, 11)), "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const plan = JSON.parse(r.stdout);
    assert.equal(plan.sessions.length, 1);
    assert.equal(plan.sessions[0].files.length, 11);
    assert.deepEqual(plan.notScanned, []);
    assert.doesNotMatch(run(DIST, root, ["scout", scopeFile(root, twelve.slice(0, 11))]).stdout, /not scanned/);
  });

  it("a scope of 12 files is two sessions of 11 and 1, and the plain output says so", () => {
    const scope = scopeFile(root, twelve);
    const r = run(DIST, root, ["scout", scope, "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const plan = JSON.parse(r.stdout);
    assert.deepEqual(
      plan.sessions.map((s: { files: string[] }) => s.files.length).sort((a: number, b: number) => b - a),
      [11, 1]
    );
    assert.deepEqual(plan.notScanned, []);
    const plain = run(DIST, root, ["scout", scope]).stdout;
    assert.match(plain, /^scout: 12 files in scope, 2 sessions/m);
    assert.match(plain, /^session 2: /m);
    assert.doesNotMatch(plain, /^not scanned:/m);
  });
});
