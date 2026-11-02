// scripts/ensure-store.mjs builds the graph store before `just eval` when it is missing or lacks a
// concept. It resolves the repo root from its own location, so each test copies it into a throwaway
// repo under $TMPDIR (scribe.config.json, scribe-output/graph.db, a stub dist/cli.js that logs its
// argv) and spawns that copy for real.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, "..", "scripts", "ensure-store.mjs");

let root = "";

const DDL = `
CREATE TABLE vertices (key TEXT PRIMARY KEY, doc TEXT NOT NULL,
  concept TEXT GENERATED ALWAYS AS (json_extract(doc, '$.concept')) VIRTUAL,
  status TEXT GENERATED ALWAYS AS (json_extract(doc, '$.status')) VIRTUAL);
CREATE TABLE docs (key TEXT PRIMARY KEY, doc TEXT NOT NULL,
  concept TEXT GENERATED ALWAYS AS (json_extract(doc, '$.concept')) VIRTUAL);
`;

function writeConfig(concepts: string[], extra: Record<string, unknown> = {}) {
  const map = Object.fromEntries(concepts.map((c) => [c, { globs: [] }]));
  fs.writeFileSync(path.join(root, "scribe.config.json"), JSON.stringify({ project: "t", concepts: map, ...extra }));
}

/** A store with live vertices for `vertexConcepts` and a docs row for `docConcepts`. */
function writeStore(vertexConcepts: string[], docConcepts: string[] = [], rel = "scribe-output/graph.db") {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(DDL);
  vertexConcepts.forEach((c, i) =>
    db
      .prepare("INSERT INTO vertices(key, doc) VALUES (?, ?)")
      .run(`v${i}`, JSON.stringify({ concept: c, status: "live" }))
  );
  docConcepts.forEach((c, i) =>
    db.prepare("INSERT INTO docs(key, doc) VALUES (?, ?)").run(`d${i}`, JSON.stringify({ concept: c }))
  );
  db.close();
  return file;
}

/** A dist/cli.js that appends its argv to calls.log and exits 1 when the `stub-fail` file names its step. */
function writeStubCli() {
  const cli = path.join(root, "packages/code-graph/dist/cli.js");
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(
    cli,
    `const fs = require("node:fs"), path = require("node:path");
const root = ${JSON.stringify(root)};
const args = process.argv.slice(2);
fs.appendFileSync(path.join(root, "calls.log"), args.join(" ") + "\\n");
const failFile = path.join(root, "stub-fail");
if (fs.existsSync(failFile) && args.join(" ").includes(fs.readFileSync(failFile, "utf8").trim())) process.exit(1);
`
  );
}

function calls(): string[] {
  const log = path.join(root, "calls.log");
  return fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : [];
}

