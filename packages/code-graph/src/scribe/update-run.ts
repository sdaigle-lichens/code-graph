// The unattended update-concept-skills run: who may start one, when, and the detached runner that
// carries it out. The refresh-skills Stop/SubagentStop hook calls `maybeStartUpdate` after its own
// SKILL.md refresh; a session (the Maestro scribe subagent) calls `claimUpdateRun` through
// `refresh-skills --claim-update` before it runs the flow itself, and `finishUpdateRun` after.
//
// One run at a time, at most one start per interval: both paths go through `claimUpdateRun`, which
// takes the refresh-skills lock (`LOCK_FILE`, next to graph.db), reads the state file
// (`UPDATE_STATE_FILE`, same directory) and refuses while a run is unfinished or started within the
// minimum interval. A hook-started run keeps the lock: the detached runner heartbeats it (a lock older
// than HOOK_TIMEOUT_SECONDS is otherwise taken over) and releases it when `claude -p` exits. A session
// claim releases the lock at once (nothing would heartbeat it); its unfinished state blocks the hook.
//
// Nothing here loads the store, ts-morph or typescript: the hook must stay a no-op on a Node without
// node:sqlite and in a repo with no tsconfig (update-concept-skills works there too).

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, relative } from "node:path";
import { dbPathFor, tryLoadConfig } from "../config.js";
import { pendingRenamesSection } from "./pending-renames.js";
import { isWriteBlocked } from "../skills/concept-skills.js";
import {
  type CliRun,
  type InstallResult,
  type RefusedWrite,
  installStaged,
  nodeCli,
  resetStaging,
  SANDBOXED_RUNNER,
  stagingDirFor,
} from "./update-staging.js";
import { HOOK_TIMEOUT_SECONDS, LOCK_FILE, releaseLock, takeLock } from "./skill-refresh.js";

/** Run state next to graph.db: the last claimed run (start, who, concepts, finish). */
export const UPDATE_STATE_FILE = ".update-skills.json";
/** HEAD at the last check that found no concept behind it; spares the git scan until HEAD moves. */
export const UPDATE_HEAD_FILE = ".update-skills.head";
/** The hook-started run's report (`claude -p` output), next to graph.db (gitignored scribe-output/). */
export const UPDATE_REPORT_FILE = "update-skills-report.md";

/** Minimum minutes between two update runs (token cost cap); `--update-interval` or the env var override it. */
export const DEFAULT_UPDATE_INTERVAL_MINUTES = 60;
/** An unfinished run older than this is treated as dead (killed, crashed, or a session that never finished). */
export const MAX_UPDATE_RUN_MINUTES = 120;
/** How often the detached runner refreshes the lock's mtime (well under HOOK_TIMEOUT_SECONDS). */
const HEARTBEAT_MS = 30_000;

/** Set in the runner's environment: a stop inside the unattended run never starts another one. */
export const UNATTENDED_ENV = "CODE_GRAPH_UNATTENDED";
/** `0`, `false`, `off` or `no` turn the hook trigger off. */
export const AUTO_UPDATE_ENV = "CODE_GRAPH_AUTO_UPDATE";
/** Overrides DEFAULT_UPDATE_INTERVAL_MINUTES. */
export const INTERVAL_ENV = "CODE_GRAPH_UPDATE_INTERVAL_MINUTES";
/** Optional `--model` for the headless run (the user's default model otherwise). */
export const MODEL_ENV = "CODE_GRAPH_UPDATE_MODEL";

/** Optional `--plugin-dir` for the headless run: a local plugin checkout instead of the installed plugin. */
export const PLUGIN_DIR_ENV = "CODE_GRAPH_UPDATE_PLUGIN_DIR";

/**
 * Read-only git the headless run may call directly. No `git diff|log|show`: they take `--output=<file>`,
 * which writes any file, and a prefix rule cannot refuse it. The session reads history through the
 * bundled CLI instead (`code-graph git diff|log|show`, `read-only-git.ts`, which refuses `--output`).
 * The four kept here reject `--output` (git exits 129 or 1, nothing written).
 */
export const READ_ONLY_GIT = [
  "Bash(git status:*)",
  "Bash(git rev-parse:*)",
  "Bash(git rev-list:*)",
  "Bash(git ls-files:*)",
];

