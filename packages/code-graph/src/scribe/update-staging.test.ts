// The unattended run's install step (update-staging.ts) and the runner around it (runUpdate): the
// fail-safes (a failed or missing staged file, a missing manifest, a claude that did not exit 0) leave
// every SKILL.md and scribe.config.json byte-identical and never advance the repo-level record; a refused
// write (EACCES, a stamp exit 9, a read-only graph store) ends the run INCOMPLETE and names the refused
// path; automatic adds, removals and renames keep their enriched data. The claude process is the only
// injected piece (a session that writes the staging directory); the CLI each step runs is the real built
// CLI, and a CLI wrapper only changes the filesystem (a chmod) between two real steps where a test needs a
// refusal the sandbox would produce.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { type ClaudeRun, claimUpdateRun, runUpdate, UPDATE_REPORT_FILE } from "./update-run.js";
import { type CliRun, nodeCli, stagingDirFor } from "./update-staging.js";
import {
  ALPHA_SKILL,
  DIST,
  assertDist,
  buildBehindProject,
  cg,
  cleanEnv,
  enrich,
  enrichedKeys,
  makeBase,
  readRel,
  stagingFromPrompt,
  stateOf,
  stageSkill,
  writeManifest,
  writeRel,
} from "./update-fixture.js";

const REVISED = ALPHA_SKILL + "\nThe total is the sum of the line prices, before any discount.\n";
const RESTORE: (() => void)[] = [];
let base: string;
let root: string;
let stateDir: string;
let staging: string;
let alphaSkill: string;

beforeEach(() => {
  assertDist();
  base = makeBase();
  root = buildBehindProject(base);
  stateDir = path.join(root, "scribe-output");
  staging = stagingDirFor(stateDir);
  alphaSkill = path.join(root, ".claude/skills/alpha/SKILL.md");
});
afterEach(() => {
  for (const undo of RESTORE.splice(0).reverse()) {
    try {
      undo();
    } catch {
      // the path was removed by the test itself
    }
  }
  fs.rmSync(base, { recursive: true, force: true });
});

/** A claude process that writes what `write` stages and exits `code`. The prompt's staging dir is the one used. */
function session(write: (staging: string) => void, code = 0): ClaudeRun {
  return async (args) => {
    write(stagingFromPrompt(args[args.indexOf("-p") + 1] as string));
    return { code, stdout: "session output", stderr: "" };
  };
}

/** The real CLI, with a log of every call and an optional hook that runs before each call (a chmod). */
function recordingCli(calls: string[][], before?: (args: string[]) => void): CliRun {
  const real = nodeCli(DIST, root);
  return async (args) => {
    calls.push(args);
    before?.(args);
    return real(args);
  };
}

/** One runner pass for `concepts` (default alpha), claimed the way the hook claims it. */
async function runOnce(claude: ClaudeRun, o: { cli?: CliRun; concepts?: string[] } = {}) {
  const claim = claimUpdateRun(stateDir, {
    by: "hook",
    concepts: ["alpha"],
    now: Date.now(),
    interval: 0,
    keepLock: true,
  });
  assert.equal(claim.claimed, true, claim.claimed ? "" : claim.reason);
  const code = await runUpdate(root, claim.token, o.concepts ?? ["alpha"], {
    claude,
    env: cleanEnv(),
    cliScript: DIST,
    ...(o.cli ? { cli: o.cli } : {}),
  });
  return {
    code,
    report: readRel(root, path.join("scribe-output", UPDATE_REPORT_FILE)),
    state: stateOf(root),
    lockExists: fs.existsSync(path.join(stateDir, ".refresh-skills.lock")),
  };
}

/** Writes a revised alpha SKILL.md and a manifest that names it. */
function stageRevisedAlpha(s: string): void {
  stageSkill(s, "alpha", REVISED);
  writeManifest(s, [{ id: "alpha", action: "revised" }]);
}

function repoLevelStamps(calls: string[][]): string[][] {
  return calls.filter((a) => a[0] === "skills" && a[1] === "stamp" && !a.some((x) => x === "alpha" || x === "beta"));
}

