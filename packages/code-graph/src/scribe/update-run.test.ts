// The unattended update-concept-skills run, trigger side: when the Stop hook starts one (behind HEAD,
// minimum interval, refresh-skills lock, off switches), the session claim shared with the SubagentStop
// hook, the headless prompt and permissions, and the report and hook-message lines. Unit cases inject
// the spawner, the clock, the git head, the behind list and the claude CLI lookup; the claude process is
// always injected (no test launches a real `claude`). The CLI cases run the built CLI against real temp
// git repos with a real store, and put a fake `claude` script first on PATH for the detached runner.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  AUTO_UPDATE_OFF_HINT,
  CLAIMED_BY_RUNNER,
  UPDATE_REPORT_FILE,
  UNATTENDED_PERMISSION_MODE,
  type ClaudeRun,
  type TriggerDeps,
  type UpdateLaunch,
  claimUpdateRun,
  finishUpdateRun,
  intervalMs,
  maybeStartUpdate,
  readUpdateState,
  runUpdate,
  unattendedAllowedTools,
  unattendedPrompt,
  updateHookMessage,
} from "./update-run.js";
import { refusedWriteIn, stagingDirFor } from "./update-staging.js";
import { HOOK_TIMEOUT_SECONDS, LOCK_FILE, releaseLock, takeLock } from "./skill-refresh.js";
import { EXIT_UPDATE_NOT_CLAIMED } from "./exit-codes.js";
import {
  DIST,
  PKG,
  assertDist,
  buildBehindProject,
  cg,
  cleanEnv,
  fakeClaudeOnPath,
  makeBase,
  stagingFromPrompt,
  stateOf,
  waitFor,
  writeRel,
} from "./update-fixture.js";

const MIN = 60_000;
// No git diff|log|show: they take --output=<file>; the session reads history through `code-graph git`.
const READ_ONLY_GIT = ["Bash(git status:*)", "Bash(git rev-parse:*)", "Bash(git rev-list:*)", "Bash(git ls-files:*)"];

let base: string;
let root: string;
let clock: number;
let launches: UpdateLaunch[];
let stateDir: string;
let lockPath: string;

