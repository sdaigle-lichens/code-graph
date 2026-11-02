// scripts/ensure-store.mjs against the REAL built CLI (dist/cli.js), no stub. ensure-store.test.ts
// covers the script's decisions with a stub CLI that logs argv; this file catches drift in what the
// script passes to the real CLI (a renamed subcommand, a changed exit code, an extract that needs
// something the script does not pass). Requires a built dist: `pnpm build` (the eval-cli tests do the same).
//
// Fixture: a throwaway repo under $TMPDIR laid out like the real one, so the script's root (two
// levels above its own file) is the temp repo. Only the script is copied in; dist/ is a symlink to
// the real build, so the CLI under test is the one `just store-fresh` runs.
//
// ts-morph: `extract` resolves it through requireFromProject (project-deps.ts). That tries the
// plugin deps dirs first (CLAUDE_PLUGIN_DATA, then $XDG_CACHE_HOME/code-graph/deps/<key>), then the
// project root found from the CLI's cwd (findConfigRoot). This test clears CLAUDE_PLUGIN_DATA and
// points XDG_CACHE_HOME at an empty temp dir, so the plugin dirs are absent, and symlinks the repo's
// own packages/code-graph/node_modules/ts-morph into the temp repo's node_modules. That is one
// symlink, no install, no network. The symlink resolves to the real directory, so ts-morph's own
// dependencies (@ts-morph/common, typescript) are found beside it through Node's realpath lookup.
//
// Timing: each CLI call re-loads ts-morph, so the first build is several seconds; the full file
// takes roughly 10-20s on a laptop. Budget per test is set explicitly below.

import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, "..");
const SCRIPT = path.join(PKG, "scripts", "ensure-store.mjs");
const DIST = path.join(PKG, "dist");
const CLI = path.join(DIST, "cli.js");
const TS_MORPH = path.join(PKG, "node_modules", "ts-morph");
const TIMEOUT_MS = 120_000;

let tmp = "";
let root = "";

before(() => {
  assert.ok(fs.existsSync(CLI), `${CLI} is missing, run pnpm build first`);
  assert.ok(fs.existsSync(TS_MORPH), `${TS_MORPH} is missing, run pnpm install first (ts-morph is a dependency)`);
});

function writeConcept(name: string) {
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", `${name}.ts`),
    `export function ${name}Fn(x: number): number {\n  return x * 2;\n}\n`
  );
  const skill = path.join(root, ".claude", "skills", name, "SKILL.md");
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, `# ${name}\n\nThe ${name} concept, one line.\n`);
}

function writeConfig(concepts: string[]) {
  const map = Object.fromEntries(
    concepts.map((c) => [c, { globs: [`src/${c}.ts`], skill: `.claude/skills/${c}/SKILL.md` }])
  );
  fs.writeFileSync(
    path.join(root, "scribe.config.json"),
    JSON.stringify({ project: "tiny", tsconfig: "tsconfig.json", concepts: map }, null, 2)
  );
}

function fixture(concepts: string[]) {
  // realpath: the script's entrypoint check and its root both compare real paths (macOS /tmp is a symlink).
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cg-ensure-cli-")));
  root = path.join(tmp, "repo");
  const pkgDir = path.join(root, "packages", "code-graph");
  fs.mkdirSync(path.join(pkgDir, "scripts"), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(pkgDir, "scripts", "ensure-store.mjs"));
  fs.symlinkSync(DIST, path.join(pkgDir, "dist"), "dir");
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.symlinkSync(fs.realpathSync(TS_MORPH), path.join(root, "node_modules", "ts-morph"), "dir");
  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { target: "ES2022", module: "ESNext", strict: true, noEmit: true },
      include: ["src"],
    })
  );
  for (const c of ["a", "b"]) writeConcept(c);
  writeConfig(concepts);
}

function ensureStore(args: string[] = []) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDE_PLUGIN_DATA; // see the ts-morph note at the top
  delete env.NODE_OPTIONS;
  delete env.CLAUDE_PROJECT_DIR;
  env.XDG_CACHE_HOME = path.join(tmp, "empty-cache");
  return spawnSync(process.execPath, [path.join(root, "packages/code-graph/scripts/ensure-store.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
    env,
    timeout: TIMEOUT_MS,
  });
}

/** The real CLI for one step, run the way the script runs it (`--root <repo> <step> <args>`). */
function cli(args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDE_PLUGIN_DATA;
  delete env.NODE_OPTIONS;
  delete env.CLAUDE_PROJECT_DIR;
  env.XDG_CACHE_HOME = path.join(tmp, "empty-cache");
  const r = spawnSync(process.execPath, [CLI, "--root", root, ...args], {
    cwd: root,
    encoding: "utf8",
    env,
    timeout: TIMEOUT_MS,
  });
  assert.equal(r.status, 0, `cli ${args.join(" ")} failed:\n${r.stderr}`);
  return r;
}