/** The real path of `p` (symlinks resolved), or `p` itself when it cannot be resolved. */
function realPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** The headless run's permission mode: anything the allowlist does not approve is denied, never asked. */
export const UNATTENDED_PERMISSION_MODE = "dontAsk";

/** Both spellings of an absolute path (as given, and real path when it differs: macOS `/private/tmp`). */
function bothPaths(p: string): string[] {
  return [...new Set([realPath(p), p].filter(Boolean))];
}

/**
 * Tools the headless run may use without a prompt (`--allowedTools`, under `--permission-mode dontAsk`:
 * everything else is denied). Bash is limited to the bundled CLI the hook runs from (`node <cliScript>`,
 * real path resolved now, plus the path as given when it differs: the skill calls it through
 * `${CLAUDE_PLUGIN_ROOT}`) and read-only git. No bare `node`, so no `node -e`. File edits are limited to
 * `writable.stagingDir` (the staged SKILL.md files, the manifest, enrichment partials) and the
 * project's `scribe.config.json` (a concept the run adds), as absolute `Edit(//...)` rules, which also
 * cover the Write tool. Without `writable` no file may be edited.
 */
export function unattendedAllowedTools(
  cliScript: string,
  writable?: { stagingDir: string; configRoot: string }
): string[] {
  // An absolute path starts with "/", so "/" + path is the documented `//` absolute form.
  const editRules = writable
    ? [
        ...bothPaths(writable.stagingDir).map((d) => `Edit(/${d}/**)`),
        ...bothPaths(join(writable.configRoot, "scribe.config.json")).map((f) => `Edit(/${f})`),
      ]
    : [];
  return [
    "Read",
    ...editRules,
    "Glob",
    "Grep",
    "Skill",
    "Agent",
    "TaskCreate",
    "TaskUpdate",
    ...bothPaths(cliScript).map((p) => `Bash(node ${p}:*)`),
    ...READ_ONLY_GIT,
  ];
}

/** The model line for reports and the hook message: CODE_GRAPH_UPDATE_MODEL, else the claude CLI default. */
export function updateModelLabel(env: NodeJS.ProcessEnv = process.env): string {
  const m = env[MODEL_ENV];
  return m ? `${m} (${MODEL_ENV})` : `the claude CLI's default model (set ${MODEL_ENV} to choose one, e.g. haiku)`;
}

/** How to turn the trigger off, quoted in the hook message, the report and docs/usage.md. */
export const AUTO_UPDATE_OFF_HINT = `${AUTO_UPDATE_ENV}=0 turns the trigger off`;

export type UpdateState = {
  startedAt: number;
  by: "hook" | "session";
  /** Concepts the run was started for; `[]` = whatever the flow finds behind HEAD. */
  concepts: string[];
  finishedAt?: number;
  exitCode?: number | null;
  /** Hook runs: every in-scope concept was installed and stamped, and the repo-level record advanced. */
  complete?: boolean;
  /** Hook runs: the runner could not write its report (`<code> on <path>`): the hook runner was sandboxed. */
  refused?: string;
  /** The hook has told a session that this (hook-started) run finished. */
  announced?: boolean;
};

export type ClaimResult = { claimed: true; token: string; state: UpdateState } | { claimed: false; reason: string };

/** What the detached runner needs; handed to the injectable spawner. */
export type UpdateLaunch = {
  root: string;
  stateDir: string;
  lockToken: string;
  concepts: string[];
  cliScript: string;
};

export type UpdateTrigger = {
  started: boolean;
  /** Why nothing started (silent for the hook). */
  reason?: string;
  concepts: string[];
  /** Relative to the project root. */
  reportPath?: string;
  /** A hook-started run that finished since the last stop, announced once. */
  finished?: { exitCode: number | null; reportPath: string; complete?: boolean };
};

export type TriggerDeps = {
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  /** Minutes; else INTERVAL_ENV, else DEFAULT_UPDATE_INTERVAL_MINUTES. */
  intervalMinutes?: number;
  cliScript?: string;
  /** Concepts whose skill is behind HEAD (defaults to `conceptsBehindHead`). */
  behind?: (root: string) => Promise<string[]>;
  /** HEAD sha, "" outside git (defaults to `git rev-parse HEAD`). */
  head?: (root: string) => Promise<string>;
  /** Whether a `claude` CLI can be started (defaults to a PATH lookup). */
  claudeAvailable?: () => boolean;
  /** Starts the run; the default spawns the detached runner. Must not block. */
  spawn?: (launch: UpdateLaunch) => void;
};

