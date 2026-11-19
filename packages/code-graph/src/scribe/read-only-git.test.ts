// `code-graph git diff|log|show`: the unattended run's only way to read history. The built CLI runs real
// git in a real temp repo; --output (which writes any file) is refused before git starts, in every
// spelling the shell can hand over, and the history output is unchanged otherwise.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gitSafeEnv, refusedGitCall } from "./read-only-git.js";
import { assertDist, buildBehindProject, cg, cleanEnv, git, makeBase } from "./update-fixture.js";

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

describe("code-graph git strips the GIT_* configuration environment", () => {
  it("gitSafeEnv drops the program-running variables and keeps the rest", () => {
    const env = gitSafeEnv({
      GIT_EXTERNAL_DIFF: "x",
      GIT_PAGER: "x",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.pager",
      GIT_CONFIG_VALUE_0: "x",
      GIT_CONFIG_PARAMETERS: "'core.pager=x'",
      GIT_CONFIG_GLOBAL: "/x",
      GIT_CONFIG_SYSTEM: "/x",
      GIT_DIR: "/keep",
      PATH: "/bin",
    });
    assert.deepEqual(env, { GIT_DIR: "/keep", PATH: "/bin" });
  });

  it("GIT_EXTERNAL_DIFF is not run by code-graph git diff (but is by plain git, so the test is real)", () => {
    const marker = path.join(base, "ext-diff-ran.txt");
    const script = path.join(base, "ext-diff.sh");
    fs.writeFileSync(script, `#!/bin/sh\necho ran > '${marker}'\n`, { mode: 0o755 });
    const env = cleanEnv({ GIT_EXTERNAL_DIFF: script });
    spawnSync("git", ["diff", "HEAD~1..HEAD"], { cwd: root, env, encoding: "utf8" });
    assert.equal(fs.existsSync(marker), true, "plain git runs the external diff");
    fs.rmSync(marker);
    const r = cg(root, ["git", "diff", "HEAD~1..HEAD"], env);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(fs.existsSync(marker), false, "code-graph git did not run it");
    assert.match(r.stdout, /^diff --git /m, "the builtin diff printed");
  });

  it("a GIT_CONFIG_* core.pager / diff.external is not honoured either", () => {
    const marker = path.join(base, "cfg-ran.txt");
    const script = path.join(base, "cfg.sh");
    fs.writeFileSync(script, `#!/bin/sh\necho ran > '${marker}'\n`, { mode: 0o755 });
    const env = cleanEnv({ GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "diff.external", GIT_CONFIG_VALUE_0: script });
    spawnSync("git", ["diff", "HEAD~1..HEAD"], { cwd: root, env, encoding: "utf8" });
    assert.equal(fs.existsSync(marker), true, "plain git honours the injected diff.external (the test is real)");
    fs.rmSync(marker);
    const r = cg(root, ["git", "diff", "HEAD~1..HEAD"], env);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(fs.existsSync(marker), false);
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
