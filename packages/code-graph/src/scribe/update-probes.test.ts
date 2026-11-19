// QA probes for the unattended update run (task 078, round 2). Each case uses a real temp git repo, a real
// store and the built CLI; only `claude` (an injected ClaudeRun, or a fake `claude` script first on PATH for
// the detached runner) and the clock/spawner are injected. They pin the cases the round-1 suite did not
// cover: a refused report write with a writable state file (state `refused`, stderr line, hook announce), a
// created SKILL.md removed after a failed extract, the scribe claim followed by a real SubagentStop-style
// hook run, and what a fully read-only state directory leaves behind.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  type ClaudeRun,
  claimUpdateRun,
  maybeStartUpdate,
  runUpdate,
  UPDATE_REPORT_FILE,
  updateHookMessage,
} from "./update-run.js";
import { type CliRun, nodeCli, stagingDirFor } from "./update-staging.js";
import {
  DIST,
  assertDist,
  buildBehindProject,
  cg,
  cleanEnv,
  fakeClaudeOnPath,
  makeBase,
  readRel,
  stagingFromPrompt,
  stageSkill,
  stateOf,
  waitFor,
  writeManifest,
  writeRel,
} from "./update-fixture.js";

const REVISED =
  "---\nname: alpha\ndescription: Pricing helpers (alpha concept).\n---\n\n# alpha\n\n" +
  "`src/alpha/a.ts` exports `computeTotal(prices)`, the sum of the line prices.\n\n" +
  "The total is the sum of the line prices, before any discount.\n";
const GAMMA_SKILL =
  "---\nname: gamma\ndescription: Doubling helpers (gamma concept).\n---\n\n# gamma\n\n`src/gamma/g.ts` exports `doubled(n)`.\n";

const RESTORE: (() => void)[] = [];
let base: string;
let root: string;
let stateDir: string;
let staging: string;

beforeEach(() => {
  assertDist();
  base = makeBase("cg-probe-");
  root = buildBehindProject(base);
  stateDir = path.join(root, "scribe-output");
  staging = stagingDirFor(stateDir);
});
afterEach(() => {
  for (const undo of RESTORE.splice(0).reverse()) {
    try {
      undo();
    } catch {
      // the test already removed the path
    }
  }
  fs.rmSync(base, { recursive: true, force: true });
});

/** A claude process that stages what `write` says and exits `code`. */
function session(write: (staging: string) => void, code = 0): ClaudeRun {
  return async (args) => {
    write(stagingFromPrompt(args[args.indexOf("-p") + 1] as string));
    return { code, stdout: "session output", stderr: "" };
  };
}

/** Captures what the runner writes to process.stderr while `fn` runs. */
async function captureStderr<T>(fn: () => Promise<T>): Promise<{ result: T; stderr: string }> {
  const real = process.stderr.write.bind(process.stderr);
  let stderr = "";
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    stderr += String(s);
    return true;
  };
  try {
    const result = await fn();
    return { result, stderr };
  } finally {
    (process.stderr as unknown as { write: typeof real }).write = real;
  }
}