/** Where the lock, state and report live: the directory of graph.db (honours `dbPath`). */
export function updateStateDir(root: string): string | null {
  const config = tryLoadConfig(root);
  return config ? dirname(dbPathFor(config)) : null;
}

export function readUpdateState(stateDir: string): UpdateState | null {
  try {
    const s = JSON.parse(readFileSync(join(stateDir, UPDATE_STATE_FILE), "utf-8")) as UpdateState;
    return typeof s.startedAt === "number" ? s : null;
  } catch {
    return null;
  }
}

function writeUpdateState(stateDir: string, state: UpdateState): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, UPDATE_STATE_FILE), JSON.stringify(state, null, 2) + "\n");
}

/** Interval in ms: explicit minutes, else the env var, else the default. A bad value falls back to the default. */
export function intervalMs(minutes: number | undefined, env: NodeJS.ProcessEnv = process.env): number {
  const raw = minutes ?? (env[INTERVAL_ENV] !== undefined ? Number(env[INTERVAL_ENV]) : undefined);
  const m = raw !== undefined && Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_UPDATE_INTERVAL_MINUTES;
  return m * 60_000;
}

/** Why a new run may not start given the last one, or null. */
export function updateBusy(state: UpdateState | null, now: number, interval: number): string | null {
  if (!state) return null;
  const at = new Date(state.startedAt).toISOString();
  if (state.finishedAt === undefined && now - state.startedAt < MAX_UPDATE_RUN_MINUTES * 60_000) {
    return `an update run started at ${at} (${state.by}) has not finished`;
  }
  if (now - state.startedAt < interval) {
    return `an update run started at ${at} (${state.by}), within the ${Math.round(interval / 60_000)}-minute minimum interval`;
  }
  return null;
}

/** A lock `takeLock` would refuse (younger than the hook timeout); a cheap check before the git scan. */
function lockIsFresh(lockPath: string): boolean {
  try {
    return Date.now() - statSync(lockPath).mtimeMs < HOOK_TIMEOUT_SECONDS * 1000;
  } catch {
    return false;
  }
}

/**
 * Claims the next update run. Takes the refresh-skills lock (refuses while anyone holds it), refuses
 * while the last run is unfinished or started within `interval`, else records the new run. With
 * `keepLock` the lock stays held and its token is returned for the runner to heartbeat and release.
 */
export function claimUpdateRun(
  stateDir: string,
  o: { by: UpdateState["by"]; concepts: string[]; now: number; interval: number; keepLock: boolean }
): ClaimResult {
  mkdirSync(stateDir, { recursive: true });
  const lockPath = join(stateDir, LOCK_FILE);
  const token = takeLock(lockPath);
  if (!token) return { claimed: false, reason: "another refresh-skills or update run holds the lock" };
  try {
    const busy = updateBusy(readUpdateState(stateDir), o.now, o.interval);
    if (busy) {
      releaseLock(lockPath, token);
      return { claimed: false, reason: busy };
    }
    const state: UpdateState = { startedAt: o.now, by: o.by, concepts: o.concepts };
    writeUpdateState(stateDir, state);
    if (!o.keepLock) releaseLock(lockPath, token);
    return { claimed: true, token, state };
  } catch (err) {
    releaseLock(lockPath, token);
    throw err;
  }
}

/** Marks the current run finished (the interval still counts from its start). No-op without an unfinished run. */
export function finishUpdateRun(
  stateDir: string,
  exitCode: number | null,
  now: number = Date.now(),
  complete?: boolean,
  refused?: string
): boolean {
  const state = readUpdateState(stateDir);
  if (!state || state.finishedAt !== undefined) return false;
  writeUpdateState(stateDir, {
    ...state,
    finishedAt: now,
    exitCode,
    ...(complete !== undefined ? { complete } : {}),
    ...(refused ? { refused } : {}),
  });
  return true;
}

/**
 * `refresh-skills --finish-update` (a session's run): marks it finished and, when it was unfinished,
 * writes `UPDATE_REPORT_FILE` with the ambiguous renames still left for a person, so a session run
 * lists them like a hook run. Returns whether a run was finished and those lines (also for stdout).
 */
