// A Node without node:sqlite must give every store command one documented exit code and a one-line fix,
// not a bare exit 1. Spawned for real (`node --no-experimental-sqlite`) against both the committed
// plugin bundle and the tsc build; layer 1 and the commands that never open the store must keep working.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT_NO_SQLITE, noSqliteMessage, REQUIRED_NODE } from "./sqlite-guard.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, "..");
const CLIS = [
  { name: "bundle", path: path.resolve(PKG, "../../plugin/scripts/code-graph.cjs") },
  { name: "dist", path: path.join(PKG, "dist/cli.js") },
];

let tmp = "";
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cg-nosqlite-"));
  fs.writeFileSync(
    path.join(tmp, "scribe.config.json"),
    JSON.stringify({ project: "p", tsconfig: "tsconfig.json", concepts: { a: { globs: ["src/**"] } } })
  );
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function run(cli: string, args: string[], flags: string[] = ["--no-experimental-sqlite"]) {
  return spawnSync(process.execPath, [...flags, cli, ...args], { cwd: tmp, encoding: "utf8" });
}

describe("node:sqlite unavailable", () => {
  it("uses a distinct exit code and names the Node requirement", () => {
    assert.equal(EXIT_NO_SQLITE, 8);
    assert.equal(REQUIRED_NODE, ">=22.5");
    const msg = noSqliteMessage("v20.0.0");
    assert.ok(!msg.includes("\n"));
    assert.match(msg, /22\.5/);
    assert.match(msg, /node --version/);
  });

  for (const cli of CLIS) {
    for (const args of [
      ["search", "anything"],
      ["search", "anything", "--json"],
      ["status"],
      ["bootstrap"],
      ["reindex"],
      ["apply", "a"],
      ["drift", "a"],
      ["enrich", "targets", "a"],
      ["enrich", "merge", "a", "partial.json"],
      ["query", "concept", "a"],
      ["query", "impact", "foo"],
      ["query", "file", "src/x.ts"],
      ["delete-concept", "a", "--yes"],
      ["eval"],
    ]) {
      it(`${cli.name}: ${args.join(" ")} exits ${EXIT_NO_SQLITE} with one line`, () => {
        const r = run(cli.path, args);
        assert.equal(r.status, EXIT_NO_SQLITE, r.stderr);
        assert.equal(r.stdout, "");
        const lines = r.stderr.trim().split("\n");
        assert.equal(lines.length, 1, r.stderr);
        assert.match(lines[0], /node:sqlite is not available/);
        assert.match(lines[0], /22\.5/);
        assert.match(lines[0], /node --version/);
      });
    }

    it(`${cli.name}: skills and deps commands still work without node:sqlite`, () => {
      const skills = run(cli.path, ["skills", "list", "--root", tmp]);
      assert.equal(skills.status, 0, skills.stderr);
      const deps = run(cli.path, ["deps", "status"]);
      assert.equal(deps.status, 0, deps.stderr);
    });

    it(`${cli.name}: a store command still runs normally when node:sqlite loads`, () => {
      const r = run(cli.path, ["bootstrap"], []);
      assert.equal(r.status, 0, r.stderr);
    });
  }
});