describe("the install step on a complete run", () => {
  it("installs the staged SKILL.md, stamps it, re-applies it, advances the record and removes the staging dir", async () => {
    const calls: string[][] = [];
    const r = await runOnce(
      session((s) => stageRevisedAlpha(s)),
      { cli: recordingCli(calls) }
    );
    assert.equal(r.code, 0);
    assert.match(r.report, /^- result: complete$/m);
    assert.equal(r.state?.complete, true);
    const installed = readRel(root, ".claude/skills/alpha/SKILL.md");
    assert.ok(installed.includes("before any discount"), "the staged text is what got installed");
    assert.match(installed, /1\.1/, "the revised skill was stamped minor (1.0 to 1.1)");
    assert.ok(calls.some((a) => a[0] === "skills" && a[1] === "stamp" && a.includes("alpha") && a.includes("minor")));
    assert.ok(
      calls.some((a) => a[0] === "extract" && a.includes("alpha")),
      "extract ran on the installed concept"
    );
    assert.ok(
      calls.some((a) => a[0] === "apply" && a.includes("alpha") && a.includes("--approve-unambiguous-renames"))
    );
    assert.equal(repoLevelStamps(calls).length, 1, "the repo-level record advanced once, after the concept");
    assert.equal(fs.existsSync(staging), false, "the staging dir is removed on a complete run");
    assert.equal(r.lockExists, false, "the lock is released");
  });
});

describe("fail-safes: nothing installed, record not advanced, reported INCOMPLETE", () => {
  it("a missing manifest installs nothing, makes no CLI call and names the manifest", async () => {
    const before = readRel(root, ".claude/skills/alpha/SKILL.md");
    const calls: string[][] = [];
    const r = await runOnce(
      session((s) => {
        stageSkill(s, "alpha", REVISED); // staged, but no manifest.json
      }),
      { cli: recordingCli(calls) }
    );
    assert.match(r.report, /^- result: INCOMPLETE/m);
    assert.match(r.report, /no valid manifest\.json in the staging directory/);
    assert.equal(readRel(root, ".claude/skills/alpha/SKILL.md"), before, "alpha's SKILL.md is byte-identical");
    assert.equal(calls.length, 0, "no stamp, extract or apply ran");
    assert.equal(r.state?.complete, false);
    assert.equal(fs.existsSync(staging), true, "the staging dir is kept for the next look");
  });

  it("a manifest entry marked failed installs nothing and blocks the repo-level record", async () => {
    const before = readRel(root, ".claude/skills/alpha/SKILL.md");
    const calls: string[][] = [];
    const r = await runOnce(
      session((s) => {
        writeManifest(s, [{ id: "alpha", action: "failed", reason: "the diff was unreadable" }]);
      }),
      { cli: recordingCli(calls) }
    );
    assert.match(r.report, /^- failed: alpha: the session could not revise it: the diff was unreadable$/m);
    assert.equal(readRel(root, ".claude/skills/alpha/SKILL.md"), before);
    assert.equal(repoLevelStamps(calls).length, 0, "the repo-level record was not advanced");
    assert.equal(r.state?.complete, false);
  });

  it("a concept in scope but missing from the manifest is a failure, not a silent pass", async () => {
    const before = readRel(root, ".claude/skills/alpha/SKILL.md");
    const calls: string[][] = [];
    const r = await runOnce(
      session((s) => {
        writeManifest(s, []); // alpha is in scope and not listed
      }),
      { cli: recordingCli(calls) }
    );
    assert.match(r.report, /^- failed: alpha: missing from the manifest$/m);
    assert.equal(readRel(root, ".claude/skills/alpha/SKILL.md"), before);
    assert.equal(calls.length, 0);
    assert.equal(r.state?.complete, false);
  });

  it("a revised entry with no staged SKILL.md installs nothing for that concept", async () => {
    const before = readRel(root, ".claude/skills/alpha/SKILL.md");
    const r = await runOnce(
      session((s) => {
        writeManifest(s, [{ id: "alpha", action: "revised" }]); // no alpha/SKILL.md staged
      })
    );
    assert.match(r.report, /^- failed: alpha: revised in the manifest but no staged alpha\/SKILL\.md$/m);
    assert.equal(readRel(root, ".claude/skills/alpha/SKILL.md"), before);
    assert.equal(r.state?.complete, false);
  });

  it("a claude run that exits non-zero installs nothing, even when it staged a complete revision", async () => {
    const before = readRel(root, ".claude/skills/alpha/SKILL.md");
    const calls: string[][] = [];
    const r = await runOnce(
      session((s) => stageRevisedAlpha(s), 1),
      { cli: recordingCli(calls) }
    );
    assert.equal(r.code, 1);
    assert.match(r.report, /^- claude exit: 1$/m);
    assert.match(r.report, /claude did not exit 0, so nothing staged was installed/);
    assert.equal(readRel(root, ".claude/skills/alpha/SKILL.md"), before, "nothing was installed");
    assert.equal(calls.length, 0);
    assert.equal(fs.existsSync(path.join(staging, "alpha", "SKILL.md")), true, "the staged work is kept");
    assert.equal(r.state?.complete, false);
  });
});