export function finishSessionRun(root: string, now: number = Date.now()): { finished: boolean; pending: string[] } {
  const config = tryLoadConfig(root);
  if (!config) return { finished: false, pending: [] };
  const stateDir = dirname(dbPathFor(config));
  const state = readUpdateState(stateDir);
  // Only a session's own claim: a stray --finish-update must not end a hook run that the runner still
  // holds, nor overwrite the report the runner will write.
  if (state?.by !== "session" || !finishUpdateRun(stateDir, 0, now)) return { finished: false, pending: [] };
  const pending = pendingRenamesSection(stateDir, config.configRoot);
  const lines = [
    `# update-concept-skills (session run)`,
    ``,
    `- finished: ${new Date(now).toISOString()}`,
    `- concepts: ${state.concepts.join(", ") || "(all)"}`,
    `- the session's own report holds the details; changes are left uncommitted: review with git diff`,
    ...(pending.length > 0 ? ["", ...pending] : []),
  ];
  writeFileSync(join(stateDir, UPDATE_REPORT_FILE), lines.join("\n") + "\n");
  return { finished: true, pending };
}

/** Concept keys whose skill's `last-update` is behind HEAD over its globs (countable windows only). */
export async function conceptsBehindHead(root: string): Promise<string[]> {
  const { conceptSkillsStatus } = await import("../skills/report.js");
  const report = await conceptSkillsStatus(root);
  return report.concepts.filter((c) => c.concept !== null && (c.commitsSince ?? 0) > 0).map((c) => c.concept as string);
}

async function gitHead(root: string): Promise<string> {
  const { headSha } = await import("../skills/report.js");
  return headSha(root);
}

/** True when an executable named `name` is on PATH. */
export function onPath(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const exts = process.platform === "win32" ? ["", ".cmd", ".exe"] : [""];
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) if (existsSync(join(dir, name + ext))) return true;
  }
  return false;
}

/** The default spawner: the runner (`refresh-skills --run-update`) as a detached process the hook never waits on. */
export function spawnDetachedRunner(launch: UpdateLaunch): void {
  const args = [
    ...process.execArgv,
    launch.cliScript,
    "--root",
    launch.root,
    "refresh-skills",
    "--run-update",
    launch.lockToken,
    ...(launch.concepts.length > 0 ? ["--concepts", launch.concepts.join(",")] : []),
  ];
  const child = spawn(process.execPath, args, {
    cwd: launch.root,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, [UNATTENDED_ENV]: "1" },
  });
  child.on("error", () => {}); // the runner records its own failure; a spawn error must not reach the hook
  child.unref();
}

/** Tells a later stop, once, that a hook-started run finished (taken under the lock; skipped when it is held). */
function takeFinishedAnnouncement(stateDir: string, root: string): UpdateTrigger["finished"] | undefined {
  const state = readUpdateState(stateDir);
  if (!state || state.by !== "hook" || state.finishedAt === undefined || state.announced) return undefined;
  const lockPath = join(stateDir, LOCK_FILE);
  const token = takeLock(lockPath);
  if (!token) return undefined;
  try {
    const fresh = readUpdateState(stateDir);
    if (!fresh || fresh.startedAt !== state.startedAt || fresh.announced) return undefined;
    writeUpdateState(stateDir, { ...fresh, announced: true });
    return {
      exitCode: fresh.exitCode ?? null,
      reportPath: relative(root, join(stateDir, UPDATE_REPORT_FILE)),
      ...(fresh.complete !== undefined ? { complete: fresh.complete } : {}),
    };
  } finally {
    releaseLock(lockPath, token);
  }
}

/**
 * The hook trigger. When some concept skill is behind HEAD, no run is unfinished or within the
 * interval, the lock is free and a `claude` CLI exists, claims a run (keeping the lock) and hands it to
 * `deps.spawn`. Never throws for an expected condition; every refusal is a `reason`.
 */
