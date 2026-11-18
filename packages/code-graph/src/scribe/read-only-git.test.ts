// `code-graph git diff|log|show`: the unattended run's only way to read history. The built CLI runs real
// git in a real temp repo; --output (which writes any file) is refused before git starts, in every
// spelling the shell can hand over, and the history output is unchanged otherwise.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { refusedGitCall } from "./read-only-git.js";
import { assertDist, buildBehindProject, cg, git, makeBase } from "./update-fixture.js";

let base: string;
let root: string;

before(() => {
  assertDist();
  base = makeBase("cg-git-");
  root = buildBehindProject(base);
});
after(() => fs.rmSync(base, { recursive: true, force: true }));

describe("code-graph git refuses --output", () => {
  for (const sub of ["diff", "log", "show"]) {
    for (const form of [["--output=OUT"], ["--output", "OUT"], ["--stat", "HEAD~1", "--output=OUT"]]) {
      it(`git ${sub} ${form.join(" ")}: exit 1, nothing written`, () => {
        const out = path.join(base, `out-${sub}.txt`);
        const args = form.map((a) => a.replace("OUT", out));
        const r = cg(root, ["git", sub, ...args]);
        assert.equal(r.code, 1, r.stderr);
        assert.match(r.stderr, /--output.* writes a file/);
        assert.equal(fs.existsSync(out), false, "no file was written");
      });
    }
  }

  it("refuses any other subcommand", () => {
    assert.match(refusedGitCall("push", []) ?? "", /not one of diff, log, show/);
    const r = cg(root, ["git", "commit", "-m", "x"]);
    assert.equal(r.code, 1);
  });

  it("keeps harmless options that only start like it (--output-indicator-new)", () => {
    assert.equal(refusedGitCall("diff", ["--output-indicator-new=+"]), null);
  });

  it("refuses a bare --output with no value (exit 1, nothing written)", () => {
    const r = cg(root, ["git", "diff", "HEAD~1..HEAD", "--output"]);
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /--output writes a file/);
  });

  it("refuses --output placed where the subcommand goes (git --output=OUT diff): nothing written", () => {
    const out = path.join(base, "out-subcommand-slot.txt");
    const r = cg(root, ["git", `--output=${out}`, "diff", "HEAD~1..HEAD"]);
    assert.equal(r.code, 1, r.stderr);
    assert.equal(fs.existsSync(out), false, "no file was written");
  });

  it("git does not take an abbreviated --outp=, so the one refused spelling is the only write (git exits 129, nothing written)", () => {
    const out = path.join(base, "out-abbrev.txt");
    const r = cg(root, ["git", "diff", `--outp=${out}`, "HEAD~1..HEAD"]);
    assert.notEqual(r.code, 0, "git refuses the abbreviation");
    assert.equal(fs.existsSync(out), false, "no file was written");
  });

  it("refuses -c before the subcommand: config cannot be passed through the command", () => {
    const r = cg(root, ["git", "-c", "core.pager=sh", "log", "-1"]);
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /is not one of diff, log, show/);
  });
});

describe("code-graph git reads history like git", () => {
  it("log and diff print what git prints, options and -- kept in order", () => {
    const r = cg(root, ["git", "log", "--oneline", "-1"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, git(root, "log", "--oneline", "-1"));
    const d = cg(root, ["git", "diff", "--name-status", "-M", "HEAD~1..HEAD", "--", "src"]);
    assert.equal(d.code, 0, d.stderr);
    assert.equal(d.stdout.trim(), git(root, "diff", "--name-status", "-M", "HEAD~1..HEAD", "--", "src").trim());
  });
});