describe("refused writes end the run INCOMPLETE and name the refused path", () => {
  it("a real EACCES on the installed SKILL.md (read-only file) is refused, named and not stamped", async () => {
    const before = readRel(root, ".claude/skills/alpha/SKILL.md");
    const calls: string[][] = [];
    const r = await runOnce(
      session((s) => {
        stageRevisedAlpha(s);
        fs.chmodSync(alphaSkill, 0o444); // the file the runner must overwrite is not writable
        RESTORE.push(() => fs.chmodSync(alphaSkill, 0o644));
      }),
      { cli: recordingCli(calls) }
    );
    assert.equal(r.code, 0, "claude itself exited 0; the runner refused the install");
    assert.match(r.report, /^- result: INCOMPLETE/m);
    assert.match(r.report, new RegExp(`^- refused: EACCES on ${escapeRe(alphaSkill)}$`, "m"));
    assert.match(r.report, /^- sandboxed: the hook runner was sandboxed/m);
    assert.equal(readRel(root, ".claude/skills/alpha/SKILL.md"), before, "the refused file is unchanged");
    assert.equal(calls.length, 0, "nothing was stamped or applied after the refusal");
    assert.equal(r.state?.complete, false);
  });

  it("a stamp refused with EACCES (exit 9) is named with its path and blocks the repo-level record", async () => {
    const calls: string[][] = [];
    const r = await runOnce(
      session((s) => stageRevisedAlpha(s)),
      {
        cli: recordingCli(calls, (args) => {
          // Between the install (a writable copy) and the stamp (a write into the same file), the file
          // becomes read-only: the stamp is refused, as a sandboxed write would be.
          if (args[0] === "skills" && args[1] === "stamp" && args.includes("alpha")) {
            fs.chmodSync(alphaSkill, 0o444);
            RESTORE.push(() => fs.chmodSync(alphaSkill, 0o644));
          }
        }),
      }
    );
    assert.match(r.report, /^- result: INCOMPLETE/m);
    assert.match(r.report, new RegExp(escapeRe(alphaSkill)), "the refused SKILL.md path is named");
    assert.equal(repoLevelStamps(calls).length, 0, "no repo-level stamp after a refused stamp");
    assert.equal(r.state?.complete, false);
  });

  it("a read-only graph store is reported as SQLITE_READONLY naming graph.db, and the run is INCOMPLETE", async () => {
    const dbPath = path.join(stateDir, "graph.db");
    const r = await runOnce(
      session((s) => stageRevisedAlpha(s)),
      {
        cli: recordingCli([], (args) => {
          if (args[0] === "apply") {
            fs.chmodSync(dbPath, 0o444);
            RESTORE.push(() => fs.chmodSync(dbPath, 0o644));
          }
        }),
      }
    );
    assert.match(r.report, /^- result: INCOMPLETE/m);
    assert.match(r.report, new RegExp(`^- refused: SQLITE_READONLY on ${escapeRe(dbPath)}$`, "m"));
    assert.equal(r.state?.complete, false);
  });
});