export async function maybeStartUpdate(cwd: string, deps: TriggerDeps = {}): Promise<UpdateTrigger> {
  const env = deps.env ?? process.env;
  const now = (deps.now ?? Date.now)();
  const none = (reason: string, extra: Partial<UpdateTrigger> = {}): UpdateTrigger => ({
    started: false,
    reason,
    concepts: [],
    ...extra,
  });

  if (env[UNATTENDED_ENV]) return none("inside an unattended update run");
  if (/^(0|false|off|no)$/i.test(env[AUTO_UPDATE_ENV] ?? "")) return none(`disabled by ${AUTO_UPDATE_ENV}`);
  const config = tryLoadConfig(cwd);
  if (!config) return none("no scribe.config.json");
  if (Object.keys(config.concepts).length === 0) return none("no concepts configured");
  const root = config.configRoot;
  const stateDir = dirname(dbPathFor(config));
  const finished = existsSync(stateDir) ? takeFinishedAnnouncement(stateDir, root) : undefined;
  const extra = finished ? { finished } : {};

  const interval = intervalMs(deps.intervalMinutes, env);
  const busy = updateBusy(readUpdateState(stateDir), now, interval);
  if (busy) return none(busy, extra);
  if (lockIsFresh(join(stateDir, LOCK_FILE))) {
    return none("another refresh-skills or update run holds the lock", extra);
  }

  const head = await (deps.head ?? gitHead)(root);
  if (!head) return none("not a git repository", extra);
  const headFile = join(stateDir, UPDATE_HEAD_FILE);
  if (existsSync(headFile) && readFileSync(headFile, "utf-8").trim() === head) {
    return none("no concept behind HEAD", extra);
  }
  const behind = await (deps.behind ?? conceptsBehindHead)(root);
  if (behind.length === 0) {
    if (existsSync(stateDir)) writeFileSync(headFile, head + "\n");
    return none("no concept behind HEAD", extra);
  }
  if (!(deps.claudeAvailable ?? (() => onPath("claude", env)))()) return none("no claude CLI on PATH", extra);

  const claim = claimUpdateRun(stateDir, { by: "hook", concepts: behind, now, interval, keepLock: true });
  if (!claim.claimed) return none(claim.reason, extra);
  try {
    (deps.spawn ?? spawnDetachedRunner)({
      root,
      stateDir,
      lockToken: claim.token,
      concepts: behind,
      cliScript: deps.cliScript ?? process.argv[1] ?? "",
    });
  } catch (err) {
    finishUpdateRun(stateDir, null, now);
    releaseLock(join(stateDir, LOCK_FILE), claim.token);
    return none(`could not start the update run: ${(err as Error).message}`, extra);
  }
  return {
    started: true,
    concepts: behind,
    reportPath: relative(root, join(stateDir, UPDATE_REPORT_FILE)),
    ...extra,
  };
}

/** The hook's line(s) for the trigger, or null (a refusal is silent). */
export function updateHookMessage(t: UpdateTrigger, env: NodeJS.ProcessEnv = process.env): string | null {
  const lines: string[] = [];
  if (t.finished) {
    lines.push(
      `code-graph: the unattended update-concept-skills run finished (exit ${t.finished.exitCode ?? "unknown"}` +
        `${t.finished.complete === false ? ", incomplete: some concept skills were not updated" : ""}); ` +
        `report in ${t.finished.reportPath}. Its changes are uncommitted: review them with git diff.`
    );
  }
  if (t.started) {
    lines.push(
      `code-graph: ${t.concepts.length} concept skill(s) behind HEAD (${t.concepts.join(", ")}); ` +
        `started an unattended update-concept-skills run in the background. ` +
        `It leaves its changes uncommitted; report in ${t.reportPath} when it ends. ` +
        `Model: ${updateModelLabel(env)}; ${AUTO_UPDATE_OFF_HINT}.`
    );
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

/** Prompt marker for a run the runner already claimed (the skill keys on it, never on an env var). */
export const CLAIMED_BY_RUNNER = "claimed: by the runner; do not run --claim-update or --finish-update";

/**
 * The headless run's prompt: the plugin skill, in unattended mode, for the concepts the hook found.
 * Everything the session must know is in it (scope, staging dir, that the run is already claimed):
 * the allowlist gives it no way to read the environment.
 */
export function unattendedPrompt(concepts: string[], stagingDir?: string): string {
  const scope = concepts.length > 0 ? `concepts behind HEAD: ${concepts.join(", ")}` : "every concept behind HEAD";
  const staging = stagingDir ? `; staging: ${stagingDir}` : "";
  return (
    `/code-graph:update-concept-skills unattended (started by the code-graph Stop hook; ${scope}${staging}; ` +
    `${CLAIMED_BY_RUNNER}). ` +
    `Run the skill's unattended mode: ask nothing, do not commit, end with the skill's report.`
  );
}

export type ClaudeRun = (
  args: string[],
  o: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }
) => Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}>;

