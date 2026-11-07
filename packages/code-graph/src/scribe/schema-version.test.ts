// The store's schema-version check, reached for real: every store command run through dist on a throwaway
// project whose store claims a newer schema must exit 3 with the upgrade message and leave the stored
// version alone. Requires `pnpm build` first, like scout-cli-exits.test.ts.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { bootstrapStore, NewerStoreError, SCHEMA_VERSION } from "./bootstrap.js";
import { closeStores } from "./db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, "../..");
const DIST = path.join(PKG, "dist/cli.js");
const TS_MORPH = path.join(PKG, "node_modules", "ts-morph");
const NEWER = 999;

let tmp = "";
let root = "";
let storePath = "";

function run(args: string[]) {
  const env = { ...process.env, XDG_CACHE_HOME: path.join(tmp, "cache") };
  delete env.CLAUDE_PLUGIN_DATA;
  delete env.CLAUDE_PROJECT_DIR;
  return spawnSync("node", [DIST, ...args], { cwd: root, encoding: "utf8", env, timeout: 120_000 });
}

function setVersion(file: string, version: number) {
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA user_version = ${version}`);
  db.close();
}

function getVersion(file: string): number {
  const db = new DatabaseSync(file);
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  db.close();
  return row.user_version;
}

before(() => {
  tmp = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), "cg-schema-"));
  root = path.join(tmp, "proj");
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  write("src/app/main.ts", "export function mainFn(): number {\n  return 1;\n}\n");
  write(".claude/skills/app/SKILL.md", "# app\n\nThe app concept.\n");
  write(
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { module: "esnext", moduleResolution: "bundler" }, include: ["src/**/*.ts"] })
  );
  write(
    "scribe.config.json",
    JSON.stringify({
      project: "proj",
      tsconfig: "tsconfig.json",
      concepts: { app: { globs: ["src/app/**/*.ts"], skill: ".claude/skills/app/SKILL.md" } },
    })
  );
  write("partial.json", JSON.stringify({ concept: "app", vertices: [], edges: [] }));
  write("scope.txt", "src/app/main.ts\n");
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.symlinkSync(TS_MORPH, path.join(root, "node_modules", "ts-morph"), "dir");
  storePath = path.join(root, "scribe-output", "graph.db");
  assert.equal(run(["extract", "--all"]).status, 0);
  const applied = run(["apply", "--all", "--approve-drift"]);
  assert.equal(applied.status, 0, applied.stderr);
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("every store command refuses a store written by a newer code-graph", () => {
  const commands: Array<[string, string[]]> = [
    ["status", ["status"]],
    ["bootstrap", ["bootstrap"]],
    ["reindex", ["reindex"]],
    ["apply", ["apply", "app", "--approve-drift"]],
    ["drift", ["drift", "app"]],
    ["enrich targets", ["enrich", "targets", "app"]],
    ["enrich targets --summary", ["enrich", "targets", "--summary"]],
    ["enrich merge", ["enrich", "merge", "app", "partial.json"]],
    ["enrich prune", ["enrich", "prune", "app"]],
    ["search", ["search", "main function"]],
    ["eval", ["eval"]],
    ["query concept", ["query", "concept", "app"]],
    ["query impact", ["query", "impact", "mainFn"]],
    ["query cross", ["query", "cross", "app", "app"]],
    ["query vertex", ["query", "vertex", "src/app/main.ts"]],
    ["query file", ["query", "file", "src/app/main.ts"]],
    ["skills status", ["skills", "status"]],
    ["refresh-skills", ["refresh-skills"]],
    ["delete-concept", ["delete-concept", "app", "--yes"]],
    ["scout", ["scout", "scope.txt"]],
  ];
  for (const [name, args] of commands) {
    it(`${name}: exit 3, the upgrade message, the stored version unchanged`, () => {
      setVersion(storePath, NEWER);
      const config = fs.readFileSync(path.join(root, "scribe.config.json"), "utf8");
      const r = run(args);
      assert.equal(r.status, 3, r.stdout + r.stderr);
      assert.match(r.stderr, /written by a newer code-graph/);
      assert.equal(getVersion(storePath), NEWER);
      assert.equal(fs.readFileSync(path.join(root, "scribe.config.json"), "utf8"), config);
      assert.equal(fs.existsSync(path.join(root, "scribe-output", "app.enriched.json")), false);
    });
  }
});

describe("refresh-skills --hook on a newer store reports the upgrade and never fails the stop", () => {
  it("exit 0, a systemMessage carrying the upgrade message, the stored version and config unchanged, no lock left", () => {
    setVersion(storePath, NEWER);
    const config = fs.readFileSync(path.join(root, "scribe.config.json"), "utf8");
    const env = { ...process.env, XDG_CACHE_HOME: path.join(tmp, "cache") };
    delete env.CLAUDE_PLUGIN_DATA;
    delete env.CLAUDE_PROJECT_DIR;
    const r = spawnSync("node", [DIST, "refresh-skills", "--hook"], {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify({ cwd: root }),
      env,
      timeout: 120_000,
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout.trim()) as { systemMessage?: unknown };
    assert.equal(typeof out.systemMessage, "string", r.stdout);
    assert.match(out.systemMessage as string, /written by a newer code-graph/);
    assert.match(out.systemMessage as string, new RegExp(`${NEWER} > ${SCHEMA_VERSION}`));
    assert.equal(getVersion(storePath), NEWER);
    assert.equal(fs.readFileSync(path.join(root, "scribe.config.json"), "utf8"), config);
    assert.equal(fs.existsSync(path.join(root, "scribe-output", ".refresh-skills.lock")), false);
    assert.equal(fs.existsSync(path.join(root, "scribe-output", "app.enriched.json")), false);
  });
});

describe("a new or older store still opens and is stamped with the current version", () => {
  it("an older store (version 0) is stamped by a store command", () => {
    setVersion(storePath, 0);
    const r = run(["status"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(getVersion(storePath), SCHEMA_VERSION);
  });

  it("a store at the current version is left at it", () => {
    const r = run(["status"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(getVersion(storePath), SCHEMA_VERSION);
  });

  it("bootstrapStore: a new file gets the current version, a newer one throws and is untouched", () => {
    const file = path.join(tmp, "lib", "graph.db");
    try {
      bootstrapStore(file);
      closeStores();
      assert.equal(getVersion(file), SCHEMA_VERSION);
      setVersion(file, NEWER);
      assert.throws(() => bootstrapStore(file), NewerStoreError);
      closeStores();
      assert.equal(getVersion(file), NEWER);
    } finally {
      closeStores();
    }
  });
});