function run(args: string[] = []) {
  return spawnSync(process.execPath, ["packages/code-graph/scripts/ensure-store.mjs", ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

beforeEach(() => {
  // realpath: the script's entrypoint check compares realpaths (os.tmpdir() may sit under a symlink).
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cg-ensure-store-")));
  fs.mkdirSync(path.join(root, "packages/code-graph/scripts"), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(root, "packages/code-graph/scripts/ensure-store.mjs"));
  writeStubCli();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("ensure-store.mjs", () => {
  it("is a silent no-op for a complete store (vertices and a docs-only concept), and leaves it byte-identical", () => {
    writeConfig(["a", "b", "docs-only"]);
    const file = writeStore(["a", "b"], ["docs-only"]);
    const before = fs.readFileSync(file);
    const r = run();
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
    assert.deepEqual(calls(), []);
    assert.ok(fs.readFileSync(file).equals(before));
  });

  it("does not count archived vertices as present", () => {
    writeConfig(["a"]);
    const file = writeStore([]);
    const db = new DatabaseSync(file);
    db.prepare("INSERT INTO vertices(key, doc) VALUES (?, ?)").run(
      "x",
      JSON.stringify({ concept: "a", status: "archived" })
    );
    db.close();
    const r = run(["--check"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /would build a/);
  });

  it("builds every concept for a missing store, naming what and from which root, without creating an empty db", () => {
    writeConfig(["a", "b"]);
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /scribe-output\/graph\.db is missing; building 2 concept\(s\) \(a, b\)/);
    assert.ok(r.stdout.includes(`store: built just now from ${root} (a, b; extract + apply)`), r.stdout);
    assert.deepEqual(calls(), [
      `--root ${root} extract a`,
      `--root ${root} apply a`,
      `--root ${root} extract b`,
      `--root ${root} apply b`,
    ]);
    assert.ok(!fs.existsSync(path.join(root, "scribe-output/graph.db")), "the script itself never creates the db");
  });

  it("honours a dbPath override in the config", () => {
    writeConfig(["a"], { dbPath: "out/custom.db" });
    writeStore(["a"], [], "scribe-output/graph.db"); // the default path is not the configured one
    const r = run(["--check"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /out\/custom\.db is missing/);
  });

  it("builds an empty store (tables, no rows)", () => {
    writeConfig(["a", "b"]);
    writeStore([]);
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /holds none of the repo's concepts/);
    assert.equal(calls().length, 4);
  });

  it("treats a file that is not a store as unreadable and builds", () => {
    writeConfig(["a"]);
    fs.mkdirSync(path.join(root, "scribe-output"), { recursive: true });
    fs.writeFileSync(path.join(root, "scribe-output/graph.db"), "not sqlite");
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /empty or unreadable/);
    assert.equal(calls().length, 2);
  });

  it("partial store: builds only the missing concept and does not touch the existing rows", () => {
    writeConfig(["a", "b", "c"]);
    const file = writeStore(["a", "c"]);
    const before = fs.readFileSync(file);
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /the store has no b; building 1 concept\(s\) \(b\)/);
    assert.deepEqual(calls(), [`--root ${root} extract b`, `--root ${root} apply b`]);
    assert.ok(fs.readFileSync(file).equals(before), "the stub changed nothing and the script did not write");
  });

  it("--check reports and exits 1 without building when the store is incomplete", () => {
    writeConfig(["a", "b"]);
    writeStore(["a"]);
    const r = run(["--check"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /store: the store has no b; would build b/);
    assert.deepEqual(calls(), []);
  });

  it("--check exits 0 silently for a complete store", () => {
    writeConfig(["a"]);
    writeStore(["a"]);
    const r = run(["--check"]);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
  });

  it("exits 0 without doing anything when the config declares no concepts", () => {
    writeConfig([]);
    assert.equal(run().status, 0);
    assert.deepEqual(calls(), []);
  });

  it("a failing build exits 3 with one line naming just regraph, never printing 'built just now'", () => {
    writeConfig(["a", "b"]);
    fs.writeFileSync(path.join(root, "stub-fail"), "apply a");
    const r = run();
    assert.equal(r.status, 3);
    assert.ok(!r.stdout.includes("built just now"));
    const lines = r.stderr.trimEnd().split("\n");
    assert.equal(lines.length, 1);
    assert.match(lines[0], /could not build the graph store \(.*apply a exited 1\).*just regraph/);
    assert.deepEqual(
      calls(),
      [`--root ${root} extract a`, `--root ${root} apply a`],
      "stops at the first failing step"
    );
  });

  it("exits 3 naming just regraph when dist/cli.js is missing", () => {
    writeConfig(["a"]);
    fs.rmSync(path.join(root, "packages/code-graph/dist"), { recursive: true });
    const r = run();
    assert.equal(r.status, 3);
    assert.match(r.stderr, /dist\/cli\.js is missing.*just regraph/);
  });

  it("still runs when invoked through a symlink (the entrypoint check compares realpaths)", () => {
    writeConfig(["a"]);
    fs.symlinkSync(path.join(root, "packages/code-graph/scripts/ensure-store.mjs"), path.join(root, "link-store.mjs"));
    const r = spawnSync(process.execPath, ["link-store.mjs", "--check"], { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /would build a/);
  });
});