describe("a failed graph refresh leaves no fresh stamp", () => {
  for (const failing of ["extract", "apply"] as const) {
    it(`a failed ${failing} after the install restores the SKILL.md (stamp included) and ends INCOMPLETE`, async () => {
      const before = readRel(root, ".claude/skills/alpha/SKILL.md");
      const calls: string[][] = [];
      const real = recordingCli(calls);
      const r = await runOnce(
        session((s) => stageRevisedAlpha(s)),
        {
          cli: async (args) =>
            args[0] === failing
              ? (calls.push(args), { code: 1, stdout: "", stderr: `error: ${failing} broke` })
              : real(args),
        }
      );
      assert.ok(
        calls.some((a) => a[0] === "skills" && a[1] === "stamp" && a.includes("alpha")),
        "the stamp ran before the refresh"
      );
      assert.match(r.report, /^- result: INCOMPLETE/m);
      assert.match(r.report, new RegExp(`^- failed: ${failing} alpha.* exited 1: error: ${failing} broke$`, "m"));
      assert.match(r.report, /^- alpha: \.claude\/skills\/alpha\/SKILL\.md restored, not stamped/m);
      assert.equal(readRel(root, ".claude/skills/alpha/SKILL.md"), before, "no revision or fresh stamp is left");
      assert.equal(repoLevelStamps(calls).length, 0, "the repo-level record was not advanced");
      assert.equal(fs.existsSync(path.join(staging, "alpha", "SKILL.md")), true, "the revision is kept in staging");
      assert.equal(r.state?.complete, false);
      assert.equal(r.lockExists, false);
    });
  }
});

describe("a read-only run directory", () => {
  it("when the state dir cannot be written, the runner does not throw: it ends the run and releases the lock", async () => {
    const claim = claimUpdateRun(stateDir, {
      by: "hook",
      concepts: ["alpha"],
      now: Date.now(),
      interval: 0,
      keepLock: true,
    });
    assert.equal(claim.claimed, true);
    fs.chmodSync(stateDir, 0o555);
    RESTORE.push(() => fs.chmodSync(stateDir, 0o755));
    let threw: unknown = null;
    let code: number | null | undefined;
    try {
      code = await runUpdate(root, claim.token, ["alpha"], {
        claude: session(() => {}),
        env: cleanEnv(),
        cliScript: DIST,
      });
    } catch (err) {
      threw = err;
    }
    assert.equal(threw, null, `runUpdate must not throw on a read-only state dir: ${(threw as Error | null)?.message}`);
    assert.equal(code, null, "claude was never started (its staging dir could not be created)");
  });
});