/** Runs `claude` with `args`, collecting its output; a missing CLI resolves with code null and the error. */
const runClaude: ClaudeRun = (args, o) =>
  new Promise((resolveRun) => {
    let stdout = "";
    let stderr = "";
    const child = spawn("claude", args, { cwd: o.cwd, env: o.env, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => child.kill("SIGTERM"), o.timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolveRun({ code: null, stdout, stderr: stderr + String(err.message) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ code, stdout, stderr });
    });
  });

/**
 * The runner's failure line for an error it could not report in the report file: a refused write
 * (EPERM, EROFS, EACCES) names its path and says the hook runner was sandboxed.
 */
function refusedText(err: unknown, fallbackPath: string): string {
  const e = err as NodeJS.ErrnoException;
  if (isWriteBlocked(err)) {
    return `${e.code ?? "EPERM"} on ${e.path ?? fallbackPath}: the hook runner was sandboxed (or the tree is read-only)`;
  }
  return e?.message ?? String(err);
}

/**
 * The detached runner (`refresh-skills --run-update <token>`): heartbeats the lock it was handed, runs
 * `claude -p` on the update-concept-skills skill, writes the report, marks the run finished and
 * releases the lock. Returns the claude exit code (null when it could not start).
 */
export async function runUpdate(
  root: string,
  lockToken: string,
  concepts: string[],
  o: { claude?: ClaudeRun; env?: NodeJS.ProcessEnv; cliScript?: string; cli?: CliRun } = {}
): Promise<number | null> {
  const config = tryLoadConfig(root);
  const configRoot = config?.configRoot ?? root;
  const stateDir = config ? dirname(dbPathFor(config)) : join(root, "scribe-output");
  const cliScript = o.cliScript ?? process.argv[1] ?? "";
  const lockPath = join(stateDir, LOCK_FILE);
  const stagingDir = stagingDirFor(stateDir);
  // A runner that cannot even reset its staging dir is sandboxed (or on a read-only tree): claude is
  // not started (no tokens spent on a run whose files could not be installed).
  let refusedStaging: RefusedWrite | null = null;
  try {
    resetStaging(stagingDir);
  } catch (err) {
    if (isWriteBlocked(err)) refusedStaging = { code: err.code ?? "EPERM", path: stagingDir };
    // any other failure shows up below as a missing manifest
  }
  const env: NodeJS.ProcessEnv = { ...(o.env ?? process.env), [UNATTENDED_ENV]: "1" };
  const heartbeat = setInterval(() => {
    try {
      if (readFileSync(lockPath, "utf-8") === lockToken) {
        const t = new Date();
        utimesSync(lockPath, t, t);
      }
    } catch {
      // lock gone or replaced: nothing to keep alive
    }
  }, HEARTBEAT_MS);
  const args = [
    "-p",
    unattendedPrompt(concepts, stagingDir),
    "--permission-mode",
    UNATTENDED_PERMISSION_MODE,
    ...(env[MODEL_ENV] ? ["--model", env[MODEL_ENV] as string] : []),
    ...(env[PLUGIN_DIR_ENV] ? ["--plugin-dir", env[PLUGIN_DIR_ENV] as string] : []),
    "--allowedTools",
    ...unattendedAllowedTools(cliScript, { stagingDir, configRoot }),
  ];
  let result: { code: number | null; stdout: string; stderr: string };
  if (refusedStaging) {
    result = { code: null, stdout: "", stderr: `${refusedStaging.code}: could not reset ${refusedStaging.path}` };
  } else {
    try {
      result = await (o.claude ?? runClaude)(args, { cwd: root, env, timeoutMs: MAX_UPDATE_RUN_MINUTES * 60_000 });
    } catch (err) {
      result = { code: null, stdout: "", stderr: (err as Error).message };
    }
  }
  let installConfig: ReturnType<typeof tryLoadConfig> = null;
  let install: InstallResult = { complete: false, lines: [] };
  let runFailure: string | null = null;
  try {
    // Install what the session staged (still holding the lock: the heartbeat runs until the end).
    if (refusedStaging) {
      install = {
        complete: false,
        refused: [refusedStaging],
        lines: [
          "## Installed by the runner",
          "",
          `- status: **incomplete**; claude was not started: the runner could not write its staging directory`,
          `- refused: ${refusedStaging.code} on ${refusedStaging.path}`,
          `- ${SANDBOXED_RUNNER}`,
        ],
      };
    } else if (result.code !== 0) {
      install = {
        complete: false,
        lines: [
          "## Installed by the runner",
          "",
          `- status: **incomplete**; claude did not exit 0, so nothing staged was installed (kept in ${relative(configRoot, stagingDir)})`,
        ],
      };
    } else if (!(installConfig = tryLoadConfig(root))) {
      // Reloaded after the session: a concept it added to scribe.config.json must be known to the install.
      install = {
        complete: false,
        lines: [
          "## Installed by the runner",
          "",
          "- status: **incomplete**; scribe.config.json is missing or invalid after the session",
        ],
      };
    } else {
      try {
        install = await installStaged({
          config: installConfig,
          stagingDir,
          dbPath: dbPathFor(installConfig),
          inScope: concepts,
          cli: o.cli ?? nodeCli(cliScript, configRoot),
        });
      } catch (err) {
        install = {
          complete: false,
          lines: ["## Installed by the runner", "", `- status: **incomplete**; ${(err as Error).message}`],
        };
      }
    }
    const lines = [
      `# update-concept-skills (unattended)`,
      ``,
      `- started by: the code-graph Stop/SubagentStop hook`,
      `- finished: ${new Date().toISOString()}`,
      `- concepts behind HEAD: ${concepts.join(", ") || "(all)"}`,
      `- model: ${updateModelLabel(env)}`,
      `- permissions: ${UNATTENDED_PERMISSION_MODE}; file edits only under ${relative(configRoot, stagingDir)}/ and scribe.config.json; git diff|log|show only through code-graph git, which refuses --output`,
      `- trigger: ${AUTO_UPDATE_OFF_HINT}; until then, a stop with a concept behind HEAD may start a token-spending run (at most one per interval)`,
      `- claude exit: ${result.code ?? "did not start"}`,
      `- result: ${install.complete ? "complete" : 'INCOMPLETE (see "Installed by the runner")'}`,
      ...(install.refused && install.refused.length > 0
        ? [
            `- sandboxed: the hook runner was sandboxed; writes refused: ${install.refused
              .map((r) => `${r.code} on ${r.path}`)
              .join(", ")}`,
          ]
        : []),
      `- changes are left uncommitted: review with git diff`,
      ``,
      ...install.lines,
      ``,
      `## Session report`,
      ``,
      result.stdout.trim() || "(no output)",
    ];
    if (result.code !== 0 && result.stderr.trim()) {
      lines.push("", "## stderr (last lines)", "", ...result.stderr.trim().split("\n").slice(-20));
    }
    const pending = pendingRenamesSection(stateDir, configRoot);
    if (pending.length > 0) lines.push("", ...pending);
    const reportPath = join(stateDir, UPDATE_REPORT_FILE);
    try {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(reportPath, lines.join("\n") + "\n");
    } catch (err) {
      runFailure = refusedText(err, reportPath);
    }
  } catch (err) {
    // Anything else the install or report raised: the run still ends, INCOMPLETE.
    runFailure = refusedText(err, stateDir);
  } finally {
    clearInterval(heartbeat);
    const complete = install.complete && !runFailure;
    try {
      finishUpdateRun(stateDir, result.code, Date.now(), complete, runFailure ?? undefined);
    } catch (err) {
      const stateFailure = refusedText(err, join(stateDir, UPDATE_STATE_FILE));
      runFailure = runFailure ? `${runFailure}; ${stateFailure}` : stateFailure;
    }
    if (runFailure) process.stderr.write(`code-graph refresh-skills --run-update: INCOMPLETE; ${runFailure}\n`);
    try {
      releaseLock(lockPath, lockToken);
    } catch {
      // a lock in a read-only directory cannot be removed (nor taken over: takeLock's rename fails there
      // too); it stays until the directory is writable again. The 2 h dead-run rule frees only the state.
    }
  }
  return result.code;
}