const dbFile = () => path.join(root, "scribe-output", "graph.db");

/** Rows for one concept, in a stable order, for before/after comparisons. */
function conceptRows(concept: string) {
  const db = new DatabaseSync(dbFile(), { readOnly: true });
  try {
    const vertices = db
      .prepare("SELECT key, doc FROM vertices WHERE concept = ? ORDER BY key")
      .all(concept)
      .map((r) => `${r.key}=${r.doc}`);
    const docs = db
      .prepare("SELECT key, doc FROM docs WHERE concept = ? ORDER BY key")
      .all(concept)
      .map((r) => `${r.key}=${r.doc}`);
    return { vertices, docs };
  } finally {
    db.close();
  }
}

function liveCount(concept: string): number {
  const db = new DatabaseSync(dbFile(), { readOnly: true });
  try {
    return Number(
      (
        db.prepare("SELECT count(*) AS n FROM vertices WHERE concept = ? AND status = 'live'").get(concept) as {
          n: number;
        }
      ).n
    );
  } finally {
    db.close();
  }
}

afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = "";
});

describe("ensure-store.mjs against the real dist/cli.js", () => {
  it(
    "builds the store for a code concept with no graph.db and prints the built-just-now line",
    { timeout: TIMEOUT_MS },
    () => {
      fixture(["a"]);
      assert.equal(fs.existsSync(dbFile()), false);
      const r = ensureStore();
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /scribe-output\/graph\.db is missing; building 1 concept\(s\) \(a\)/);
      assert.ok(r.stdout.includes(`store: built just now from ${root} (a; extract + apply)`), r.stdout);
      assert.ok(liveCount("a") > 0, "the code concept has live vertices");
      assert.equal(conceptRows("a").docs.length, 1, "the SKILL.md doc vertex is ingested");
      assert.ok(fs.existsSync(path.join(root, "scribe-output", "a.ast.json")));
    }
  );

  it(
    "a second run on the complete store is a no-op: db mtime and size unchanged, no built-just-now line",
    { timeout: TIMEOUT_MS },
    () => {
      fixture(["a"]);
      assert.equal(ensureStore().status, 0);
      const before = fs.statSync(dbFile());
      const r = ensureStore();
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, "");
      assert.ok(!r.stdout.includes("built just now"));
      const after = fs.statSync(dbFile());
      assert.equal(after.mtimeMs, before.mtimeMs, "db mtime unchanged");
      assert.equal(after.size, before.size, "db size unchanged");
    }
  );

  it(
    "with a second concept added, builds only that concept and leaves the first concept's rows and enriched file untouched",
    { timeout: TIMEOUT_MS },
    () => {
      fixture(["a"]);
      assert.equal(ensureStore().status, 0);

      // Enrich concept a through the real `enrich merge`, so there is a real .enriched.json to protect.
      const ast = JSON.parse(fs.readFileSync(path.join(root, "scribe-output", "a.ast.json"), "utf8")) as {
        vertices: { _key: string }[];
      };
      const partial = path.join(tmp, "a-partial.json");
      fs.writeFileSync(
        partial,
        JSON.stringify({
          concept: "a",
          vertices: [{ _key: ast.vertices[0]!._key, purpose: "doubles a number" }],
          edges: [],
        })
      );
      cli(["enrich", "merge", "a", partial]);
      const enrichedPath = path.join(root, "scribe-output", "a.enriched.json");
      const enrichedBefore = fs.readFileSync(enrichedPath);
      const astBefore = fs.readFileSync(path.join(root, "scribe-output", "a.ast.json"));
      const rowsBefore = conceptRows("a");

      // Add a second concept, then run the script again.
      writeConcept("b");
      writeConfig(["a", "b"]);
      const r = ensureStore();
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /the store has no b; building 1 concept\(s\) \(b\)/);
      assert.ok(r.stdout.includes(`store: built just now from ${root} (b; extract + apply)`), r.stdout);
      assert.ok(liveCount("b") > 0, "the new concept has live vertices");

      assert.deepEqual(conceptRows("a"), rowsBefore, "concept a's rows are unchanged");
      assert.ok(fs.readFileSync(enrichedPath).equals(enrichedBefore), "a.enriched.json is byte-identical");
      assert.ok(
        fs.readFileSync(path.join(root, "scribe-output", "a.ast.json")).equals(astBefore),
        "a.ast.json is byte-identical (concept a was not re-extracted)"
      );
    }
  );
});
