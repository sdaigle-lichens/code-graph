// Every `code-graph scout` exit-12 path, through dist and the bundle, on a throwaway project: exactly one
// stderr line starting `refactor-scout not run: `, empty stdout, no `PROPOSALS:` line, also with --json.
// No model call. Requires `pnpm build` first, like the other scout CLI tests.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, "../..");
const DIST = path.join(PKG, "dist/cli.js");
const BUNDLE = path.resolve(PKG, "../../plugin/scripts/code-graph.cjs");
const TS_MORPH = path.join(PKG, "node_modules", "ts-morph");
const TIMEOUT_MS = 120_000;
const PREFIX = "refactor-scout not run: ";

let tmp = "";
let cache = "";

function run(cli: string, root: string, args: string[]) {
  const env = { ...process.env, XDG_CACHE_HOME: cache };
  delete env.CLAUDE_PLUGIN_DATA;
  delete env.CLAUDE_PROJECT_DIR;
  return spawnSync("node", [cli, ...args], { cwd: root, encoding: "utf8", env, timeout: TIMEOUT_MS });
}

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

function scopeFile(root: string, lines: string[]): string {
  const file = path.join(root, "scope.txt");
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

const storeOf = (root: string) => path.join(root, "scribe-output", "graph.db");

/** The contract every exit-12 path keeps: one prefixed stderr line, empty stdout, no PROPOSALS: line. */
function assertNotRun(r: ReturnType<typeof run>, reason: RegExp) {
  assert.equal(r.status, 12, r.stdout + r.stderr);
  assert.equal(r.stdout, "", "stdout stays empty");
  assert.equal(r.stderr.trim().split("\n").length, 1, r.stderr);
  assert.ok(r.stderr.startsWith(PREFIX), r.stderr);
  assert.match(r.stderr, reason);
  assert.doesNotMatch(r.stdout + r.stderr, /PROPOSALS:/);
}

before(() => {
  for (const f of [DIST, BUNDLE, TS_MORPH]) assert.ok(fs.existsSync(f), `${f} is missing, run pnpm build first`);
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cg-scout-notrun-")));
  cache = path.join(tmp, "empty-cache");
  fs.mkdirSync(cache);
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const CLIS = [
  ["dist", DIST],
  ["bundle", BUNDLE],
] as const;

describe("scout exit 12: every stop is one prefixed line with no PROPOSALS: line", () => {
  for (const [name, cli] of CLIS) {
    it(`${name}: no store with --json is still one stderr line and no stdout`, () => {
      const root = project(`json-no-store-${name}`);
      const r = run(cli, root, ["scout", scopeFile(root, ["src/app/main.ts"]), "--json"]);
      assertNotRun(r, /^refactor-scout not run: no index, so no metrics primer and no proposals\n$/);
      assert.ok(!fs.existsSync(path.join(root, "scribe-output")));
    });

    it(`${name}: a store whose vertices are all archived is no index, one line`, () => {
      const root = project(`archived-${name}`);
      index(root);
      const db = new DatabaseSync(storeOf(root));
      // `status` is a generated column over the JSON `doc`: archive the rows through the payload.
      db.exec("UPDATE vertices SET doc = json_set(doc, '$.status', 'archived')");
      db.close();
      const r = run(cli, root, ["scout", scopeFile(root, ["src/app/main.ts"])]);
      assertNotRun(r, /^refactor-scout not run: no index/);
    });

    it(`${name}: a declared tsconfig file that is missing, with a built store, is one line`, () => {
      const root = project(`missing-tsconfig-${name}`);
      index(root);
      fs.rmSync(path.join(root, "tsconfig.json"));
      const r = run(cli, root, ["scout", scopeFile(root, ["src/app/main.ts"])]);
      assertNotRun(r, /^refactor-scout not run: no tsconfig, so no metrics primer/);
    });

    it(`${name}: tsconfig key omitted with a built store and --json is one line, no stdout`, () => {
      const root = project(`key-json-${name}`, { declareTsconfig: false });
      index(root);
      const r = run(cli, root, ["scout", scopeFile(root, ["src/app/main.ts"]), "--json"]);
      assertNotRun(r, /^refactor-scout not run: no `tsconfig` key in scribe\.config\.json/);
    });

    it(`${name}: tsconfig key omitted with no store is the key reason, not no index`, () => {
      const root = project(`key-no-store-${name}`, { declareTsconfig: false });
      const r = run(cli, root, ["scout", scopeFile(root, ["src/app/main.ts"])]);
      assertNotRun(r, /^refactor-scout not run: no `tsconfig` key in scribe\.config\.json/);
      assert.ok(!fs.existsSync(path.join(root, "scribe-output")));
    });
  }

  it("bundle: ts-morph missing from the project is one line naming the deps install", () => {
    // Only the bundle resolves ts-morph from the project (requireFromProject); the dist resolves it from the package.
    const root = project("no-ts-morph-bundle");
    index(root);
    fs.rmSync(path.join(root, "node_modules", "ts-morph"));
    const r = run(BUNDLE, root, ["scout", scopeFile(root, ["src/app/main.ts"])]);
    assertNotRun(r, /^refactor-scout not run: no catalog \(.*deps install/);
  });
});
