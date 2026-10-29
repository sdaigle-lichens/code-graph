// Run-directly checks in the repo's .mjs scripts must survive a symlinked path (macOS /tmp ->
// /private/tmp) and stay inert when imported. check-versions has its own cases in ast-stability.test.ts.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "../../../..");
const STRIP = path.join(REPO, "bench/strip-concept-skills.mjs");
const CLEAN = path.join(REPO, "packages/code-graph/scripts/check-plugin-clean.mjs");

let tmp: string;
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "script-symlink-"));
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const run = (file: string, args: string[] = []) => spawnSync(process.execPath, [file, ...args], { encoding: "utf8" });

describe("strip-concept-skills run-directly check", () => {
  it("runs through a symlinked directory (exit 2 on missing arg proves main ran)", () => {
    const link = path.join(tmp, "bench-link");
    fs.symlinkSync(path.dirname(STRIP), link, "dir");
    const r = run(path.join(link, "strip-concept-skills.mjs"));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /not a directory/);
  });

  it("does nothing when imported", () => {
    const r = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(STRIP).href)});`],
      { encoding: "utf8" }
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
  });
});

describe("check-plugin-clean run-directly check", () => {
  it("runs through a symlinked path and flags a forbidden file", () => {
    const repo = path.join(tmp, "repo");
    const scripts = path.join(repo, "packages/code-graph/scripts");
    fs.mkdirSync(scripts, { recursive: true });
    fs.mkdirSync(path.join(repo, "plugin"), { recursive: true });
    fs.copyFileSync(CLEAN, path.join(scripts, "check-plugin-clean.mjs"));
    fs.writeFileSync(path.join(repo, "plugin/CLAUDE.md"), "x");
    const link = path.join(tmp, "repo-link");
    fs.symlinkSync(repo, link, "dir");
    const r = run(path.join(link, "packages/code-graph/scripts/check-plugin-clean.mjs"));
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /CLAUDE\.md/);
  });

  it("does nothing when imported", () => {
    const r = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(CLEAN).href)});`],
      { encoding: "utf8" }
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
  });
});