describe("probe: a refused report write with a writable state file", () => {
  it("the run ends INCOMPLETE, the state records refused and complete:false, stderr names the path, and the next stop announces it", async () => {
    // The report path is a read-only file: the install still runs (scribe-output is writable), the report write is refused.
    writeRel(root, "scribe-output/" + UPDATE_REPORT_FILE, "previous report\n");
    const reportPath = path.join(stateDir, UPDATE_REPORT_FILE);
    fs.chmodSync(reportPath, 0o444);
    RESTORE.push(() => fs.chmodSync(reportPath, 0o644));

    const claim = claimUpdateRun(stateDir, {
      by: "hook",
      concepts: ["alpha"],
      now: Date.now(),
      interval: 0,
      keepLock: true,
    });
    assert.equal(claim.claimed, true);
    const { result: code, stderr } = await captureStderr(() =>
      runUpdate(root, claim.claimed ? claim.token : "", ["alpha"], {
        claude: session((s) => {
          stageSkill(s, "alpha", REVISED);
          writeManifest(s, [{ id: "alpha", action: "revised" }]);
        }),
        env: cleanEnv(),
        cliScript: DIST,
        cli: nodeCli(DIST, root),
      })
    );

    assert.equal(code, 0, "claude exited 0; the refused report write does not change claude's exit");
    const state = stateOf(root) as Record<string, unknown>;
    assert.equal(typeof state.finishedAt, "number", "the state file records that the run finished");
    assert.equal(state.complete, false, "a run whose report could not be written is not complete");
    assert.match(
      String(state.refused),
      /^EACCES on .*update-skills-report\.md: the hook runner was sandboxed/,
      "the state file names the refused path"
    );
    assert.match(stderr, /INCOMPLETE; EACCES on .*update-skills-report\.md/, "stderr names the refused path");
    assert.equal(fs.existsSync(path.join(stateDir, ".refresh-skills.lock")), false, "the lock is released");
    assert.equal(
      readRel(root, "scribe-output/" + UPDATE_REPORT_FILE),
      "previous report\n",
      "the old report is untouched"
    );

    // The next stop reads the finished state and says so once.
    const next = await maybeStartUpdate(root, {
      env: cleanEnv(),
      now: () => Date.now(),
      behind: async () => [],
      head: async () => "deadbeef",
      claudeAvailable: () => true,
      spawn: () => assert.fail("nothing to start"),
    });
    const message = updateHookMessage(next) ?? "";
    assert.match(message, /finished \(exit 0, incomplete/, "the hook announces the incomplete run");
  });
});

describe("probe: a created SKILL.md is removed when the graph refresh fails", () => {
  it("gamma's new SKILL.md is deleted (no stamp left), the run is INCOMPLETE, and the status command still runs", async () => {
    const configPath = path.join(root, "scribe.config.json");
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8")) as { concepts: Record<string, unknown> };
    writeRel(
      root,
      "src/gamma/g.ts",
      "/** Doubles a number. */\nexport function doubled(n: number): number {\n  return n * 2;\n}\n"
    );
    const calls: string[][] = [];
    const real = nodeCli(DIST, root);
    const cli: CliRun = async (args) => {
      calls.push(args);
      if (args[0] === "extract" && args.includes("gamma"))
        return { code: 1, stdout: "", stderr: "error: extract gamma broke" };
      return real(args);
    };
    const claim = claimUpdateRun(stateDir, {
      by: "hook",
      concepts: ["alpha"],
      now: Date.now(),
      interval: 0,
      keepLock: true,
    });
    assert.equal(claim.claimed, true);
    const code = await runUpdate(root, claim.claimed ? claim.token : "", ["alpha"], {
      claude: session((s) => {
        cfg.concepts.gamma = { globs: ["src/gamma/**"], skill: ".claude/skills/gamma/SKILL.md" };
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");
        stageSkill(s, "gamma", GAMMA_SKILL);
        writeManifest(s, [
          { id: "alpha", action: "untouched", reason: "no change" },
          { id: "gamma", action: "created", reason: "a new directory of code" },
        ]);
      }),
      env: cleanEnv(),
      cliScript: DIST,
      cli,
    });

    assert.equal(code, 0);
    assert.equal(
      fs.existsSync(path.join(root, ".claude/skills/gamma/SKILL.md")),
      false,
      "the created SKILL.md is removed"
    );
    assert.ok(
      calls.some((a) => a[0] === "skills" && a[1] === "stamp" && a.includes("gamma") && a.includes("initial")),
      "it was stamped before the refresh"
    );
    const report = readRel(root, "scribe-output/" + UPDATE_REPORT_FILE);
    assert.match(report, /^- result: INCOMPLETE/m);
    assert.match(report, /^- gamma: \.claude\/skills\/gamma\/SKILL\.md restored, not stamped/m);
    assert.equal(
      calls.some((a) => a[0] === "skills" && a[1] === "stamp" && !a.includes("gamma") && !a.includes("alpha")),
      false,
      "no repo-level stamp"
    );
    assert.equal((stateOf(root) as Record<string, unknown>).complete, false);
    // Task 079: the failed run rolls the declaration back too.
    const after = JSON.parse(fs.readFileSync(configPath, "utf8")) as { concepts: Record<string, unknown> };
    assert.ok(!("gamma" in after.concepts), "config no longer declares gamma (rolled back)");
    const status = cg(root, ["skills", "status", "--summary"]);
    assert.equal(
      status.code,
      0,
      `skills status still runs with a declared concept whose SKILL.md was removed: ${status.stderr}`
    );
  });
});

describe("probe: a scribe session's claim and the SubagentStop hook, through the real CLI", () => {
  it("control: the hook alone, with a concept behind HEAD, starts one run (a fake claude is called once)", async () => {
    const log = path.join(base, "claude.log");
    const env = cleanEnv(fakeClaudeOnPath(base, log, 0));
    const r = cg(root, ["refresh-skills", "--hook"], env);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /started an unattended update-concept-skills run/);
    await waitFor(() => typeof (stateOf(root) as Record<string, unknown> | null)?.finishedAt === "number");
    assert.equal(fs.readFileSync(log, "utf8").split("\n").filter(Boolean).length, 1, "claude was called once");
  });

  it("a session claim blocks the SubagentStop hook for the same work, and the finished session run blocks it within the interval", () => {
    const log = path.join(base, "claude2.log");
    const env = cleanEnv(fakeClaudeOnPath(base, log, 0));
    const claim = cg(root, ["refresh-skills", "--claim-update", "--concepts", "alpha"], env);
    assert.equal(claim.code, 0, claim.stderr);
    const hook1 = cg(root, ["refresh-skills", "--hook"], env);
    assert.equal(hook1.code, 0);
    assert.doesNotMatch(
      hook1.stdout,
      /started an unattended/,
      "the hook starts nothing while the session holds the run"
    );
    assert.equal(fs.existsSync(log), false, "claude was not called");
    const fin = cg(root, ["refresh-skills", "--finish-update"], env);
    assert.equal(fin.code, 0, fin.stderr);
    const hook2 = cg(root, ["refresh-skills", "--hook"], env);
    assert.doesNotMatch(
      hook2.stdout,
      /started an unattended/,
      "within the interval after the session run, nothing starts"
    );
    assert.equal(fs.existsSync(log), false);
  });

  it("a fresh refresh-skills lock (a scribe run in progress) makes the hook start nothing", () => {
    const log = path.join(base, "claude3.log");
    const env = cleanEnv(fakeClaudeOnPath(base, log, 0));
    fs.writeFileSync(path.join(stateDir, ".refresh-skills.lock"), "someone-else\n");
    const hook = cg(root, ["refresh-skills", "--hook"], env);
    assert.equal(hook.code, 0);
    assert.doesNotMatch(hook.stdout, /started an unattended/);
    assert.equal(fs.existsSync(log), false);
  });
});