describe("automatic adds, removals and renames keep their enriched data", () => {
  it("an added concept (a new directory of code) is installed, stamped 1.0 and built, with no question", async () => {
    // The session edits scribe.config.json (the one config edit the allowlist grants) and stages the new skill.
    const configPath = path.join(root, "scribe.config.json");
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8")) as { concepts: Record<string, unknown> };
    writeRel(
      root,
      "src/gamma/g.ts",
      "/** Doubles a number. */\nexport function doubled(n: number): number {\n  return n * 2;\n}\n"
    );
    const GAMMA_SKILL =
      "---\nname: gamma\ndescription: Doubling helpers (gamma concept).\n---\n\n# gamma\n\n`src/gamma/g.ts` exports `doubled(n)`.\n";
    const r = await runOnce(
      session((s) => {
        cfg.concepts.gamma = { globs: ["src/gamma/**"], skill: ".claude/skills/gamma/SKILL.md" };
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");
        stageSkill(s, "gamma", GAMMA_SKILL);
        writeManifest(s, [
          { id: "alpha", action: "untouched", reason: "no change" },
          { id: "gamma", action: "created", reason: "a new directory of code" },
        ]);
      }),
      { concepts: ["alpha"] }
    );
    assert.equal(r.state?.complete, true, `the add completes: ${r.report}`);
    assert.match(readRel(root, ".claude/skills/gamma/SKILL.md"), /1\.0/);
    assert.ok(fs.existsSync(path.join(root, "scribe-output", "gamma.ast.json")), "gamma was extracted");
  });

  it("a run that adds a concept and then fails leaves scribe.config.json and the SKILL.md as it found them", async () => {
    const configPath = path.join(root, "scribe.config.json");
    const configBefore = fs.readFileSync(configPath, "utf8");
    const cfg = JSON.parse(configBefore) as { concepts: Record<string, unknown> };
    writeRel(
      root,
      "src/gamma/g.ts",
      "/** Doubles. */\nexport function doubled(n: number): number {\n  return n * 2;\n}\n"
    );
    const real = nodeCli(DIST, root);
    const failingApply: CliRun = async (args) =>
      args[0] === "apply" ? { code: 1, stdout: "", stderr: "error: boom" } : real(args);
    const r = await runOnce(
      session((s) => {
        cfg.concepts.gamma = { globs: ["src/gamma/**"], skill: ".claude/skills/gamma/SKILL.md" };
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");
        stageSkill(s, "gamma", "---\nname: gamma\ndescription: Doubling (gamma).\n---\n\n# gamma\n\n`doubled`.\n");
        writeManifest(s, [
          { id: "alpha", action: "untouched" },
          { id: "gamma", action: "created" },
        ]);
      }),
      { cli: failingApply }
    );
    assert.equal(r.state?.complete, false);
    assert.equal(fs.readFileSync(configPath, "utf8"), configBefore, "config as the run found it");
    assert.equal(fs.existsSync(path.join(root, ".claude/skills/gamma/SKILL.md")), false, "no SKILL.md left");
    assert.match(r.report, /gamma: removed from scribe\.config\.json/);
  });

  // The same rollback at the other two points a run can fail after it declared a concept: its extract, and
  // its install stamp (the SKILL.md stamp that runs before the refresh).
  const failurePoints: [string, (args: string[]) => boolean][] = [
    ["extract", (args) => args[0] === "extract"],
    ["the install stamp", (args) => args[0] === "skills" && args.includes("initial")],
  ];
  for (const [stage, fails] of failurePoints) {
    it(`a run that adds a concept and fails at ${stage} leaves scribe.config.json and the SKILL.md as it found them`, async () => {
      const configPath = path.join(root, "scribe.config.json");
      const configBefore = fs.readFileSync(configPath, "utf8");
      const cfg = JSON.parse(configBefore) as { concepts: Record<string, unknown> };
      writeRel(
        root,
        "src/gamma/g.ts",
        "/** Doubles. */\nexport function doubled(n: number): number {\n  return n * 2;\n}\n"
      );
      const real = nodeCli(DIST, root);
      const failing: CliRun = async (args) =>
        fails(args) ? { code: 1, stdout: "", stderr: "error: boom" } : real(args);
      const r = await runOnce(
        session((s) => {
          cfg.concepts.gamma = { globs: ["src/gamma/**"], skill: ".claude/skills/gamma/SKILL.md" };
          fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");
          stageSkill(s, "gamma", "---\nname: gamma\ndescription: Doubling (gamma).\n---\n\n# gamma\n\n`doubled`.\n");
          writeManifest(s, [
            { id: "alpha", action: "untouched" },
            { id: "gamma", action: "created" },
          ]);
        }),
        { cli: failing }
      );
      assert.equal(r.state?.complete, false);
      assert.match(r.report, /failed: .*exited 1/, "the report names the failed step");
      assert.equal(fs.readFileSync(configPath, "utf8"), configBefore, "config as the run found it");
      assert.equal(fs.existsSync(path.join(root, ".claude/skills/gamma/SKILL.md")), false, "no SKILL.md left");
    });
  }

  it("a removed concept keeps its enriched entries: delete-concept --keep-enriched moves them, none lost", () => {
    // Build beta's graph and enrich one of its vertices, then remove beta the way the skill does.
    const betaKeysBefore = (() => {
      cg(root, ["extract", "beta"]);
      cg(root, ["apply", "beta"]);
      enrich(root, base, "beta", { shout: "Upper-cases a label for display." });
      return enrichedKeys(root, "beta");
    })();
    assert.equal(betaKeysBefore.length, 1);
    const r = cg(root, ["delete-concept", "beta", "--yes", "--keep-enriched"]);
    assert.equal(r.code, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /kept:\s+scribe-output\/beta\.enriched\.json moved to scribe-output\/deleted\//);
    assert.equal(fs.existsSync(path.join(root, "scribe-output", "beta.enriched.json")), false);
    const kept = fs
      .readdirSync(path.join(root, "scribe-output", "deleted"))
      .filter((f) => f.startsWith("beta") && f.endsWith(".enriched.json"));
    assert.equal(kept.length, 1, "one kept enriched file");
    const doc = JSON.parse(fs.readFileSync(path.join(root, "scribe-output", "deleted", kept[0] as string), "utf8")) as {
      vertices: { _key: string }[];
    };
    assert.deepEqual(
      doc.vertices.map((v) => v._key),
      betaKeysBefore,
      "every enriched entry survives the removal"
    );
    assert.ok(
      !JSON.parse(fs.readFileSync(path.join(root, "scribe.config.json"), "utf8")).concepts.beta,
      "beta left the config"
    );
  });
});

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