beforeEach(() => {
  assertDist();
  base = makeBase();
  root = path.join(base, "repo");
  fs.mkdirSync(root, { recursive: true });
  writeRel(
    root,
    "scribe.config.json",
    JSON.stringify({ project: "t", concepts: { alpha: { globs: ["src/alpha/**"] }, beta: { globs: ["src/beta/**"] } } })
  );
  clock = Date.now();
  launches = [];
  stateDir = path.join(root, "scribe-output");
  lockPath = path.join(stateDir, LOCK_FILE);
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

/** Trigger deps with every external input injected: behind = [alpha], head = HEAD-1, spawn captured. */
function deps(over: TriggerDeps = {}): TriggerDeps {
  return {
    env: cleanEnv(),
    now: () => clock,
    behind: async () => ["alpha"],
    head: async () => "HEAD-1",
    claudeAvailable: () => true,
    spawn: (l) => {
      launches.push(l);
    },
    cliScript: DIST,
    ...over,
  };
}

/** One start through the real trigger; asserts it started and returns the launch it handed the spawner. */
async function startRun(over: TriggerDeps = {}): Promise<UpdateLaunch> {
  const t = await maybeStartUpdate(root, deps(over));
  assert.equal(t.started, true, `expected a start, got: ${t.reason}`);
  return launches[launches.length - 1] as UpdateLaunch;
}

/** What the detached runner does when it ends: mark the run finished and release its lock. */
function runnerEnds(token: string, at: number, complete?: boolean): void {
  finishUpdateRun(stateDir, 0, at, complete);
  releaseLock(lockPath, token);
}

describe("Stop hook trigger: when a run starts", () => {
  it("with a concept behind HEAD, starts exactly one unattended run and records the claim", async () => {
    const t = await maybeStartUpdate(root, deps());
    assert.equal(t.started, true);
    assert.equal(launches.length, 1, "exactly one run handed to the spawner");
    const [launch] = launches as [UpdateLaunch];
    assert.deepEqual(launch.concepts, ["alpha"]);
    assert.equal(launch.root, root);
    assert.equal(launch.stateDir, stateDir);
    assert.equal(launch.cliScript, DIST);
    assert.equal(fs.readFileSync(lockPath, "utf8"), launch.lockToken, "the lock holds the runner's token");
    assert.deepEqual(stateOf(root), { startedAt: clock, by: "hook", concepts: ["alpha"] });
    assert.equal(t.reportPath, "scribe-output/update-skills-report.md");
  });

  it("starts no second run while the first has not finished (within two hours)", async () => {
    await startRun();
    const again = await maybeStartUpdate(root, deps({ now: () => clock + MIN }));
    assert.equal(again.started, false);
    assert.match(again.reason ?? "", /has not finished/);
    assert.equal(launches.length, 1);
  });

  it("starts none within the minimum interval after a finished run, and one again after it", async () => {
    const first = await startRun();
    runnerEnds(first.lockToken, clock + 10 * MIN, true);

    const within = await maybeStartUpdate(root, deps({ now: () => clock + 59 * MIN }));
    assert.equal(within.started, false);
    assert.match(within.reason ?? "", /within the 60-minute minimum interval/);
    assert.equal(launches.length, 1);

    const after = await maybeStartUpdate(root, deps({ now: () => clock + 61 * MIN }));
    assert.equal(after.started, true, `one again after the interval: ${after.reason}`);
    assert.equal(launches.length, 2);
  });

  it("an unfinished run older than two hours counts as dead; a younger one still blocks", async () => {
    const first = await startRun();
    releaseLock(lockPath, first.lockToken); // the dead runner's lock goes stale (here: released at once)
    const young = await maybeStartUpdate(root, deps({ now: () => clock + 119 * MIN }));
    assert.equal(young.started, false);
    assert.match(young.reason ?? "", /has not finished/);
    const old = await maybeStartUpdate(root, deps({ now: () => clock + 121 * MIN }));
    assert.equal(old.started, true, `a 2 h-old unfinished run is dead: ${old.reason}`);
  });

  it("starts none while the refresh-skills lock is held, and leaves the lock alone", async () => {
    fs.mkdirSync(stateDir, { recursive: true });
    const token = takeLock(lockPath);
    assert.ok(token, "test setup: the lock is taken");
    const t = await maybeStartUpdate(root, deps());
    assert.equal(t.started, false);
    assert.match(t.reason ?? "", /holds the lock/);
    assert.equal(launches.length, 0);
    assert.equal(fs.readFileSync(lockPath, "utf8"), token);
    assert.equal(readUpdateState(stateDir), null, "no claim was recorded");
  });

  it("takes over a lock left behind by a run Claude Code already killed (older than the hook timeout)", async () => {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(lockPath, "dead-run-token");
    const old = new Date(Date.now() - (HOOK_TIMEOUT_SECONDS + 60) * 1000);
    fs.utimesSync(lockPath, old, old);
    const t = await maybeStartUpdate(root, deps());
    assert.equal(t.started, true, `a stale lock is taken over: ${t.reason}`);
    assert.notEqual(fs.readFileSync(lockPath, "utf8"), "dead-run-token");
  });

  for (const off of ["0", "false", "off", "no", "OFF"]) {
    it(`CODE_GRAPH_AUTO_UPDATE=${off} turns the trigger off: nothing starts`, async () => {
      const t = await maybeStartUpdate(root, deps({ env: cleanEnv({ CODE_GRAPH_AUTO_UPDATE: off }) }));
      assert.equal(t.started, false);
      assert.match(t.reason ?? "", /disabled by CODE_GRAPH_AUTO_UPDATE/);
      assert.equal(launches.length, 0);
    });
  }

  it("CODE_GRAPH_UNATTENDED=1 (inside an unattended run) starts nothing", async () => {
    const t = await maybeStartUpdate(root, deps({ env: cleanEnv({ CODE_GRAPH_UNATTENDED: "1" }) }));
    assert.equal(t.started, false);
    assert.match(t.reason ?? "", /inside an unattended update run/);
    assert.equal(launches.length, 0);
  });

  it("starts nothing outside git (no head), and nothing without a claude CLI on PATH", async () => {
    const noGit = await maybeStartUpdate(root, deps({ head: async () => "" }));
    assert.equal(noGit.started, false);
    assert.match(noGit.reason ?? "", /not a git repository/);
    const noClaude = await maybeStartUpdate(root, deps({ claudeAvailable: () => false }));
    assert.equal(noClaude.started, false);
    assert.match(noClaude.reason ?? "", /no claude CLI on PATH/);
    assert.equal(launches.length, 0);
  });

  it("starts nothing when no concept is behind HEAD, and remembers that HEAD (no rescan until it moves)", async () => {
    fs.mkdirSync(stateDir, { recursive: true });
    const t = await maybeStartUpdate(root, deps({ behind: async () => [] }));
    assert.equal(t.started, false);
    assert.match(t.reason ?? "", /no concept behind HEAD/);
    assert.equal(fs.readFileSync(path.join(stateDir, ".update-skills.head"), "utf8").trim(), "HEAD-1");
    // Same HEAD: the head file short-circuits before the behind scan, even if one now reports a concept.
    const again = await maybeStartUpdate(root, deps({ behind: async () => ["alpha"] }));
    assert.equal(again.started, false);
    assert.match(again.reason ?? "", /no concept behind HEAD/);
  });

  it("a spawner that throws marks the claim finished, releases the lock and reports it", async () => {
    const t = await maybeStartUpdate(
      root,
      deps({
        spawn: () => {
          throw new Error("boom");
        },
      })
    );
    assert.equal(t.started, false);
    assert.equal(t.reason, "could not start the update run: boom");
    const state = readUpdateState(stateDir);
    assert.ok(state && state.finishedAt !== undefined, "the claim is finished, so it does not block the next stop");
    assert.equal(state?.exitCode, null);
    assert.equal(fs.existsSync(lockPath), false, "the lock is released");
  });
});

describe("interval and the session claim", () => {
  it("the interval comes from the env var, and an explicit minutes value wins over it", () => {
    assert.equal(intervalMs(undefined, {}), 60 * MIN, "the default is 60 minutes");
    assert.equal(intervalMs(undefined, { CODE_GRAPH_UPDATE_INTERVAL_MINUTES: "5" }), 5 * MIN);
    assert.equal(intervalMs(10, { CODE_GRAPH_UPDATE_INTERVAL_MINUTES: "5" }), 10 * MIN);
    assert.equal(
      intervalMs(undefined, { CODE_GRAPH_UPDATE_INTERVAL_MINUTES: "bogus" }),
      60 * MIN,
      "a bad value falls back"
    );
  });

  it("CODE_GRAPH_UPDATE_INTERVAL_MINUTES shortens the gap; --update-interval (intervalMinutes) overrides it", async () => {
    const first = await startRun({ env: cleanEnv({ CODE_GRAPH_UPDATE_INTERVAL_MINUTES: "5" }) });
    runnerEnds(first.lockToken, clock + MIN);
    const env = cleanEnv({ CODE_GRAPH_UPDATE_INTERVAL_MINUTES: "5" });
    const blockedByOverride = await maybeStartUpdate(
      root,
      deps({ env, intervalMinutes: 30, now: () => clock + 10 * MIN })
    );
    assert.equal(blockedByOverride.started, false, "the explicit 30 minutes wins over the env's 5");
    const allowed = await maybeStartUpdate(root, deps({ env, now: () => clock + 10 * MIN }));
    assert.equal(allowed.started, true, `the env's 5 minutes: ${allowed.reason}`);
  });

  it("a session claim and the SubagentStop hook share one run: the hook starts nothing for the same work", () => {
    // Real claim and real hook through the CLI; the fake claude would be the detached runner's, so an
    // unwanted start would be visible as a state change in the same call.
    const env = cleanEnv(fakeClaudeOnPath(base, path.join(base, "claude.log")));
    const claim = cg(root, ["refresh-skills", "--claim-update", "--concepts", "alpha"], env);
    assert.equal(claim.code, 0, claim.stderr);
    assert.match(claim.stdout, /update run claimed for alpha/);
    const before = stateOf(root);
    assert.equal(before?.by, "session");

    const hook = cg(root, ["refresh-skills", "--hook"], env);
    assert.equal(hook.code, 0);
    assert.doesNotMatch(hook.stdout, /started an unattended/);
    assert.deepEqual(stateOf(root), before, "the hook recorded no new claim");

    const second = cg(root, ["refresh-skills", "--claim-update", "--concepts", "alpha"], env);
    assert.equal(second.code, EXIT_UPDATE_NOT_CLAIMED);
    assert.match(second.stdout, /update run not claimed: /);

    const fin = cg(root, ["refresh-skills", "--finish-update"], env);
    assert.equal(fin.code, 0);
    assert.match(fin.stdout, /update run finished/);
    const afterFinish = cg(root, ["refresh-skills", "--hook"], env);
    assert.doesNotMatch(afterFinish.stdout, /started an unattended/, "the interval still blocks after --finish-update");
    const thirdClaim = cg(root, ["refresh-skills", "--claim-update", "--concepts", "alpha"], env);
    assert.equal(thirdClaim.code, EXIT_UPDATE_NOT_CLAIMED);
    assert.match(thirdClaim.stdout, /minimum interval/);
    assert.equal(fs.existsSync(path.join(base, "claude.log")), false, "no runner was started at all");
  });

  it("--update-interval sets the claim's minimum gap (60 minutes by default)", () => {
    const env = cleanEnv();
    assert.equal(cg(root, ["refresh-skills", "--claim-update"], env).code, 0);
    assert.equal(cg(root, ["refresh-skills", "--finish-update"], env).code, 0);
    const byDefault = cg(root, ["refresh-skills", "--claim-update"], env);
    assert.equal(byDefault.code, EXIT_UPDATE_NOT_CLAIMED);
    assert.match(byDefault.stdout, /60-minute minimum interval/);
    const zero = cg(root, ["refresh-skills", "--claim-update", "--update-interval", "0"], env);
    assert.equal(zero.code, 0, zero.stdout);
  });

  it("claimUpdateRun refuses while the previous run is unfinished, and records the claim for the hook", () => {
    fs.mkdirSync(stateDir, { recursive: true });
    const first = claimUpdateRun(stateDir, {
      by: "session",
      concepts: ["alpha"],
      now: clock,
      interval: 60 * MIN,
      keepLock: false,
    });
    assert.equal(first.claimed, true);
    const second = claimUpdateRun(stateDir, {
      by: "session",
      concepts: ["alpha"],
      now: clock + 1,
      interval: 60 * MIN,
      keepLock: false,
    });
    assert.equal(second.claimed, false);
    if (second.claimed) assert.fail("a second claim must be refused");
    assert.match(second.reason, /has not finished/);
    assert.equal(fs.existsSync(lockPath), false, "a session claim releases the lock at once");
  });

  it("a stray --finish-update during a hook run neither finishes it nor overwrites its report", async () => {
    const launch = await startRun();
    const reportPath = path.join(stateDir, UPDATE_REPORT_FILE);
    fs.writeFileSync(reportPath, "previous report\n");
    const before = readUpdateState(stateDir);
    assert.equal(before?.by, "hook");
    const fin = cg(root, ["refresh-skills", "--finish-update"]);
    assert.equal(fin.code, 0, fin.stderr);
    assert.match(fin.stdout, /no unfinished session run/);
    assert.deepEqual(readUpdateState(stateDir), before, "the hook run is still unfinished");
    assert.equal(fs.readFileSync(reportPath, "utf8"), "previous report\n", "the report is untouched");
    assert.equal(fs.readFileSync(lockPath, "utf8"), launch.lockToken, "the runner still holds the lock");
  });
});

describe("the runner: the -p prompt, the claimed line and the headless permissions", () => {
  /** Runs the runner with an injected claude that records its args and runs `session` inside it. */
  async function runWith(
    session: (
      args: string[]
    ) =>
      | Promise<{ code: number | null; stdout: string; stderr: string }>
      | { code: number | null; stdout: string; stderr: string },
    env = cleanEnv()
  ) {
    const launch = await startRun();
    const calls: string[][] = [];
    const claude: ClaudeRun = async (args) => {
      calls.push(args);
      return session(args);
    };
    const code = await runUpdate(launch.root, launch.lockToken, launch.concepts, { claude, env, cliScript: DIST });
    return { launch, calls, code };
  }

  it("the -p prompt carries the claimed line and the staging dir; a claim during the run exits 14", async () => {
    let claimCode: number | null = null;
    const { calls, launch } = await runWith((args) => {
      const prompt = args[args.indexOf("-p") + 1] as string;
      assert.ok(prompt.includes(CLAIMED_BY_RUNNER), "the prompt says the runner holds the claim");
      assert.ok(prompt.includes(`staging: ${stagingDirFor(stateDir)}`), "the prompt names the absolute staging dir");
      const r = spawnSync(process.execPath, [DIST, "refresh-skills", "--claim-update", "--concepts", "alpha"], {
        cwd: root,
        env: cleanEnv(),
        encoding: "utf8",
      });
      claimCode = r.status;
      return { code: 0, stdout: "session done", stderr: "" };
    });
    assert.equal(calls.length, 1, "claude ran once");
    assert.equal(
      claimCode,
      EXIT_UPDATE_NOT_CLAIMED,
      "--claim-update during the run is refused (the runner holds the lock)"
    );
    assert.equal(stagingFromPrompt(calls[0]?.[calls[0].indexOf("-p") + 1] as string), stagingDirFor(stateDir));
    assert.equal(unattendedPrompt(["alpha"], "/s").includes(CLAIMED_BY_RUNNER), true);
    assert.equal(launch.concepts[0], "alpha");
  });

  it("uses permission mode dontAsk (never acceptEdits or bypassPermissions)", async () => {
    const { calls } = await runWith(() => ({ code: 0, stdout: "", stderr: "" }));
    const args = calls[0] as string[];
    assert.equal(args[args.indexOf("--permission-mode") + 1], UNATTENDED_PERMISSION_MODE);
    assert.equal(UNATTENDED_PERMISSION_MODE, "dontAsk");
    assert.ok(!args.some((a) => a === "acceptEdits" || a === "bypassPermissions"));
  });

  it("allows only the scoped Edit rules (staging dir and scribe.config.json), no bare Edit or Write, no Bash(node:*)", async () => {
    const { calls } = await runWith(() => ({ code: 0, stdout: "", stderr: "" }));
    const tools = (calls[0] as string[]).slice((calls[0] as string[]).indexOf("--allowedTools") + 1);
    const staging = stagingDirFor(stateDir);
    // Absolute Edit rules are `Edit(/<abs path>...)`: the path starts with "/", so the rule has "//".
    assert.ok(tools.includes(`Edit(/${staging}/**)`), `staging rule: ${tools.join(" | ")}`);
    assert.ok(tools.includes(`Edit(/${path.join(root, "scribe.config.json")})`), "scribe.config.json rule");
    assert.ok(!tools.includes("Edit") && !tools.includes("Write"), "no bare Edit or Write");
    assert.ok(!tools.some((t) => t.startsWith("Write")), "no Write rule at all");
    assert.ok(!tools.includes("Bash(node:*)"), "no bare node");
    assert.ok(!tools.some((t) => /^Bash\(node:/.test(t)), "no node:* prefix rule");
    assert.ok(tools.includes(`Bash(node ${fs.realpathSync(DIST)}:*)`), "the bundled CLI, by its real path");
    assert.deepEqual(
      tools.filter((t) => t.startsWith("Bash(git ")),
      READ_ONLY_GIT,
      "exactly the read-only git entries"
    );
    assert.ok(!tools.some((t) => /git (add|commit|push|reset|checkout)/.test(t)), "no git add, commit or push");
    assert.ok(
      !tools.some((t) => /^Bash\(git (diff|log|show)\b/.test(t)),
      "no direct git diff|log|show (--output=<file> writes any file)"
    );
  });

  it("unattendedAllowedTools without a writable target has no Edit rule at all", () => {
    const tools = unattendedAllowedTools(DIST);
    assert.ok(!tools.some((t) => t.startsWith("Edit(")), "no Edit rule without the writable paths");
    assert.ok(!tools.includes("Edit") && !tools.includes("Write"));
  });

  it("scoped Edit rules cover both spellings of a symlinked project (real path and as given)", () => {
    const real = path.join(base, "real-project");
    const link = path.join(base, "link-project");
    fs.mkdirSync(real, { recursive: true });
    fs.writeFileSync(path.join(real, "scribe.config.json"), "{}");
    fs.mkdirSync(path.join(real, "scribe-output", "update-staging"), { recursive: true });
    fs.symlinkSync(real, link, "dir");
    const tools = unattendedAllowedTools(DIST, {
      stagingDir: path.join(link, "scribe-output", "update-staging"),
      configRoot: link,
    });
    const realStaging = fs.realpathSync(path.join(link, "scribe-output", "update-staging"));
    assert.ok(tools.includes(`Edit(/${realStaging}/**)`), "the real staging path");
    assert.ok(tools.includes(`Edit(/${path.join(link, "scribe-output", "update-staging")}/**)`), "the path as given");
    assert.ok(
      tools.includes(`Edit(/${fs.realpathSync(path.join(link, "scribe.config.json"))})`),
      "the real config path"
    );
    assert.ok(tools.includes(`Edit(/${path.join(link, "scribe.config.json")})`), "the config path as given");
    assert.equal(new Set(tools).size, tools.length, "deduplicated");
  });

  it("the report header names the model and the CODE_GRAPH_AUTO_UPDATE=0 off switch (the CODE_GRAPH_UPDATE_MODEL value when set)", async () => {
    const withModel = await runWith(
      () => ({ code: 0, stdout: "", stderr: "" }),
      cleanEnv({ CODE_GRAPH_UPDATE_MODEL: "haiku" })
    );
    const args = withModel.calls[0] as string[];
    assert.equal(args[args.indexOf("--model") + 1], "haiku", "the model flag is passed");
    const report = fs.readFileSync(path.join(stateDir, UPDATE_REPORT_FILE), "utf8");
    assert.match(report, /^- model: haiku \(CODE_GRAPH_UPDATE_MODEL\)$/m);
    assert.ok(report.includes(`- trigger: ${AUTO_UPDATE_OFF_HINT};`), "the off switch is named in the report");
    assert.match(report, /^- permissions: dontAsk; file edits only under /m);
  });

  it("with no model variable the report says the claude CLI's default model, and passes no --model", async () => {
    const r = await runWith(() => ({ code: 0, stdout: "", stderr: "" }));
    assert.equal((r.calls[0] as string[]).includes("--model"), false);
    const report = fs.readFileSync(path.join(stateDir, UPDATE_REPORT_FILE), "utf8");
    assert.match(report, /^- model: the claude CLI's default model/m);
  });

  it("the hook message names the model and the off switch when a run starts", async () => {
    const t = await maybeStartUpdate(root, deps());
    const msg = updateHookMessage(t, cleanEnv({ CODE_GRAPH_UPDATE_MODEL: "haiku" })) ?? "";
    assert.match(msg, /Model: haiku/);
    assert.ok(msg.includes("CODE_GRAPH_AUTO_UPDATE=0"));
    assert.match(msg, /started an unattended update-concept-skills run/);
    const dflt = updateHookMessage(t, cleanEnv()) ?? "";
    assert.match(dflt, /Model: the claude CLI's default model/);
  });

  it("a run that finished incomplete is announced once by the next stop, as incomplete", async () => {
    const first = await startRun();
    // claude "succeeds" but stages no manifest: the run is incomplete.
    await runUpdate(first.root, first.lockToken, first.concepts, {
      claude: async () => ({ code: 0, stdout: "", stderr: "" }),
      env: cleanEnv(),
      cliScript: DIST,
    });
    const announce = await maybeStartUpdate(root, deps({ now: () => clock + 5 * MIN }));
    assert.equal(announce.started, false, "still within the interval");
    assert.equal(announce.finished?.complete, false);
    const msg = updateHookMessage(announce) ?? "";
    assert.match(msg, /finished \(exit 0, incomplete/);
    const once = await maybeStartUpdate(root, deps({ now: () => clock + 6 * MIN }));
    assert.equal(once.finished, undefined, "announced only once");
  });
});

describe("the real Stop hook through the CLI (real git repo, real store, fake claude first on PATH)", () => {
  it("with alpha behind HEAD the hook starts one run; the runner calls claude once; a later stop starts none", async () => {
    const project = buildBehindProject(base, {
      alpha: { globs: ["src/alpha/**"], skill: ".claude/skills/alpha/SKILL.md" },
      beta: { globs: ["src/beta/**"], skill: ".claude/skills/beta/SKILL.md" },
    });
    const log = path.join(base, "claude.log");
    const env = cleanEnv(fakeClaudeOnPath(base, log));

    const first = cg(project, ["refresh-skills", "--hook"], env);
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /started an unattended update-concept-skills run/);
    assert.match(first.stdout, /behind HEAD \(alpha\)/);

    // The runner marks the run finished, then releases the lock; wait for both before the next stop.
    const lock = path.join(project, "scribe-output", LOCK_FILE);
    await waitFor(() => stateOf(project)?.finishedAt !== undefined && !fs.existsSync(lock), 90_000);
    assert.equal(fs.readFileSync(log, "utf8").trim().split("\n").length, 1, "claude ran exactly once");

    const second = cg(project, ["refresh-skills", "--hook"], env);
    assert.doesNotMatch(second.stdout, /started an unattended/);
    assert.match(second.stdout, /finished \(exit 0, incomplete/, "the finished run is announced once");
    assert.equal(fs.readFileSync(log, "utf8").trim().split("\n").length, 1, "no second run");
    // The runner wrote its report next to graph.db, gitignored.
    assert.match(
      fs.readFileSync(path.join(project, "scribe-output", UPDATE_REPORT_FILE), "utf8"),
      /^- claude exit: 0$/m
    );
  });
});

describe("skill and doc pins for the unattended run", () => {
  const plugin = (rel: string) => fs.readFileSync(path.join(PKG, "..", "..", "plugin", rel), "utf8");
  const docs = (rel: string) => fs.readFileSync(path.join(PKG, "..", "..", rel), "utf8");

  it("update-concept-skills tells a claimed run to skip the claim, keyed on the prompt line, not an env var", () => {
    const skill = plugin("skills/update-concept-skills/SKILL.md");
    assert.ok(skill.includes("claimed: by the runner"), "the skill keys on the claimed line");
    assert.ok(!skill.includes("CODE_GRAPH_UNATTENDED"), "the skill does not check the environment");
  });

  it("refresh-hook.md names the claimed line", () => {
    assert.ok(plugin("skills/scribe/refresh-hook.md").includes("claimed: by the runner"));
  });

  it("the hook's timeout in hooks.json equals HOOK_TIMEOUT_SECONDS (the lock takeover depends on it)", () => {
    const hooks = (
      JSON.parse(plugin("hooks/hooks.json")) as { hooks: Record<string, { hooks: { timeout: number }[] }[]> }
    ).hooks;
    for (const ev of ["Stop", "SubagentStop"]) {
      assert.equal(hooks[ev]?.[0]?.hooks[0]?.timeout, HOOK_TIMEOUT_SECONDS, `${ev} timeout`);
    }
  });

  it("the first concept list still asks the user (create-concept-skills), and unattended mode never creates one", () => {
    assert.ok(plugin("skills/create-concept-skills/SKILL.md").includes("AskUserQuestion"));
    const skill = plugin("skills/update-concept-skills/SKILL.md");
    assert.match(skill, /never creates a first list/);
  });

  it("code-graph:scribe no longer says the proposal step ends the turn, and says when to run the update", () => {
    const scribe = plugin("skills/scribe/SKILL.md");
    assert.doesNotMatch(scribe, /ends the turn/);
    assert.match(scribe, /\*\*At a task's end\*\*/);
    assert.match(scribe, /touched/);
  });

  it("update-concept-skills gives the large-diff step an inline fallback when there is no Agent tool", () => {
    assert.match(
      plugin("skills/update-concept-skills/SKILL.md"),
      /\*\*Without it\*\*\s+\(a subagent\), do it inline and scoped/
    );
  });

  it("apply --help describes --approve-unambiguous-renames as applying the concept (exit 0), not exit 10", () => {
    const help = cg(root, ["apply", "--help"]).stdout.replace(/\s+/g, " ");
    assert.match(help, /--approve-unambiguous-renames .*the concept is applied, exit 0/);
    assert.match(help, /--approve-unambiguous-renames .*ambiguous-renames\.json/);
    assert.doesNotMatch(help, /--approve-unambiguous-renames [^-]*exit 10/);
  });

  it("the staging run reads history through cg git diff|log|show, never git diff|log|show directly", () => {
    const skill = plugin("skills/update-concept-skills/SKILL.md");
    assert.match(skill, /Read history with `cg git diff\|log\|show <args>`/);
    assert.doesNotMatch(skill, /read-only `git diff\|log\|show/);
    assert.match(docs("docs/usage.md"), /`code-graph git diff\|log\|show\s+\[args\.\.\.\]`, which refuses `--output`/);
  });

  it("docs/usage.md names dontAsk, the default model and the CODE_GRAPH_AUTO_UPDATE=0 off switch", () => {
    const usage = docs("docs/usage.md");
    assert.ok(usage.includes("dontAsk"));
    assert.ok(usage.includes("CODE_GRAPH_AUTO_UPDATE=0"));
    assert.match(usage, /model is the `claude` CLI's default/);
  });
});

describe("refusedWriteIn parses the refused path out of an errno message", () => {
  it("reads the code and the quoted path", () => {
    assert.deepEqual(refusedWriteIn("EACCES: permission denied, open '/x/SKILL.md'"), {
      code: "EACCES",
      path: "/x/SKILL.md",
    });
    assert.deepEqual(refusedWriteIn("EROFS: read-only file system, open '/r/a'"), { code: "EROFS", path: "/r/a" });
    assert.deepEqual(refusedWriteIn("EPERM: operation not permitted, unlink '/p'"), { code: "EPERM", path: "/p" });
  });

  it("returns null for plain text and for other errno codes", () => {
    assert.equal(refusedWriteIn("plain failure: nothing to see"), null);
    assert.equal(refusedWriteIn("ENOENT: no such file or directory, open '/missing'"), null);
  });
});

describe("the runner's report on an unwritable staging directory", () => {
  it("claude is not started, and the report says so (the staging dir cannot be emptied)", async () => {
    const launch = await startRun();
    const staging = stagingDirFor(stateDir);
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(staging, "leftover.txt"), "x");
    fs.chmodSync(staging, 0o555); // its entries cannot be removed: resetStaging throws EACCES
    try {
      let claudeCalls = 0;
      const code = await runUpdate(launch.root, launch.lockToken, launch.concepts, {
        claude: async () => {
          claudeCalls++;
          return { code: 0, stdout: "", stderr: "" };
        },
        env: cleanEnv(),
        cliScript: DIST,
      });
      assert.equal(claudeCalls, 0, "claude was never started");
      assert.equal(code, null);
      const report = fs.readFileSync(path.join(stateDir, UPDATE_REPORT_FILE), "utf8");
      assert.match(report, /^- claude exit: did not start$/m);
      assert.match(report, /claude was not started/);
      assert.match(report, /^- result: INCOMPLETE/m);
      assert.match(report, /^- sandboxed: the hook runner was sandboxed; writes refused: EACCES on /m);
    } finally {
      fs.chmodSync(staging, 0o755);
    }
  });
});