describe("probe: a fully read-only state directory", () => {
  it("the runner does not throw, claude is not started, the state file (writable in place) records the refusal, and the lock is left behind", async () => {
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
    let claudeCalled = false;
    const { result: code, stderr } = await captureStderr(() =>
      runUpdate(root, claim.claimed ? claim.token : "", ["alpha"], {
        claude: async () => {
          claudeCalled = true;
          return { code: 0, stdout: "", stderr: "" };
        },
        env: cleanEnv(),
        cliScript: DIST,
      })
    );
    assert.equal(claudeCalled, false, "claude is not started when the staging dir cannot be reset");
    assert.equal(code, null);
    assert.match(stderr, /INCOMPLETE; EACCES on .*update-skills-report\.md/, "stderr names the refused path");
    const state = stateOf(root) as Record<string, unknown>;
    assert.equal(
      typeof state.finishedAt,
      "number",
      "the existing state file is rewritten in place, so the finish is recorded"
    );
    assert.equal(state.complete, false);
    assert.match(String(state.refused), /^EACCES on .*update-skills-report\.md: the hook runner was sandboxed/);
    assert.equal(
      fs.existsSync(path.join(stateDir, ".refresh-skills.lock")),
      true,
      "the lock cannot be unlinked in a read-only dir: left behind"
    );

    const next = await maybeStartUpdate(root, {
      env: cleanEnv(),
      now: () => Date.now(),
      behind: async () => ["alpha"],
      head: async () => "deadbeef",
      claudeAvailable: () => true,
      spawn: () => assert.fail("no run may start inside the minimum interval"),
    });
    assert.equal(next.started, false);
    assert.match(
      next.reason ?? "",
      /minimum interval/,
      "the next stop starts nothing (interval), so no token is spent"
    );
    // Observed: the finished-and-incomplete announcement needs the lock, which is still held, so the next stop is silent.
    assert.equal(updateHookMessage(next), null, "the announcement is deferred while the lock is held");
  });
});
