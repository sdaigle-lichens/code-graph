// Task 079: under the unattended marker the CLI refuses `enrich prune --yes`, `delete-concept --yes`
// (without --keep-enriched) and a --root outside the run's project: exit 1, one stderr line, no file
// changed. The same commands work without the marker, and `delete-concept --yes --keep-enriched` stays
// allowed under it (the unattended run's own removal). Runs the built CLI in a real temp project.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { unattendedRefusal } from "./unattended-guard.js";
import { assertDist, buildBehindProject, cg, cleanEnv, enrich, makeBase, mustCg } from "./update-fixture.js";

let base: string;
let root: string;
let other: string;

const marked = () => cleanEnv({ CODE_GRAPH_UNATTENDED: "1", CODE_GRAPH_UNATTENDED_ROOT: root });
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

before(() => {
  assertDist();
  base = makeBase("cg-guard-");
  root = buildBehindProject(base);
  other = path.join(base, "other-project");
  fs.mkdirSync(other);
  mustCg(root, ["extract", "alpha", "beta"]);
  mustCg(root, ["apply", "alpha", "beta"]);
  enrich(root, base, "beta", { shout: "Upper-cases a label for display." });
});
after(() => fs.rmSync(base, { recursive: true, force: true }));

function oneLine(stderr: string): void {
  assert.equal(stderr.trim().split("\n").length, 1, `one stderr line: ${stderr}`);
}

describe("unattendedRefusal (pure)", () => {
  it("refuses nothing without the marker", () => {
    assert.equal(unattendedRefusal("enrich prune", { yes: true }, {}), null);
    assert.equal(unattendedRefusal("delete-concept", { yes: true }, {}), null);
    assert.equal(unattendedRefusal("root", { root: "/elsewhere" }, {}), null);
  });
  it("lets a dry-run prune, a keep-enriched delete and a --root inside the project through", () => {
    const env = { CODE_GRAPH_UNATTENDED: "1", CODE_GRAPH_UNATTENDED_ROOT: root };
    assert.equal(unattendedRefusal("enrich prune", { yes: false }, env), null);
    assert.equal(unattendedRefusal("delete-concept", { yes: true, keepEnriched: true }, env), null);
    assert.equal(unattendedRefusal("root", { root }, env), null);
    assert.equal(unattendedRefusal("root", { root: path.join(root, "src") }, env), null);
  });
  it("refuses a plain delete-concept --yes and a --root outside the project", () => {
    const env = { CODE_GRAPH_UNATTENDED: "1", CODE_GRAPH_UNATTENDED_ROOT: root };
    assert.match(
      unattendedRefusal("delete-concept", { yes: true, keepEnriched: false }, env) ?? "",
      /without --keep-enriched/
    );
    assert.match(unattendedRefusal("root", { root: other }, env) ?? "", /outside the unattended run's project/);
  });
});

describe("the unattended marker refuses destructive commands", () => {
  it("enrich prune --yes: exit 1, one line, enriched file untouched; works without the marker", () => {
    const before = read("scribe-output/beta.enriched.json");
    const r = cg(root, ["enrich", "prune", "beta", "--yes"], marked());
    assert.equal(r.code, 1, r.stderr);
    oneLine(r.stderr);
    assert.match(r.stderr, /enrich prune --yes is refused/);
    assert.equal(read("scribe-output/beta.enriched.json"), before);
    assert.equal(cg(root, ["enrich", "prune", "beta"], marked()).code, 0, "the dry run is allowed");
    assert.equal(cg(root, ["enrich", "prune", "beta", "--yes"]).code, 0, "no marker: it works");
  });

  it("delete-concept --yes (plain): exit 1, one line, config and artifacts untouched", () => {
    const config = read("scribe.config.json");
    const ast = read("scribe-output/beta.ast.json");
    const r = cg(root, ["delete-concept", "beta", "--yes"], marked());
    assert.equal(r.code, 1, r.stderr);
    oneLine(r.stderr);
    assert.match(r.stderr, /delete-concept --yes is refused/);
    assert.equal(read("scribe.config.json"), config);
    assert.equal(read("scribe-output/beta.ast.json"), ast);
    assert.equal(fs.existsSync(path.join(root, "scribe-output/beta.enriched.json")), true);
  });

  it("delete-concept --yes --keep-enriched stays allowed under the marker: moves the enriched file, exit 0", () => {
    const enriched = read("scribe-output/beta.enriched.json");
    const r = cg(root, ["delete-concept", "beta", "--yes", "--keep-enriched"], marked());
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!JSON.parse(read("scribe.config.json")).concepts.beta, "beta left the config");
    assert.equal(fs.existsSync(path.join(root, "scribe-output/beta.enriched.json")), false, "moved out of place");
    assert.equal(read("scribe-output/deleted/beta.enriched.json"), enriched, "moved, never deleted");
  });

  it("--root outside the run's project: exit 1, one line, nothing written", () => {
    const r = cg(root, ["--root", other, "extract", "--all"], marked());
    assert.equal(r.code, 1, r.stderr);
    oneLine(r.stderr);
    assert.match(r.stderr, /--root .* is outside the unattended run's project/);
    assert.deepEqual(fs.readdirSync(other), []);
    assert.equal(cg(root, ["--root", root, "skills", "status", "--summary"], marked()).code, 0, "its own root is fine");
  });

  it("--root given relatively: a sibling is refused, '.' (the project) is allowed", () => {
    const r = cg(root, ["--root", "../other-project", "extract", "--all"], marked());
    assert.equal(r.code, 1, r.stderr);
    oneLine(r.stderr);
    assert.match(r.stderr, /outside the unattended run's project/);
    assert.equal(cg(root, ["--root", ".", "skills", "status", "--summary"], marked()).code, 0);
  });

  it("--root through a symlink: a link to the project is allowed, a link out of it is refused", () => {
    const inside = path.join(base, "link-in");
    const outside = path.join(base, "link-out");
    fs.symlinkSync(root, inside, "dir");
    fs.symlinkSync(other, outside, "dir");
    assert.equal(cg(root, ["--root", inside, "skills", "status", "--summary"], marked()).code, 0);
    const r = cg(root, ["--root", outside, "extract", "--all"], marked());
    assert.equal(r.code, 1, r.stderr);
    oneLine(r.stderr);
    assert.deepEqual(fs.readdirSync(other), []);
  });

  it("the marker without CODE_GRAPH_UNATTENDED_ROOT falls back to the cwd as the project", () => {
    const env = cleanEnv({ CODE_GRAPH_UNATTENDED: "1" });
    const r = cg(root, ["--root", other, "extract", "--all"], env);
    assert.equal(r.code, 1, r.stderr);
    oneLine(r.stderr);
    assert.deepEqual(fs.readdirSync(other), []);
  });

  it("without the marker, a plain delete-concept --yes works", () => {
    const r = cg(root, ["delete-concept", "alpha", "--yes"]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!JSON.parse(read("scribe.config.json")).concepts.alpha, "alpha left the config");
  });
});
