#!/usr/bin/env node
// Maestro task-status tracker. Sole writer of
// <cwd>/.claude/maestro-tasks/status.json — the committed source of truth for
// each task's state (done/ready/blocked) and dependency graph.
//
//   node maestro-task-status.cjs sync
//       Reconcile status.json with the task files on disk: add new NNN-*.md,
//       drop deleted ones, refresh blockedBy from each file's "## Blocked by"
//       section, preserve done, recompute every ready/blocked. Idempotent.
//       Run by /to-maestro-tasks after generating task files.
//
//   node maestro-task-status.cjs done [filename]
//       Mark one task done (e.g. "002-add-login.md"), then recompute the
//       cascade so dependents whose blockers are now all done flip to ready,
//       then release that task's claim if this session (or any session) still
//       holds one — a done task has nothing left for a claim to protect.
//       Run by the /maestro orchestrator after a task-file run fully succeeds.
//       With no filename, falls back to `active_task` in THIS SESSION'S own
//       session.json (`064`, set by maestro-set-session-workflow.cjs --task) so
//       the orchestrator marks exactly the task it started without re-deriving
//       the filename — and never the task a CONCURRENT session started.
//
//   node maestro-task-status.cjs plan <step>... | plan-step <step> <done|pending> | plan-show (`083`)
//       The orchestrator's success-path tracker for when TaskCreate is unavailable: the planned steps
//       (agent steps, human review, the loop-backs that reset them) and their progress live in THIS
//       session's session.json. `done` REFUSES while a recorded plan has an unfinished step, so
//       mark-task-done still runs only after every prior step, including human review.
//
//   node maestro-task-status.cjs handoff-issues (`083`)
//       Prints, then clears, the handoff problems the SubagentStop hook recorded (a missing HANDOFF
//       line, or a FAIL verdict ending HANDOFF: success) so the orchestrator routes deliberately.
//
//   node maestro-task-status.cjs claim <filename>
//       Claim a task for THIS session, so a concurrent session picking "the
//       next ready task" at the same moment can't take the same one (`066`).
//       An exclusive file create under .claude/maestro-tasks/claims/ — success
//       or "already claimed by an active session", never an error either way.
//       A claim belonging to a session that has gone idle (no live
//       maestro_sessions/<id>/log.jsonl) or away (its directory deleted by a
//       clean SessionEnd) is reaped automatically before the attempt, so a
//       crashed session's claim never blocks a fresh one.
//
//       A successful claim also records the task as this session's `active_task` (`147`), which sets
//       its channel scope to `task-<NNN>`; if that changes the scope, the scope it left has its
//       undelivered lane files retired (never a scope another live session owns).
//
//       The claim records the claiming session's NAME beside its id (`084`), because cross-session
//       messages are addressed by name. Since `113` the CLI fills it in from the name the
//       session-name hook stored (`maestro-<id8>`, or the user's custom title); `--name <session
//       name>` is only the fallback when none is stored. A claim with neither works and shows as
//       unnamed. `maestro-epic.cjs show` lists each running task with that name.
//
//   node maestro-task-status.cjs release [filename]
//       Release THIS session's own claim on a task. Never removes a claim held
//       by a DIFFERENT session, live or dead — that check is the whole point.
//       With no filename, falls back to `active_task` the same way `done` does.
//
//   node maestro-task-status.cjs worktree <filename>
//       Run right after a successful `claim` (`074`). If ANOTHER live session holds a claim, create a
//       sibling git worktree (<parent>/<repo>-task-NNN) on branch task-NNN for this session and
//       redirect this session's per-session state into it (a worktree.json pointer in the main
//       checkout's session directory). With no live foreign claim it does nothing and says so. The
//       queue (status.json, claims/) stays in the main checkout either way. A worktree path or branch
//       that already exists is reported, never reused or overwritten. Never merges, pushes or removes.
//
//       `135`: both `worktree` and `freeform-check` then check the worktree for installed dependencies
//       (a package.json with no node_modules). When missing they print a STOP notice with the exact
//       install command for the user (package manager from the lockfile; unknown/ambiguous gets
//       guidance, never a guessed command). Re-run the same command to confirm. `done` refuses while
//       the session's worktree still lacks them. Nothing is installed or linked.
//   node maestro-task-status.cjs freeform-check
//       The same decision for a freeform /maestro run (no task file) (`098`, `103`). Another live session
//       (a task claim, or a freeform run) means THIS session gets its own worktree
//       <parent>/<repo>-freeform-<short session id> on branch freeform-<short session id>, created exactly
//       like a task worktree; nobody else live means "no worktree needed". Writes nothing to claims/ or
//       status.json, so a freeform worktree never shows up as a task.
//
//   node maestro-task-status.cjs mark-merged <filename|NNN>   (`146`)
//       Clear a done task's `unmerged` flag after the user merged its branch by hand, and recompute the
//       cascade. `done` sets `unmerged: true` when the task ran in a worktree, and inside an epic a
//       dependent stays blocked until the blocker is merged (this command, or `merge` below, which
//       clears it itself). Refuses a task that is not done. Merging is never done by this command.
//
//   node maestro-task-status.cjs merge <filename|NNN|freeform-<id>> [--accept-ignored]
//       FINISH a worktree task (`076`) — ONLY ever run because the user explicitly asked for it. Merges
//       branch task-NNN into the main checkout's current branch (`git merge --no-ff`), then removes the
//       worktree and deletes the branch. Refuses, changing nothing, when the task is not `done`, the
//       worktree has uncommitted changes, the branch has no worktree, the main checkout is mid-merge or
//       on a detached HEAD, or the merge would overwrite local changes. `163`: it also refuses while
//       ignored paths exist ONLY in the worktree (the commit does not carry them and the removal would
//       delete them), listing them with the exits (commit with `git add -f`, delete, or waive with
//       `--accept-ignored`); `done` prints the same list but does not refuse. On a CONFLICT it aborts the
//       merge (main goes back to how it was), keeps the worktree and branch, and lists the conflicting
//       files — and, when ALL of them are generated plugin libs or their .claude/scripts/lib mirrors
//       (`082`), names the mechanical resolution: rebuild the libs, copy each over its mirror.
//       Never pushes. No pull-request mode: the branch is an ordinary local branch the user
//       can `git push` themselves (see .claude/skills/task-queue, "Finishing a worktree task").
//       `170`: FIRST it refuses unless the main checkout is on the DEFAULT branch (what origin/HEAD
//       points at, and only that: unset origin/HEAD refuses with `git remote set-head`, never main) with no tracked changes outside .claude/maestro-tasks/ and .claude/epics/
//       (untracked files are only noted). A task branch with NO worktree (committed on task-NNN in the
//       main checkout, then switched back) merges the same way, minus the worktree checks and removal.
//       After the merge it runs the project's verify command (`verify_command` in .claude/maestro.json,
//       else package.json `verify`, else `test`, through the lockfile's package manager) and prints
//       VERIFY PASSED, VERIFY FAILED (exit N; the command exits 1, the merge stays) or VERIFY NOT
//       CONFIGURED (the merged result is unverified).
//       `173`: a task committed on its branch in the main checkout counts as done when the BRANCH's
//       tracker says so, and the task tracker (status.json) is merged by Maestro itself, task by task,
//       when both the main checkout and the branch changed it (a local change, or a conflict), so
//       landing such a task needs no manual step. Any OTHER locally modified file the merge would
//       overwrite makes it refuse first, naming each file, whether it matches the branch's copy, and
//       the restore/stash command that resolves it; nothing is restored, stashed or discarded for you.
//
//   node maestro-task-status.cjs switch-back   (`170`)
//       Return the main checkout to the default branch. Refuses, changing nothing, mid-merge/rebase or
//       with tracked changes. Checks first that every path the switch rewrites is writable; when one is
//       not (the sandbox), or `git switch` fails, it prints the exact `! git -C <root> switch <default>`
//       for the user and never leaves the checkout half-switched without saying how to finish it.
//
// All cascade/status logic lives in lib/maestro-tasks.cjs so the app and the
// orchestrator share one implementation. Claims are derived state, never
// written into status.json — see claimsDir()/claimTask()/releaseTask() below,
// kept in sync with apps/maestro/src/core/claims.ts. Self-contained:
// maestro-install.js copies this file and the lib into the project's
// .claude/scripts/.

const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const {
  sync,
  markDone,
  markMerged,
  tasksDir,
  mainCheckoutRoot,
  statusPath,
  writeStatus,
} = require("./lib/maestro-tasks.cjs");
const {
  resolveSessionPaths,
  sessionPathsFor,
  readWorktreePointer,
  ensureSessionsRoot,
  worktreeBranchFor,
  worktreePathFor,
  freeformBranchFor,
  freeformWorktreePathFor,
  isFreeformBranch,
  SESSION_WORKTREE_NAME,
  CLAIM_IDLE_CAP_MS,
  HEARTBEAT_STALE_MS,
  SESSION_HEARTBEAT_NAME,
  storedName,
  missingDependenciesNotice,
  pendingResumeDeliveries,
  dropResolvedMissingPayloads,
  channelFileMtime,
  isChannelScope,
  recordActiveTask,
  ignoredOnlyInWorktree,
  formatIgnoredNotice,
  provisionExcludedDirs,
  formatExcludedProvision,
  settleInterimStops,
  interimSettleEntry,
  appendSessionLog,
  landedHandback,
  checkHandoff,
  checkRoute,
  checkPayload,
  handoffRoutes,
  testHintRoutes,
  routesFrom,
  payloadRoutes,
  payloadWrittenSince,
  agentRunStartedAt,
  runProfile,
  readLogLines,
  resolveSearchList,
  readGlobalHandoff,
  defaultBranch,
  originHeadUnsetMessage,
  currentBranch,
  dirtyTrackedPaths,
  checkTargetCheckout,
  unwritablePaths,
  pathsChangedBetween,
  switchCommandFor,
  resolveVerifyCommand,
  formatVerifyResult,
  gitTopLevel,
  trackerRelPath,
  compareWithBranch,
  overwrittenByMerge,
  parseOverwriteError,
  formatOverwriteRefusal,
  parseTracker,
  mergeTaskTrackers,
  trackerMarksDone,
} = require("./lib/maestro-session.cjs");

// `074`: the QUEUE root is always the main checkout — even if this runs with a worktree as its
// project dir — so claims and session pointers resolve the same for every session.
const projectDir = mainCheckoutRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
const [command, arg] = process.argv.slice(2);

// `084`: `claim <filename> --name <session name>` records the session's name so a manager can
// message the session running a task. `113`: the name the session-name hook stored in session.json
// (`maestro-<id8>`, or the user's custom title) is recorded in preference, so `--name` is only a
// fallback for a session with no stored name. Neither means an unnamed claim, which still works.
function flagValue(flag) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i !== -1 && typeof args[i + 1] === "string" && args[i + 1].trim() ? args[i + 1].trim() : null;
}

// Fall back to the task recorded by maestro-set-session-workflow.cjs (--task) so
// the orchestrator can run `done`/`release` with no argument and act on exactly
// the task it started — no re-deriving the filename from the prompt.
function activeTaskFromSession() {
  try {
    // `064`: this session's own state, resolved from the environment (this CLI has no stdin). No
    // session id ⇒ null ⇒ the same "needs a filename" answer an absent `active_task` already gave.
    const sess = resolveSessionPaths(path.join(projectDir, ".claude"));
    if (!sess) return null;
    const session = JSON.parse(fs.readFileSync(sess.state, "utf8"));
    if (session && typeof session.active_task === "string") return session.active_task;
  } catch {
    // fall through: a session that was stopped and resumed has had its state directory removed
    // by SessionEnd, but the task's claim file (keyed by the same session id) survives it.
  }
  return claimedTaskFromOwnSession();
}

// The one task whose claim this session holds, or null when it holds none or several (guessing
// between two would mark the wrong one done).
function claimedTaskFromOwnSession() {
  try {
    const sess = resolveSessionPaths(path.join(projectDir, ".claude"));
    if (!sess) return null;
    const mine = fs
      .readdirSync(claimsDir())
      .filter((f) => f.endsWith(".json"))
      .filter((f) => {
        const claim = readClaimFile(path.join(claimsDir(), f));
        return claim && claim.session_id === sess.id;
      })
      .map((f) => f.slice(0, -".json".length));
    return mine.length === 1 ? mine[0] : null;
  } catch {
    return null;
  }
}

// This CLI's own session id (`064`) — resolved from the environment, since it has no stdin.
function ownSessionId() {
  const sess = resolveSessionPaths(path.join(projectDir, ".claude"));
  return sess ? sess.id : null;
}

// ── claims (`066`) ──────────────────────────────────────────────────────────
// <projectDir>/.claude/maestro-tasks/claims/<filename>.json holding
// { session_id, claimed_at, project_root }. Kept in sync with
// apps/maestro/src/core/claims.ts — see that file for the full design notes.

function claimsDir() {
  return path.join(tasksDir(projectDir), "claims");
}

function ensureClaimsDir() {
  const dir = claimsDir();
  fs.mkdirSync(dir, { recursive: true });
  const ignore = path.join(dir, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n");
  return dir;
}

function claimPathFor(filename) {
  return path.join(claimsDir(), `${path.basename(filename)}.json`);
}

function readClaimFile(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (data && typeof data.session_id === "string" && typeof data.claimed_at === "string") return data;
    return null;
  } catch {
    return null;
  }
}

// Live iff the claiming session's directory still exists AND (`141`): when it holds a `heartbeat`
// file, that file's mtime is within HEARTBEAT_STALE_MS (a present-but-stale heartbeat is dead even
// with a fresh log); otherwise its log.jsonl was modified within CLAIM_IDLE_CAP_MS. A missing
// directory (clean SessionEnd) is dead immediately. Same rule as isSessionLive in claims.ts.
function isSessionLive(sessionId, now) {
  const paths = sessionPathsFor(path.join(projectDir, ".claude"), sessionId);
  if (!paths || !fs.existsSync(paths.dir)) return false;
  let heartbeat = null;
  try {
    heartbeat = fs.statSync(path.join(paths.dir, SESSION_HEARTBEAT_NAME));
  } catch {
    // No heartbeat file: a runtime predating it — fall back to the log rule below.
  }
  if (heartbeat) return now - heartbeat.mtimeMs <= HEARTBEAT_STALE_MS;
  try {
    const stat = fs.statSync(paths.log);
    return now - stat.mtimeMs <= CLAIM_IDLE_CAP_MS;
  } catch {
    return false;
  }
}

// Claim `filename` for `sessionId`. Reaps a dead claim on this file first, then attempts an
// exclusive ("wx") create. Returns { outcome: "claimed" } or
// { outcome: "already-claimed", claim: { sessionId, claimedAt } } — EEXIST is never an error.
function claimTask(filename, sessionId, now, sessionName) {
  const base = path.basename(filename);
  ensureClaimsDir();
  const filePath = claimPathFor(base);

  const existing = readClaimFile(filePath);
  if (existing) {
    if (isSessionLive(existing.session_id, now)) {
      return {
        outcome: "already-claimed",
        claim: { sessionId: existing.session_id, claimedAt: existing.claimed_at, sessionName: existing.session_name },
      };
    }
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Fall through — the "wx" create below surfaces EEXIST if this truly failed.
    }
  }

  const payload = { session_id: sessionId, claimed_at: new Date(now).toISOString(), project_root: projectDir };
  if (sessionName) payload.session_name = sessionName; // `084`
  try {
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
    return { outcome: "claimed" };
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    const winner = readClaimFile(filePath);
    if (!winner) return { outcome: "claimed" }; // winner released/reaped between our EEXIST and this read
    return {
      outcome: "already-claimed",
      claim: { sessionId: winner.session_id, claimedAt: winner.claimed_at, sessionName: winner.session_name },
    };
  }
}

// Release `filename`'s claim, but ONLY when `sessionId` currently holds it. Never deletes a
// foreign session's claim, live or dead. Returns "released" | "no-claim" | "not-owner".
function releaseTask(filename, sessionId) {
  const filePath = claimPathFor(filename);
  const claim = readClaimFile(filePath);
  if (!claim) return "no-claim";
  if (claim.session_id !== sessionId) return "not-owner";
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // Best-effort.
  }
  return "released";
}

// Unconditional delete, whoever holds it — used by `done`, which already knows the task is
// finished and any claim on it has nothing left to protect.
function deleteClaimIfAny(filename) {
  try {
    fs.rmSync(claimPathFor(filename), { force: true });
  } catch {
    // Nothing to clean up, or nothing worth failing `done` over.
  }
}

// ── worktree isolation (`074`) ──────────────────────────────────────────────

// Another session, different from `sessionId`, holds a claim and is live. Returns that claim or null.
function liveForeignClaim(sessionId, now) {
  let files;
  try {
    files = fs.readdirSync(claimsDir()).filter((f) => f.endsWith(".json"));
  } catch {
    // No claims/ yet (nothing claimed): a freeform session can still be live.
    return liveFreeformSession(sessionId, now);
  }
  for (const f of files) {
    const claim = readClaimFile(path.join(claimsDir(), f));
    if (claim && claim.session_id !== sessionId && isSessionLive(claim.session_id, now)) {
      return { file: f.slice(0, -".json".length), sessionId: claim.session_id };
    }
  }
  return liveFreeformSession(sessionId, now);
}

// `098`: a freeform /maestro run claims nothing, so its presence is its own session.json: a recorded
// `workflow` and no `active_task` (a task session records `active_task` in the same call and is
// found through its claim instead). It reads live by the same rule as a claim — SessionEnd removes
// the session directory, and an idle log ages it out — and it writes nothing to claims/ or
// status.json, so it can never show up as a task. Returns { file: null, sessionId } or null.
function liveFreeformSession(sessionId, now) {
  const claudeDir = path.join(projectDir, ".claude");
  let ids;
  try {
    ids = fs.readdirSync(path.join(claudeDir, "maestro_sessions"));
  } catch {
    return null;
  }
  for (const id of ids) {
    if (id === sessionId) continue;
    const paths = sessionPathsFor(claudeDir, id);
    if (!paths || !isSessionLive(id, now)) continue;
    try {
      const state = JSON.parse(fs.readFileSync(paths.state, "utf8"));
      if (state && typeof state.workflow === "string" && !state.active_task) return { file: null, sessionId: id };
    } catch {
      // No readable state: not a session that recorded a workflow.
    }
  }
  return null;
}

// `freeform-check`: the worktree decision for a run with no task file (`098`, `103`). There is no task
// number to name a worktree after, so the name comes from the session id (freeform-<short id>). The
// rule is the same as for a task session: nobody else live means the main checkout; another live
// session means THIS (second) session works in its own worktree. The first session never moves.
function freeformCheck(sessionId) {
  const existing = readWorktreePointer(path.join(projectDir, ".claude"), sessionId);
  if (existing) {
    process.stdout.write(
      `Maestro tasks: this session already works in worktree ${existing.path} (branch ${existing.branch}) — keep using it\n` +
        existingWorktreeNotice(existing.path)
    );
    return;
  }
  const foreign = liveForeignClaim(sessionId, Date.now());
  if (!foreign) {
    process.stdout.write(
      "Maestro tasks: no other live session is working — no worktree needed, work in the main checkout\n"
    );
    return;
  }
  const branch = freeformBranchFor(sessionId);
  const wtPath = freeformWorktreePathFor(projectDir, sessionId);
  if (!branch || !wtPath) {
    process.stdout.write(
      `Maestro tasks: another session (${foreign.sessionId}) is active but this session id has no usable characters to name a worktree — tell the user and work in the main checkout only if they agree\n`
    );
    return;
  }
  provisionWorktree({
    sessionId,
    foreign,
    branch,
    wtPath,
    subject: "this freeform run",
    pointerTask: branch,
    freeform: true,
  });
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function branchExists(branch) {
  try {
    git(projectDir, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

// Create the worktree for `filename` when needed and move this session's state into it. Prints one
// plain result for the orchestrator; never throws for an expected condition.
function setupWorktree(filename, sessionId) {
  const claudeDir = path.join(projectDir, ".claude");
  const existing = readWorktreePointer(claudeDir, sessionId);
  if (existing) {
    process.stdout.write(
      `Maestro tasks: this session already works in worktree ${existing.path} (branch ${existing.branch}) — keep using it\n` +
        existingWorktreeNotice(existing.path)
    );
    return;
  }
  const foreign = liveForeignClaim(sessionId, Date.now());
  if (!foreign) {
    process.stdout.write(
      "Maestro tasks: no other live session is working — no worktree needed, work in the main checkout\n"
    );
    return;
  }
  const branch = worktreeBranchFor(filename);
  const wtPath = worktreePathFor(projectDir, filename);
  if (!branch || !wtPath) {
    process.stdout.write(
      `Maestro tasks: "${filename}" has no task number, so no worktree can be named for it — tell the user another session (${foreign.sessionId}) is active and work in the main checkout only if they agree\n`
    );
    return;
  }
  provisionWorktree({
    sessionId,
    foreign,
    branch,
    wtPath,
    subject: `"${filename}"`,
    pointerTask: filename,
    freeform: false,
  });
}

// Create `wtPath` on `branch` and move this session's state into it. Shared by a task session
// (`worktree`) and a freeform run (`freeform-check`, `103`): same git commands, same pointer, same
// refusals. `subject` is how the messages name the work.
function provisionWorktree({ sessionId, foreign, branch, wtPath, subject, pointerTask, freeform }) {
  const claudeDir = path.join(projectDir, ".claude");
  const pathTaken = fs.existsSync(wtPath);
  const branchTaken = branchExists(branch);
  if (pathTaken || branchTaken) {
    const what = [pathTaken ? `path ${wtPath}` : null, branchTaken ? `branch ${branch}` : null]
      .filter(Boolean)
      .join(" and ");
    process.stdout.write(
      `Maestro tasks: another session (${foreign.sessionId}) is active, so ${subject} should run in its own worktree, but ${what} already exists. ` +
        `It was NOT reused or overwritten. Tell the user, and ask them to merge/remove the old worktree or branch ${freeform ? "" : "(or choose another task) "}before continuing. Do not start the work in the main checkout.\n`
    );
    return;
  }

  // `182`: the branch starts from the default branch (what origin/HEAD points at), never from
  // whatever the main checkout has checked out, and never from a guessed main. Unset: refuse.
  const def = defaultBranch(gitTry, projectDir);
  if (!def) {
    process.stdout.write(
      `Maestro tasks: worktree for ${subject} REFUSED — ${originHeadUnsetMessage(projectDir)}. Nothing was created. Tell the user; do not start the work in the main checkout while another session is active.\n`
    );
    return;
  }
  const startPoint = branchExists(def) ? def : `origin/${def}`;

  try {
    git(projectDir, ["worktree", "add", "-b", branch, wtPath, startPoint]);
  } catch (err) {
    const detail = String(err.stderr || err.message || "")
      .trim()
      .split("\n")
      .pop();
    process.stdout.write(
      `Maestro tasks: could not create worktree ${wtPath} on branch ${branch} (${detail}). Tell the user; do not start the work in the main checkout while another session is active.\n`
    );
    return;
  }

  // The committed project-local install travels with the checkout; maestro.json may be untracked.
  const mainCfg = path.join(claudeDir, "maestro.json");
  const wtCfg = path.join(wtPath, ".claude", "maestro.json");
  if (fs.existsSync(mainCfg) && !fs.existsSync(wtCfg)) {
    fs.mkdirSync(path.dirname(wtCfg), { recursive: true });
    fs.copyFileSync(mainCfg, wtCfg);
  }

  // `163`: git-excluded nested .claude directories (apps/web/.claude) do not exist in a new
  // worktree. Copy them (never link: a `dir/` ignore rule does not match a symlink); a copy that
  // would show up as untracked is removed again by the helper and reported, so nothing is left over.
  let excludedNotice = "";
  try {
    excludedNotice = formatExcludedProvision(provisionExcludedDirs(gitTry, projectDir, wtPath));
  } catch {
    // best effort: a worktree without these directories is still usable
  }

  // Move this session's gitignored state (session.json, log.jsonl, tasks.json) into the worktree,
  // recording where the main checkout is, then leave only the pointer behind in main.
  const mainSessionDir = path.join(claudeDir, "maestro_sessions", sessionId);
  const wtClaudeDir = path.join(wtPath, ".claude");
  ensureSessionsRoot(wtClaudeDir);
  const wtSessionDir = path.join(wtClaudeDir, "maestro_sessions", sessionId);
  if (fs.existsSync(mainSessionDir)) copyDir(mainSessionDir, wtSessionDir);
  else fs.mkdirSync(wtSessionDir, { recursive: true });
  const stateFile = path.join(wtSessionDir, "session.json");
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(stateFile, "utf8")) || {};
  } catch {
    // no prior state: start one
  }
  state.worktree = { path: wtPath, branch, main_root: projectDir };
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);

  fs.rmSync(mainSessionDir, { recursive: true, force: true });
  fs.mkdirSync(mainSessionDir, { recursive: true });
  ensureSessionsRoot(claudeDir);
  const pointer = {
    path: wtPath,
    branch,
    task: pointerTask,
    main_root: projectDir,
    created_at: new Date().toISOString(),
  };
  if (freeform) pointer.freeform = true;
  fs.writeFileSync(path.join(mainSessionDir, SESSION_WORKTREE_NAME), `${JSON.stringify(pointer, null, 2)}\n`);

  process.stdout.write(
    `Maestro tasks: another live session (${foreign.sessionId}) is active, so ${subject} runs in its own worktree.\n` +
      `  worktree: ${wtPath}\n  branch:   ${branch} (started from ${def}, the default branch from origin/HEAD)\n` +
      "Do ALL of this session's work there: tell every subagent to use that directory as its working directory and absolute paths under it, " +
      `and never edit the main checkout (${projectDir}). The task queue and this task's .claude/channels/<scope>/ lanes stay in the main checkout (${projectDir}/.claude/...). ` +
      "If edits there are denied, ask the user to allow the worktree directory (/add-dir).\n"
  );
  if (excludedNotice) process.stdout.write(excludedNotice);
  // `135`: a fresh checkout has no installed dependencies; stop with the user's install command.
  const notice = missingDependenciesNotice(wtPath);
  if (notice) process.stdout.write(notice);
}

// `135`: the reminder printed when a worktree is (re)confirmed, so re-running `worktree` after the
// user's install is how the orchestrator verifies it. Empty when the dependencies are in place.
function existingWorktreeNotice(wtPath) {
  return missingDependenciesNotice(wtPath) || "";
}

// ── finishing a worktree task (`076`) ───────────────────────────────────────

function gitTry(cwd, args) {
  try {
    return { ok: true, out: git(cwd, args) };
  } catch (err) {
    return { ok: false, out: String(err.stdout || "").trim(), err: String(err.stderr || err.message || "").trim() };
  }
}

// The checkout of `branch` according to git itself (not a guessed path), or null.
function worktreeForBranch(branch) {
  const r = gitTry(projectDir, ["worktree", "list", "--porcelain"]);
  if (!r.ok) return null;
  let cur = null;
  for (const line of r.out.split("\n")) {
    if (line.startsWith("worktree ")) cur = line.slice("worktree ".length);
    else if (line === `branch refs/heads/${branch}` && cur) return cur;
  }
  return null;
}

// Accept "074-foo.md" or a bare "074" and resolve it against status.json's task list.
function resolveTaskName(arg) {
  const base = path.basename(arg);
  let map = {};
  try {
    map = JSON.parse(fs.readFileSync(path.join(tasksDir(projectDir), "status.json"), "utf8")) || {};
  } catch {
    // no queue: fall through with an empty map
  }
  if (map[base]) return { filename: base, status: map[base].status };
  if (/^\d+$/.test(base)) {
    const hit = Object.keys(map).filter((k) => k.startsWith(`${base}-`));
    if (hit.length === 1) return { filename: hit[0], status: map[hit[0]].status };
    // A task created and committed on its own branch is unknown to this checkout's tracker: name it
    // from the branch's tracker. Its status stays null here; the caller asks the branch whether it
    // is done.
    if (!hit.length) {
      const top = gitTopLevel(gitTry, projectDir);
      const onBranch = gitTry(top, ["show", `task-${base}:${trackerRelPath(top, projectDir)}`]);
      const branchHit = onBranch.ok
        ? Object.keys(parseTracker(onBranch.out)).filter((k) => k.startsWith(`${base}-`))
        : [];
      if (branchHit.length === 1) return { filename: branchHit[0], status: null };
    }
  }
  return { filename: base, status: map[base] ? map[base].status : null };
}

function refuse(message, extra) {
  process.stdout.write(
    `Maestro tasks: merge REFUSED — ${message}. Nothing was merged, pushed or removed.\n${extra ? extra + "\n" : ""}`
  );
  process.exit(1);
}

// `083`: a worktree task ends uncommitted (no workflow step owns the commit), so the first `merge`
// always meets a dirty worktree. Name the exact commit to make, so the refusal is actionable: the
// worktree path and a suggested message built from the task's own title. Only the USER approves it.
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function taskTitle(filename) {
  try {
    const text = fs.readFileSync(path.join(tasksDir(projectDir), filename), "utf8");
    const m = /^#\s+(.+)$/m.exec(text);
    if (m) return m[1].trim();
  } catch {
    // no readable task file — fall back to the filename
  }
  return filename.replace(/\.md$/, "");
}

function commitSuggestion(filename, branch, wtPath, excludeMaestroJson) {
  const num = (/^(\d+)-/.exec(filename || "") || [])[1] || branch;
  const message = filename ? `${taskTitle(filename)} (task ${num})` : `Freeform run (${branch})`;
  const pathspec = excludeMaestroJson ? ` -- . ${shellQuote(":!.claude/maestro.json")}` : "";
  return (
    `Suggested commit (run it only once the user has approved the message):\n` +
    `  worktree: ${wtPath}\n` +
    `  message:  ${message}\n` +
    `  command:  git -C ${shellQuote(wtPath)} add -A${pathspec} && git -C ${shellQuote(wtPath)} commit -m ${shellQuote(message)}\n` +
    `Then ask for the merge again. Never commit without the user's approval.`
  );
}

// `083`: untracked files in the MAIN checkout whose path the task branch also carries — git would
// refuse the merge ("untracked working tree files would be overwritten"). Each is reported as
// byte-identical to the branch's copy (safe to delete) or different (needs a look).
// `173`: every name here is a repo path (relative to the git top level `top`): the merge rewrites the
// whole tree, not just the project directory, so the lists are the whole repo's (`--full-tree`,
// `--full-name`, run from `top`), `<branch>:<rel>` reads the same path, and the file is read at
// `top/<rel>`. A project-relative name would read the wrong blob below the top level.
function collidingUntracked(top, branch) {
  const tree = gitTry(top, ["ls-tree", "-r", "-z", "--full-tree", "--name-only", branch]);
  const untracked = gitTry(top, ["ls-files", "--others", "--exclude-standard", "--full-name", "-z"]);
  if (!tree.ok || !untracked.ok) return [];
  const onBranch = new Set(tree.out.split("\0").filter(Boolean));
  const hits = [];
  for (const rel of untracked.out.split("\0").filter(Boolean)) {
    if (!onBranch.has(rel)) continue;
    let identical = false;
    try {
      const local = path.join(top, rel);
      if (fs.lstatSync(local).isFile()) {
        const theirs = execFileSync("git", ["show", `${branch}:${rel}`], {
          cwd: top,
          maxBuffer: 256 * 1024 * 1024,
          stdio: ["ignore", "pipe", "ignore"],
        });
        identical = fs.readFileSync(local).equals(theirs);
      }
    } catch {
      identical = false;
    }
    hits.push({ rel, identical });
  }
  return hits;
}

// `083`: the sandbox denies writes under some main-checkout paths (e.g. .claude/skills), so a merge
// the orchestrator runs can die mid-checkout. Recognisable output, and the exact command for the user.
// Matches git's own "unable to unlink old '<path>': Operation not permitted" family, not any stray
// "Operation not permitted" (a sandboxed git also prints one about its xcrun cache on a plain conflict).
const SANDBOX_DENIAL =
  /unable to (?:unlink|create file|write|remove|create directory)[^\n]*(?:Operation not permitted|Permission denied|Read-only file system)/i;

// `082`: a conflict in a GENERATED plugin lib (plugins/maestro/scripts/lib/*.cjs, except the
// hand-maintained maestro-tasks.cjs) or in this repo's tracked MIRROR of one
// (.claude/scripts/lib/*.cjs) is never resolved by hand-merging the bundle text. Two tasks that both
// rebuilt the same lib always collide there. The fix is mechanical: resolve the TypeScript source
// conflicts first, then `pnpm refresh:runtime` rebuilds the plugin libs and copies each over its mirror.
function generatedLibResolution(conflicts) {
  const generated = conflicts.every((f) => {
    const m = /^(plugins\/maestro|\.claude)\/scripts\/lib\/([^/]+\.cjs)$/.exec(f);
    return m && m[2] !== "maestro-tasks.cjs";
  });
  if (!conflicts.length || !generated) return null;
  // `179`: a containerized worker cannot run the refresh (read-only .claude/scripts); it asks the user to run it on the host.
  let refresh =
    "run `pnpm refresh:runtime` (rebuilds the libs and copies each over its .claude/scripts/lib/ mirror; a sandboxed agent hands the user `! pnpm refresh:runtime`)";
  try {
    const { isContainerWorker, refreshRuntimeWords } = require("./lib/maestro-epic.cjs");
    if (isContainerWorker())
      refresh = `${refreshRuntimeWords()} (it rebuilds the libs and copies each over its .claude/scripts/lib/ mirror)`;
  } catch {
    // an older install without the epic bundle keeps the host wording
  }
  return (
    "Every conflicting file is a generated plugin lib or its tracked mirror, so do NOT edit the bundle text. Resolve like this in the worktree:\n" +
    "  1. resolve any conflict in apps/maestro/src/core/** first (none listed here means the sources merged cleanly);\n" +
    `  2. ${refresh};\n` +
    "  3. `git add` those files, run `pnpm --filter maestro exec vitest run test/core/parity.test.ts`, commit, then ask for the merge again.\n"
  );
}

// `173`: refuse, naming each locally modified file the merge would overwrite (whether it matches the
// branch's copy, and the commands that resolve it). `otherDirty` are tracked changes the merge does
// not touch, which the target guard refuses on too; they are counted so the user sees all of it.
// Returns only when `files` is empty. Never restores, stashes or discards anything itself.
function refuseOverwritten(top, branch, files, otherDirty) {
  if (!files.length) return;
  const named = new Set(files.map((f) => f.rel));
  const rest = otherDirty.filter((p) => !named.has(p));
  refuse(
    `${files.length} locally modified file(s) in the main checkout (${projectDir}) would be overwritten by merging ${branch}`,
    formatOverwriteRefusal(top, branch, files) +
      (rest.length
        ? `\nThe main checkout also has ${rest.length} other tracked change(s) the merge does not touch (e.g. ${rest[0]}); the merge target must be clean of those too. They belong to whoever changed them: ask the user before committing, stashing or discarding any of them.`
        : "")
  );
}

// `173`: the task tracker, changed both in the main checkout (other tasks finished there, or the
// user marked this one done after switch-back) and on the task branch, would make git refuse the
// merge. Maestro is the tracker's only writer, so it merges it itself: the local copy is set aside
// (kept in memory and in a backup file in the git directory), the tracker goes back to HEAD for the
// merge, and afterwards the local changes are re-applied task by task over the merged copy. Any
// failure puts the local copy back exactly as it was.
// `173`: where `setAsideTracker` keeps its backup: in the git directory (never tracked, never in the
// work tree), resolved against `top`, the directory `--git-path` ran in. `null` when git cannot say.
function trackerBackupPath(top) {
  const gp = gitTry(top, ["rev-parse", "--git-path", "maestro-tracker-before-merge.json"]);
  return gp.ok && gp.out ? path.resolve(top, gp.out) : null;
}

// `173`: a backup left by an earlier merge (its re-apply or restore failed) may be the ONLY copy of
// that merge's local tracker changes. A new merge would overwrite it and then delete it, so merge
// refuses while it exists, before changing anything. Only the user compares, restores and deletes it.
function refuseOverLeftBackup(top) {
  const backup = trackerBackupPath(top);
  if (!backup || !fs.existsSync(backup)) return;
  const abs = statusPath(projectDir);
  refuse(
    `a task-tracker backup from an earlier merge is still at ${backup} — it may hold the only copy of that merge's local tracker changes`,
    `To resolve (the user decides; Maestro never deletes or overwrites the backup):\n` +
      `  1. compare it with the tracker: diff ${shellQuote(backup)} ${shellQuote(abs)}\n` +
      `  2. do NOT copy the backup over the tracker: it is the tracker from BEFORE that merge, so a plain copy undoes tasks the merge already marked done. Copy back into ${abs} by hand only the entries the tracker lacks or holds in an older state;\n` +
      `  3. delete the backup: rm ${shellQuote(backup)}\n` +
      `Then ask for the merge again.`
  );
}

function setAsideTracker(top, trackerRel) {
  const abs = statusPath(projectDir);
  const before = gitTry(top, ["rev-parse", "HEAD"]).out;
  let local;
  try {
    local = fs.readFileSync(abs, "utf8");
  } catch (err) {
    refuse(`could not read the task tracker ${abs} (${err.message})`);
  }
  const backup = trackerBackupPath(top);
  let backedUp = false;
  // Never over a backup left by an earlier merge: `merge` refused on one already, this refuses on one
  // that appeared since, and `wx` below never overwrites one that appears in between (the write then
  // fails, `backedUp` stays false, and that file is never deleted by `dropBackup`).
  if (backup && fs.existsSync(backup)) refuseOverLeftBackup(top);
  if (backup) {
    try {
      fs.writeFileSync(backup, local, { flag: "wx" });
      backedUp = true;
    } catch {
      // best effort: the in-memory copy still covers every exit below
    }
  }
  // `173`: while the backup exists it is the only other copy of the local tracker changes. Any exit
  // that leaves it behind (a failed restore or re-apply, or a throw anywhere after this point) names
  // it, so the changes are never left where nothing reports them.
  const reportBackup = () => {
    if (backedUp && fs.existsSync(backup))
      process.stdout.write(
        `Maestro tasks: the main checkout's own task-tracker changes (from before the merge) are saved in ${backup}; ` +
          `${abs} may not hold them. Compare the two (diff ${shellQuote(backup)} ${shellQuote(abs)}), but do NOT copy the backup over the tracker: ` +
          `it predates the merge, so a plain copy undoes tasks the merge already marked done. Copy back by hand only the entries the tracker lacks or holds in an older state, then delete the backup.\n`
      );
  };
  process.on("exit", reportBackup);
  const dropBackup = () => {
    if (backedUp) fs.rmSync(backup, { force: true });
    process.removeListener("exit", reportBackup);
  };
  const reset = gitTry(top, ["restore", "--source=HEAD", "--staged", "--worktree", "--", trackerRel]);
  if (!reset.ok) {
    fs.writeFileSync(abs, local);
    dropBackup();
    refuse(`could not set the task tracker aside for the merge (${reset.err.split("\n")[0] || "git refused"})`);
  }
  return {
    restore() {
      fs.writeFileSync(abs, local);
      dropBackup();
    },
    // After the merge: our local changes (since `before`) over the merged tracker. Returns a note on failure.
    reapply() {
      try {
        const base = gitTry(top, ["show", `${before}:${trackerRel}`]);
        const merged = fs.readFileSync(abs, "utf8");
        writeStatus(
          projectDir,
          mergeTaskTrackers(parseTracker(base.ok ? base.out : ""), parseTracker(local), parseTracker(merged))
        );
        dropBackup();
        return null;
      } catch (err) {
        // The backup stays; the exit handler names it (once, last).
        return `could not re-apply the main checkout's own task-tracker changes (${err.message})${backedUp ? "" : "; no backup of them could be written"}`;
      }
    },
  };
}

// `173`: after a `git merge` that stopped on conflicts, resolve a conflicted TASK TRACKER by merging it
// task by task (merge base, ours, theirs from the index stages). When it was the only conflicting
// file, the merge commit is completed and its result returned; otherwise null (the merge stays
// stopped, the caller lists the other files and aborts).
function resolveTrackerConflict(cwd, top, trackerRel) {
  if (!gitTry(cwd, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).ok) return null;
  const conflicted = () =>
    gitTry(top, ["-c", "diff.relative=false", "diff", "--name-only", "--diff-filter=U", "-z"])
      .out.split("\0")
      .filter(Boolean);
  if (!conflicted().includes(trackerRel)) return null;
  const stage = (n) => {
    const r = gitTry(top, ["show", `:${n}:${trackerRel}`]);
    return parseTracker(r.ok ? r.out : "");
  };
  try {
    writeStatus(projectDir, mergeTaskTrackers(stage(1), stage(2), stage(3)));
  } catch {
    return null;
  }
  if (!gitTry(top, ["add", "--", trackerRel]).ok) return null;
  if (conflicted().length) return null;
  const done = gitTry(cwd, ["commit", "--no-edit"]);
  return done.ok ? done : null;
}

function mergeWorktreeTask(arg) {
  // `103`: a freeform run's worktree has no task file or queue entry; it is named by its branch
  // (freeform-<short id>) and merged by exactly the same steps below, minus the "task is done" check.
  const freeform = isFreeformBranch(path.basename(arg));
  const { filename, status } = freeform ? { filename: path.basename(arg), status: "done" } : resolveTaskName(arg);
  const branch = freeform ? filename : worktreeBranchFor(filename);
  if (!branch && /^\d+$/.test(filename))
    refuse(
      `no task numbered ${filename} is in the queue or in branch task-${filename}'s tracker, so it is not "done" — name the task file, or finish the task (and mark it done) first`
    );
  if (!branch) refuse(`"${filename}" has no task number, so it has no task branch`);

  // `170`: the TARGET first. A merge lands in whatever the main checkout has checked out, so it
  // runs only on the default branch, with no tracked changes beyond Maestro's own state files.
  const top = gitTopLevel(gitTry, projectDir);
  const trackerRel = trackerRelPath(top, projectDir);
  refuseOverLeftBackup(top);
  const target = checkTargetCheckout(gitTry, projectDir);
  if (!target.ok) {
    // `173`: tracked changes the merge would overwrite are named one by one, each compared with the
    // branch's copy, with the commands that resolve them. Nothing is restored or stashed here.
    if (target.kind === "dirty" && branchExists(branch))
      refuseOverwritten(top, branch, overwrittenByMerge(gitTry, top, branch, [trackerRel]) || [], target.paths);
    refuse(target.message, targetCheckoutHint(target));
  }
  const base = { out: target.branch };

  // `173`: a task committed on its branch in the main checkout carries its `done` in the branch's
  // tracker; after switch-back the default branch's tracker does not have it yet. The branch's word
  // is enough: the merge brings that tracker change in itself, so no manual `done` is needed first.
  const doneOnBranch =
    !freeform &&
    status !== "done" &&
    branchExists(branch) &&
    trackerMarksDone(gitTry, top, branch, trackerRel, filename);
  if (status !== "done" && !doneOnBranch) {
    refuse(
      `"${filename}" is ${status ? `"${status}"` : "not in the queue"}, not "done" — finish the task (and mark it done) first`
    );
  }
  if (!branchExists(branch)) refuse(`branch ${branch} does not exist`);
  // `170`: a branch with no worktree (the task was committed on task-NNN in the main checkout, then
  // the checkout switched back) is merged the same way; only the worktree checks and removal are skipped.
  const wtPath = worktreeForBranch(branch);
  if (wtPath && path.resolve(wtPath) === path.resolve(projectDir))
    refuse(`branch ${branch} is checked out in the main checkout itself`);

  if (wtPath) {
    // Uncommitted work in the worktree would be thrown away by the removal. Untracked
    // .claude/maestro.json is the copy `worktree` made; everything else gitignored never shows here.
    const dirty = gitTry(wtPath, ["status", "--porcelain"]);
    if (!dirty.ok) refuse(`could not read the worktree ${wtPath} (${dirty.err})`);
    const dirtyLines = dirty.out.split("\n").filter((l) => l && l !== "?? .claude/maestro.json" && l !== "?? .claude/");
    if (dirtyLines.length) {
      refuse(
        `worktree ${wtPath} has uncommitted changes (${dirtyLines.length} path(s), e.g. ${dirtyLines[0].trim()}) — commit or discard them first`,
        commitSuggestion(
          freeform ? null : filename,
          branch,
          wtPath,
          dirty.out.split("\n").includes("?? .claude/maestro.json")
        )
      );
    }

    // `163`: ignored paths that exist only in the worktree are not in the commit and die with the
    // worktree. Stop with the list unless the user waived it (task or freeform branch alike).
    if (!process.argv.slice(2).includes("--accept-ignored")) {
      // `173`: the worktree is a checkout of the whole repository, so its paths are repo paths and are
      // looked up in the main checkout's top level, not in the project directory below it.
      const lost = ignoredOnlyInWorktree(gitTry, top, wtPath);
      if (lost.length) {
        refuse(
          `${lost.length} ignored path(s) exist only in the worktree ${wtPath} and would be lost`,
          formatIgnoredNotice(lost, wtPath).trimEnd()
        );
      }
    }
  }

  const colliding = collidingUntracked(top, branch);
  if (colliding.length) {
    refuse(
      `${colliding.length} untracked file(s) in the main checkout (${top}) would be overwritten by the merge`,
      colliding
        .map((c) =>
          c.identical
            ? `  ${c.rel} — identical to ${branch}'s copy (safe to delete)`
            : `  ${c.rel} — DIFFERENT from ${branch}'s copy (needs a look before deleting)`
        )
        .join("\n") + "\nDelete or move each one (the user decides), then ask for the merge again."
    );
  }

  // `173`: Maestro's own state files are allowed to be dirty on the target, but git still refuses to
  // overwrite one the branch also changes. The TASK TRACKER is Maestro's to merge (below); any other
  // such file is named, with the resolving commands, before git gets to refuse it bare.
  const overwritten = overwrittenByMerge(gitTry, top, branch) || [];
  refuseOverwritten(
    top,
    branch,
    overwritten.filter((o) => o.rel !== trackerRel),
    []
  );
  const tracker = overwritten.some((o) => o.rel === trackerRel) ? setAsideTracker(top, trackerRel) : null;

  let merged = gitTry(projectDir, [
    "merge",
    "--no-ff",
    "-m",
    freeform ? `Merge ${branch} (freeform run)` : `Merge ${branch} (${filename})`,
    branch,
  ]);
  // `173`: a conflict in the tracker alone is resolved by merging it task by task; the merge commit
  // then completes. Any other conflicting file still aborts the merge below.
  if (!merged.ok) {
    const resolved = resolveTrackerConflict(projectDir, top, trackerRel);
    if (resolved) merged = resolved;
  }
  if (!merged.ok) {
    // The tracker set aside above goes back only after any abort: `merge --abort` rewrites it.
    if (SANDBOX_DENIAL.test(`${merged.err}\n${merged.out}`)) {
      if (gitTry(projectDir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).ok)
        gitTry(projectDir, ["merge", "--abort"]);
      if (tracker) tracker.restore();
      process.stdout.write(
        `Maestro tasks: merge SANDBOX-BLOCKED — git could not write into the main checkout (${merged.err.split("\n")[0] || "write denied"}). ` +
          `Do NOT retry it from this session. Check \`git -C ${shellQuote(projectDir)} status\` for a half-applied merge, then ask the user to run:\n` +
          `  ! CLAUDE_PROJECT_DIR=${shellQuote(projectDir)} node ${shellQuote(__filename)} merge ${shellQuote(filename)}\n`
      );
      process.exit(1);
    }
    // Repo paths (relative to `top`), the form generatedLibResolution matches.
    const conflicts = gitTry(top, ["-c", "diff.relative=false", "diff", "--name-only", "--diff-filter=U"])
      .out.split("\n")
      .filter(Boolean);
    const mergeStarted = gitTry(projectDir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).ok;
    if (mergeStarted) gitTry(projectDir, ["merge", "--abort"]);
    if (tracker) tracker.restore();
    // `173`: a file rewritten after the check above (a background tool racing the merge) still gets
    // the named refusal, from git's own list.
    const raced = conflicts.length ? [] : parseOverwriteError(`${merged.err}\n${merged.out}`);
    if (raced.length) {
      refuse(
        `${raced.length} locally modified file(s) in the main checkout (${projectDir}) would be overwritten by merging ${branch} (changed while the merge started)`,
        formatOverwriteRefusal(top, branch, compareWithBranch(gitTry, top, branch, raced))
      );
    }
    if (conflicts.length) {
      process.stdout.write(
        `Maestro tasks: merge CONFLICT merging ${branch} into ${base.out} (origin/HEAD). The merge was aborted; ${base.out} is unchanged, and ${wtPath ? `the worktree (${wtPath}) and ` : ""}branch ${branch} ${wtPath ? "are" : "is"} intact.\n` +
          `Conflicting files:\n${conflicts.map((f) => `  ${f}`).join("\n")}\n` +
          (wtPath
            ? `To resolve: in ${wtPath} run \`git merge ${base.out}\`, fix those files, commit, then ask for the merge again.`
            : `To resolve: switch to ${branch}, run \`git rebase ${base.out}\` (or \`git merge ${base.out}\`), fix those files, commit, switch back, then ask for the merge again.`) +
          ` Do NOT resolve them for the user without asking.\n` +
          (generatedLibResolution(conflicts) || "")
      );
    } else {
      process.stdout.write(
        `Maestro tasks: merge of ${branch} into ${base.out} (origin/HEAD) did not complete (${merged.err.split("\n")[0] || "git refused"}); nothing changed, ${wtPath ? "worktree and " : ""}branch intact.\n`
      );
    }
    process.exit(1);
  }

  // `173`: merged. The main checkout's own tracker changes (set aside before the merge) go back on top
  // of the merged tracker, task by task, FIRST: nothing below may run between a landed merge and
  // this, or a failure there would leave those changes only in the backup.
  const notes = [];
  if (tracker) {
    const err = tracker.reapply();
    if (err) notes.push(err);
  }

  // Clean up: the worktree (no --force: git itself refuses if something is left), the
  // branch (-d: only deletes a fully merged branch), and any session pointer aimed at the worktree.
  let rm = { ok: true };
  if (wtPath) {
    // `worktree` moved the session's state (log.jsonl included) into the worktree; removing it would
    // delete the log before SessionEnd, leaving /maestro-post-mortem nothing to read. Bring it home.
    const restored = restoreSessionsFrom(wtPath);
    if (restored.error) notes.push(`could not copy session state back from the worktree (${restored.error})`);
    rm = gitTry(projectDir, ["worktree", "remove", wtPath]);
    if (!rm.ok)
      notes.push(`could not remove worktree ${wtPath} (${rm.err.split("\n")[0]}) — remove it yourself when sure`);
  }
  if (rm.ok) {
    const del = gitTry(projectDir, ["branch", "-d", branch]);
    if (!del.ok) notes.push(`could not delete branch ${branch} (${del.err.split("\n")[0]})`);
  }
  if (wtPath && rm.ok) dropPointersTo(wtPath);
  if (target.untracked.length)
    notes.push(
      `the main checkout also holds ${target.untracked.length} untracked path(s) (e.g. ${target.untracked[0]}), so the verified tree is the merge plus those`
    );
  // `146`: the work is merged now, so clear `unmerged` and recompute the cascade: an epic task that
  // was waiting on this one becomes ready.
  let cascade = "";
  if (!freeform) {
    try {
      const r = markMerged(projectDir, filename);
      if (r.done) cascade = `\n  Marked "${filename}" merged — ${summary(r.map)}`;
    } catch (err) {
      notes.push(`could not clear the unmerged flag (${err.message}) — run \`mark-merged ${filename}\``);
    }
  }
  process.stdout.write(
    `Maestro tasks: merged ${branch} into ${base.out} (origin/HEAD)` +
      (wtPath && rm.ok
        ? `; removed worktree ${wtPath} and branch ${branch}.`
        : rm.ok
          ? `; deleted branch ${branch}.`
          : ".") +
      cascade +
      (notes.length ? `\n  note: ${notes.join("\n  note: ")}` : "") +
      "\n  Nothing was pushed.\n"
  );
  // `170`: the merged result is verified here, with the project's own command, every time.
  return verifyMerged();
}

// `170`: run the project's full verification on the merged result (verify_command in maestro.json,
// else the detected package.json script) and say plainly whether it passed. Never claims a pass it
// did not see: with no command it says the result is UNVERIFIED. Exit code for the CLI: 1 on a failure.
function verifyMerged() {
  const verify = resolveVerifyCommand(projectDir);
  if (verify.kind === "command") {
    process.stdout.write(
      `Maestro tasks: verifying the merged result in ${projectDir}: \`${verify.command}\` (${verify.source})\n`
    );
    const run = spawnSync(verify.command, { cwd: projectDir, shell: true, stdio: ["ignore", "inherit", "inherit"] });
    const code = run.error ? null : run.status;
    process.stdout.write(`Maestro tasks: ${formatVerifyResult(verify, code)}\n`);
    return code === 0 ? 0 : 1;
  }
  process.stdout.write(`Maestro tasks: ${formatVerifyResult(verify, null)}\n`);
  return 0;
}

// `170`: this script as a command the user can run from anywhere (absolute paths; the session's cwd
// may be a worktree).
function selfCommand(sub) {
  return `CLAUDE_PROJECT_DIR=${shellQuote(projectDir)} node ${shellQuote(__filename)} ${sub}`;
}

const TASK_OR_FREEFORM_BRANCH = /^(?:task-\d+|freeform-[a-z0-9]{1,8})$/;

// What to do about a refused merge target (`170`).
function targetCheckoutHint(target) {
  if (target.kind === "not-default") {
    const committed = TASK_OR_FREEFORM_BRANCH.test(target.branch || "")
      ? `If ${target.branch} holds a task's work, commit it there first (the user approves the commit). `
      : "";
    return (
      `${committed}Then switch the main checkout back to ${target.defaultBranch} (origin/HEAD):\n` +
      `  ${selfCommand("switch-back")}\n` +
      `It checks first that every path the switch rewrites is writable, and prints the exact \`!\` command for the user when it is not. Then ask for the merge again.`
    );
  }
  if (target.kind === "dirty") {
    const shown = target.paths.slice(0, 10).map((p) => `  ${p}`);
    if (target.paths.length > shown.length) shown.push(`  ... and ${target.paths.length - shown.length} more`);
    return `${shown.join("\n")}\nThese belong to whoever changed them: ask the user before committing, stashing or discarding any of them.`;
  }
  if (target.kind === "no-default")
    return "Fix origin/HEAD with `git remote set-head origin --auto` (or `git remote set-head origin <branch>`), then ask again.";
  return "";
}

// `170`: return the main checkout to the default branch, without ever stopping halfway.
//
// Refuses (changing nothing) on a detached HEAD, a merge or rebase in progress, or tracked changes
// outside Maestro's state files (they would ride along onto the default branch). Before switching
// it checks every path the switch rewrites is writable by THIS process: the sandbox mounts some
// paths read-only (.claude/skills, .claude/scripts, settings), and a `git switch` that hits one
// stops partway with HEAD moved and files stale. When any is not writable, or the switch fails
// anyway, it prints the exact `!` command for the user.
function switchBack() {
  const def = defaultBranch(gitTry, projectDir);
  const say = (s) => process.stdout.write(`Maestro tasks: ${s}\n`);
  const no = (s, extra) => {
    say(`switch-back REFUSED — ${s}. Nothing was changed.${extra ? `\n${extra}` : ""}`);
    return 1;
  };
  if (!def) return no(originHeadUnsetMessage(projectDir));
  const cur = currentBranch(gitTry, projectDir);
  if (cur === def) {
    say(`the main checkout (${projectDir}) is already on ${def} (the default branch, origin/HEAD); nothing to do.`);
    return 0;
  }
  if (gitTry(projectDir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).ok)
    return no(`the main checkout (${projectDir}) is in the middle of a merge — finish or abort it first`);
  for (const p of ["rebase-merge", "rebase-apply"]) {
    const r = gitTry(projectDir, ["rev-parse", "--git-path", p]);
    if (r.ok && fs.existsSync(path.resolve(projectDir, r.out)))
      return no(`the main checkout (${projectDir}) is in the middle of a rebase — finish or abort it first`);
  }
  const dirty = dirtyTrackedPaths(gitTry, projectDir);
  if (dirty === null) return no(`could not read the status of ${projectDir}`);
  if (dirty.length)
    return no(
      `the main checkout (${projectDir}) has uncommitted changes to ${dirty.length} tracked path(s) (e.g. ${dirty[0]}) on ${cur || "a detached HEAD"}`,
      `Commit them on ${cur || "a branch"} first (the user approves the commit), or ask the user what to do with them, then run switch-back again.`
    );
  const manual = switchCommandFor(projectDir, def);
  // `173`: repo paths (relative to the git top level), so the write check joins them onto the top
  // level, not onto the project directory, which may sit below it.
  const changed = pathsChangedBetween(gitTry, projectDir, "HEAD", def);
  if (changed === null) return no(`could not compare HEAD with ${def} (origin/HEAD)`);
  const blocked = unwritablePaths(gitTopLevel(gitTry, projectDir), changed);
  if (blocked.length) {
    say(
      `switch-back SANDBOX-BLOCKED — the switch to ${def} (origin/HEAD) rewrites ${blocked.length} path(s) this session cannot write (e.g. ${blocked[0]}). ` +
        `Nothing was changed and the switch was not attempted. Do NOT retry it from this session; ask the user to run:\n  ${manual}`
    );
    return 1;
  }
  const r = gitTry(projectDir, ["switch", def]);
  if (r.ok) {
    say(`switched the main checkout (${projectDir}) from ${cur || "a detached HEAD"} to ${def} (origin/HEAD).`);
    return 0;
  }
  const reason = (r.err || "").split("\n")[0] || "git refused";
  const now = currentBranch(gitTry, projectDir);
  const after = dirtyTrackedPaths(gitTry, projectDir) || [];
  if (now === cur && after.length === 0) {
    say(
      `switch-back FAILED — \`git switch ${def}\` (origin/HEAD) refused (${reason}); the main checkout is unchanged on ${cur || "a detached HEAD"}. ` +
        `Do NOT retry it from this session; ask the user to run:\n  ${manual}`
    );
    return 1;
  }
  say(
    `switch-back STOPPED PARTWAY — \`git switch ${def}\` (origin/HEAD) failed (${reason}). HEAD is now ${now || "detached"} and ${after.length} tracked path(s) were left half-switched (e.g. ${after[0] || "?"}). ` +
      `The tree had no tracked changes before the switch, so these should be only the failed switch's. Do not commit, merge, discard or switch from this session. Ask the user to look first:\n` +
      `  ! git -C ${shellQuote(projectDir)} status\n` +
      `Only if every listed change is one the switch left (nothing the user wants to keep), finishing the switch to ${def} (origin/HEAD) is \`git -C ${shellQuote(projectDir)} switch --discard-changes ${shellQuote(def)}\`, which DISCARDS uncommitted changes to tracked files: the user decides and runs it.`
  );
  return 1;
}

// Copy every session directory under the worktree's .claude/maestro_sessions/ back into the main
// checkout's, over the pointer-only directory `worktree` left there. The copied session.json loses
// its `worktree` block: that path is about to be removed, and agents are told to work inside it.
// The pointer itself is dropped by `dropPointersTo` once the removal succeeded.
function restoreSessionsFrom(wtPath) {
  const src = path.join(wtPath, ".claude", "maestro_sessions");
  const dest = path.join(projectDir, ".claude", "maestro_sessions");
  try {
    if (!fs.existsSync(src)) return { count: 0 };
    let count = 0;
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const to = path.join(dest, entry.name);
      copyDir(path.join(src, entry.name), to);
      const stateFile = path.join(to, "session.json");
      try {
        const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
        if (state && state.worktree && path.resolve(state.worktree.path) === path.resolve(wtPath)) {
          delete state.worktree;
          fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
        }
      } catch {
        // no session.json, or unreadable: the log is what matters here
      }
      count++;
    }
    return { count };
  } catch (err) {
    return { error: err.message };
  }
}

// A session whose worktree.json points at a removed worktree would keep redirecting its state there.
function dropPointersTo(wtPath) {
  const root = path.join(projectDir, ".claude", "maestro_sessions");
  let ids = [];
  try {
    ids = fs.readdirSync(root);
  } catch {
    return;
  }
  for (const id of ids) {
    const file = path.join(root, id, SESSION_WORKTREE_NAME);
    try {
      const ptr = JSON.parse(fs.readFileSync(file, "utf8"));
      if (ptr && path.resolve(ptr.path) === path.resolve(wtPath)) fs.rmSync(file, { force: true });
    } catch {
      // not a pointer we can read — leave it
    }
  }
}

// ── the success-path tracker (`083`) ────────────────────────────────────────
// TaskCreate has repeatedly been unavailable in orchestrator sessions, and Step 3 plus the
// mark-task-done node both assumed it. With no task graph the orchestrator tracked the path from
// memory — and dropped human review or the final `done`. This is the fallback: the planned path
// and its progress live in THIS session's session.json under `plan`, updated through these
// commands, and `done` refuses while any planned step is still pending (so mark-task-done still
// runs only after every prior step, including human review). A session that never recorded a plan
// (TaskCreate worked) is not affected.

function sessionStateFile() {
  const sess = resolveSessionPaths(path.join(projectDir, ".claude"));
  return sess ? sess.state : null;
}

function readSessionState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) || {};
  } catch {
    return {};
  }
}

function writeSessionState(file, state) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

// The recorded plan, or null when there is none (or no resolvable session).
function readPlan() {
  const file = sessionStateFile();
  if (!file) return null;
  const plan = readSessionState(file).plan;
  return plan && Array.isArray(plan.steps) && plan.steps.length ? plan : null;
}

function renderPlan(plan) {
  const next = plan.steps.findIndex((s) => s.status !== "done");
  const lines = plan.steps.map(
    (s, i) => `  ${i + 1}. [${s.status === "done" ? "x" : " "}] ${s.label}${i === next ? "   <- next" : ""}`
  );
  return (
    lines.join("\n") +
    "\n" +
    (next === -1
      ? "Every planned step is done — you may run `done` (mark-task-done)."
      : `Not finished: ${plan.steps.filter((s) => s.status !== "done").length} step(s) pending — \`done\` will refuse until they are done.`)
  );
}

function requireSessionFile(what) {
  const file = sessionStateFile();
  if (!file) {
    process.stderr.write(`maestro-task-status: no resolvable session id — cannot ${what}\n`);
    process.exit(1);
  }
  return file;
}

function planCommand(labels) {
  if (!labels.length) {
    process.stderr.write(
      'maestro-task-status: "plan" needs the success-path step labels, in order (e.g. plan "@backend" "human review" "@scribe")\n'
    );
    process.exit(1);
  }
  const file = requireSessionFile("record a plan");
  const state = readSessionState(file);
  state.plan = { steps: labels.map((label) => ({ label, status: "pending" })), updated_at: new Date().toISOString() };
  writeSessionState(file, state);
  process.stdout.write(`Maestro plan: recorded ${labels.length} step(s).\n${renderPlan(state.plan)}\n`);
}

// done: mark the FIRST pending step with that label done. pending: a loop-back — reset the LAST done
// step with that label AND every step after it, because everything downstream has to run again
// (except a manager review that is already done, see below).
function planStepCommand(label, status) {
  if (!label || (status !== "done" && status !== "pending")) {
    process.stderr.write('maestro-task-status: usage: plan-step "<label>" <done|pending>\n');
    process.exit(1);
  }
  const file = requireSessionFile("update the plan");
  const state = readSessionState(file);
  const plan = state.plan;
  if (!plan || !Array.isArray(plan.steps) || !plan.steps.length) {
    process.stderr.write('maestro-task-status: no plan recorded for this session — run `plan "<step>" ...` first\n');
    process.exit(1);
  }
  let index = -1;
  if (status === "done") index = plan.steps.findIndex((s) => s.label === label && s.status !== "done");
  else {
    for (let i = plan.steps.length - 1; i >= 0; i--) {
      if (plan.steps[i].label === label) {
        index = i;
        break;
      }
    }
  }
  if (index === -1) {
    process.stderr.write(
      `maestro-task-status: no ${status === "done" ? "pending " : ""}plan step labelled "${label}" — steps are: ${plan.steps.map((s) => `"${s.label}"`).join(", ")}\n`
    );
    process.exit(1);
  }
  if (status === "done") plan.steps[index].status = "done";
  else {
    // `150`: a manager review that already passed (on-track) after the target is NOT reverted — the
    // manager checks direction once; a test or reviewer loop-back does not reopen it. A redirect
    // leaves the stop unfinished, so it re-runs by itself. A stop named as the target still resets.
    for (let i = index; i < plan.steps.length; i++) {
      if (i > index && plan.steps[i].label === "manager review" && plan.steps[i].status === "done") continue;
      plan.steps[i].status = "pending";
    }
    // `130`: each loop-back starts a new human-review round (its own review file).
    plan.loopbacks = (typeof plan.loopbacks === "number" ? plan.loopbacks : 0) + 1;
  }
  plan.updated_at = new Date().toISOString();
  writeSessionState(file, state);
  process.stdout.write(`Maestro plan: "${label}" -> ${status}.\n${renderPlan(plan)}\n`);
}

function planShowCommand() {
  const plan = readPlan();
  process.stdout.write(
    plan ? `Maestro plan:\n${renderPlan(plan)}\n` : "Maestro plan: none recorded for this session.\n"
  );
}

// `160`: the SubagentStop hook's judgement (`maestro-subagent-log.js`) applied to a hand-back that
// landed after the stop returned: `checkHandoff`, then `checkRoute` against the active workflow, then
// `checkPayload` measured from the agent's first dispatch. Returns the issue, or null when valid.
function judgeLandedHandback(stop, message, transcript, runSince, state) {
  let issue = checkHandoff(message);
  if (issue) return issue;
  const claudeDir = path.join(projectDir, ".claude");
  const cfg = readJsonFile(path.join(claudeDir, "maestro.json"));
  if (!cfg || cfg.version !== 3) return null;
  const { searchList, activeWorkflowName } = resolveSearchList(cfg, state);
  const instances = cfg.workflow_instances || [];
  if (activeWorkflowName && searchList.length && searchList.every((w) => w.name === activeWorkflowName)) {
    issue = checkRoute(message, routesFrom(handoffRoutes(searchList, instances), stop.agent), activeWorkflowName);
    if (issue) return issue;
  }
  const cwd = stop.cwd || projectDir;
  const scope = stop.scope;
  if (!scope) return null;
  const sess = resolveSessionPaths(claudeDir);
  let since = null;
  try {
    since = sess ? agentRunStartedAt(readLogLines(sess.log), stop.agent_id) : null;
  } catch {
    since = null;
  }
  const prof = runProfile(transcript, runSince);
  if (prof.resumed && !prof.wroteFiles) return null;
  const routes = routesFrom(handoffRoutes(searchList, instances), stop.agent);
  const hints = routesFrom(testHintRoutes(searchList, instances), stop.agent);
  return checkPayload(message, payloadRoutes(cwd, scope, [...routes, ...hints], readGlobalHandoff), (r) =>
    payloadWrittenSince(cwd, r, since)
  );
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Read-and-clear the handoff problems the SubagentStop hook recorded since the orchestrator last asked.
function handoffIssuesCommand() {
  const file = sessionStateFile();
  const state = file ? readSessionState(file) : {};
  // A `missing_payload` whose files are all in their lane now, stamped with THIS run's id, is
  // resolved (a resumed agent's earlier file still exists): reporting it sends the orchestrator after
  // a file that is already there. Same check `maestro-resume-target.cjs` makes (`139`).
  // `160`: a stop with no hand-back was not judged when it happened (it may be mid-run). One that
  // the orchestrator moved on from, or that this command already showed once with no resume since,
  // was a final stop: it becomes a `missing` issue now. The rest stay pending and are noted below.
  // A hand-back that reached the transcript after the stop's bounded wait settles the marker instead,
  // judged like an on-time one: HANDOFF line, route in the active workflow, payload from the whole run.
  const settledAt = new Date().toISOString();
  const settled = settleInterimStops(state.pending_interim, settledAt, (stop) => {
    if (!stop.transcript_path) return null;
    try {
      const text = fs.readFileSync(stop.transcript_path, "utf8");
      const runSince = typeof stop.run_since === "number" ? stop.run_since : null;
      const landed = landedHandback(text, runSince);
      if (!landed) return null;
      return { issue: judgeLandedHandback(stop, landed.message, text, runSince, state), message: landed.message };
    } catch {
      return null;
    }
  });
  // `169`: session state drops a settled marker (and the printed issue below), so the session log
  // gets one durable `interim_settled` line per settlement, appended once the state write that
  // removes the marker has happened (a marker is settled, and recorded, exactly once).
  const logSettlements = () => {
    for (const s of settled.settled) {
      try {
        appendSessionLog(path.join(projectDir, ".claude"), interimSettleEntry(s, settledAt));
      } catch {
        // Best-effort: the printed issue still reaches the orchestrator.
      }
    }
  };
  const stillPending = Object.values(settled.pending);
  const hadPending = state.pending_interim && Object.keys(state.pending_interim).length > 0;
  if (hadPending) {
    if (stillPending.length) state.pending_interim = settled.pending;
    else delete state.pending_interim;
  }
  const recorded = [
    ...(Array.isArray(state.handoff_issues) ? state.handoff_issues : []),
    ...settled.issues.filter(
      (s) => !(state.handoff_issues || []).some((i) => i.kind === "missing" && i.agent_id === s.agent_id)
    ),
  ];
  const pendingNote = stillPending.length
    ? `Maestro handoffs: ${stillPending.map((p) => p.agent).join(", ")} stopped without a HANDOFF line (not flagged yet: it may be waiting on background work). Resume it if so; if the next handoff check still finds it stopped, it is flagged missing.\n`
    : "";
  let issues = recorded;
  if (recorded.some((i) => i && i.kind === "missing_payload") && typeof state.run_id === "string" && state.run_id) {
    try {
      // `144`: a recorded file names its scope — `.claude/channels/<scope>/<receiver>/…` — and was
      // recorded by this session, so it is this session's scope. A legacy unscoped path matches no
      // scope and is never looked up (it is never delivered either).
      const present = [];
      const lanes = new Map();
      for (const i of recorded) {
        if (!i || i.kind !== "missing_payload") continue;
        for (const f of i.files || []) {
          const m = /^\.claude\/channels\/([^/]+)\/([^/]+)\//.exec(f);
          if (m && isChannelScope(m[1])) lanes.set(`${m[1]}/${m[2]}`, { scope: m[1], receiver: m[2] });
        }
      }
      for (const { scope, receiver } of lanes.values()) {
        present.push(...pendingResumeDeliveries(projectDir, scope, receiver, state.run_id));
      }
      // `156`: only a file written after the warning resolves it; an earlier run's file of the
      // same session carries the same run_id and must not.
      issues = dropResolvedMissingPayloads(recorded, present, (f) => channelFileMtime(projectDir, f));
    } catch {
      issues = recorded;
    }
  }
  if (!issues.length) {
    if (recorded.length || hadPending) {
      delete state.handoff_issues;
      writeSessionState(file, state);
      logSettlements();
    }
    process.stdout.write(`Maestro handoffs: no problems recorded.\n${pendingNote}`);
    return;
  }
  // `087` adds `missing_payload`: the route taken expects a payload the sender never wrote.
  // `108` adds `unrouted`: a condition label the active workflow has no edge for.
  const what = (i) =>
    i.kind === "missing"
      ? "NO HANDOFF line"
      : i.kind === "missing_payload"
        ? `NO PAYLOAD written for HANDOFF: ${i.label}${i.agent_id ? ` (agent_id ${i.agent_id})` : ""}`
        : i.kind === "unrouted"
          ? `NO ROUTE for HANDOFF: ${i.label}`
          : i.kind === "blocked"
            ? "BLOCKED on the user (setup or environment)"
            : "verdict FAIL but HANDOFF: success";
  const lines = issues.map(
    (i) => `  - ${i.agent}: ${what(i)}` + `${i.verdict ? ` (verdict ${i.verdict})` : ""}. ${i.message}`
  );
  const wt = state.worktree;
  const inWorktree = wt && typeof wt.path === "string" && wt.path;
  const payloadIssues = issues.filter((i) => i.kind === "missing_payload");
  // `104`: in a worktree run the agent's channel write (a cross-checkout write into the main
  // checkout) is intermittently denied by the auto-mode classifier — not by a Maestro hook, whose
  // guard allows this session's .claude/channels/<scope>/. Resuming the agent to retry the write just meets the same
  // judgement, so the sanctioned path is: the agent returns the payload, the orchestrator writes it.
  const worktreeNote =
    inWorktree && payloadIssues.length
      ? '\nWorktree run — the missing-payload advice above ("resume this agent and ask it to write that file") is replaced by this:\n' +
        "  - Writing into the main checkout's .claude/channels/<scope>/ from a worktree is intermittently denied by the permission classifier. The sanctioned path is that YOU write the channel file for the agent.\n" +
        "  - Find the payload in the agent's final message (the JSON block it returned). Write its body (no stamp line) with the Write tool to exactly the named file — its .claude/channels/<scope>/<receiver>/ path, scope included — under the MAIN checkout (absolute path)" +
        `${wt.main_root ? ` — ${wt.main_root}/<that path>` : ""}. This is a Maestro-sanctioned write; it needs no user approval, so do not ask the user.\n` +
        "  - If the agent returned no payload, resume it (SendMessage to its agent_id) and ask for the payload JSON in its final message, not for a file write. Never invent or reconstruct one yourself.\n" +
        "  - A file you write is unstamped, so the receiver's SubagentStart only mentions it. Name the file's path in the receiver's dispatch (or SendMessage) prompt and tell it to Read it first.\n"
      : "";
  delete state.handoff_issues;
  writeSessionState(file, state);
  logSettlements();
  process.stdout.write(
    `Maestro handoffs: ${issues.length} problem(s) — route deliberately, never default to success:\n${lines.join("\n")}\n${worktreeNote}${pendingNote}`
  );
}

// The epic report command `done` prints for a task in an epic ("" for one in no epic). The epic
// bundle is required lazily so a project without it still marks tasks done.
function epicReportCommand(filename, sessionName) {
  try {
    const { reportCommandFor } = require("./lib/maestro-epic.cjs");
    return reportCommandFor(projectDir, filename, sessionName) || "";
  } catch {
    return "";
  }
}

function counts(map) {
  const c = { done: 0, ready: 0, blocked: 0 };
  for (const k of Object.keys(map)) {
    const s = map[k] && map[k].status;
    if (s in c) c[s] += 1;
  }
  return c;
}

function summary(map) {
  const c = counts(map);
  return `${Object.keys(map).length} task(s): ${c.done} done, ${c.ready} ready, ${c.blocked} blocked`;
}

try {
  if (command === "sync") {
    const map = sync(projectDir);
    process.stdout.write(`Maestro tasks: synced — ${summary(map)}\n`);
    process.exit(0);
  }

  if (command === "done") {
    const target = arg || activeTaskFromSession();
    if (!target) {
      process.stderr.write(
        'maestro-task-status: "done" needs a task filename (e.g. done 002-add-login.md), ' +
          "and no active_task is recorded for this session\n"
      );
      process.exit(1);
    }
    const filename = path.basename(target); // tolerate a path; key on the bare filename
    const plan = readPlan();
    const pending = plan ? plan.steps.filter((s) => s.status !== "done") : [];
    if (pending.length) {
      process.stdout.write(
        `Maestro tasks: done REFUSED — the recorded plan still has ${pending.length} unfinished step(s) ` +
          `(${pending.map((s) => `"${s.label}"`).join(", ")}). Nothing was marked done. Finish them — a human review stops for the user's approval — ` +
          'and mark each one with `plan-step "<label>" done`, then run `done` again.\n'
      );
      process.exit(1);
    }
    // `135`: a task whose worktree has no installed dependencies cannot have been tested there.
    const doneSession = ownSessionId();
    const doneWorktree = doneSession ? readWorktreePointer(path.join(projectDir, ".claude"), doneSession) : null;
    const doneNotice = doneWorktree ? missingDependenciesNotice(doneWorktree.path) : null;
    if (doneNotice) {
      process.stdout.write(`Maestro tasks: done REFUSED — nothing was marked done. ${doneNotice}`);
      process.exit(1);
    }
    // `146`: a task that ran in a worktree is done but not merged; it stays `unmerged` (and keeps its
    // epic dependents blocked) until `merge` or `mark-merged` clears it.
    const ranInWorktree = !!doneWorktree && !doneWorktree.freeform;
    const { map, marked } = markDone(projectDir, filename, { unmerged: ranInWorktree });
    if (!marked) {
      process.stderr.write(
        `maestro-task-status: no task file "${filename}" under .claude/maestro-tasks/ — nothing marked done\n`
      );
      process.exit(1);
    }
    // Read the claim's session name BEFORE deleting it: it is the report's sender.
    const claimed = readClaimFile(claimPathFor(filename));
    const claimedName = claimed && typeof claimed.session_name === "string" ? claimed.session_name : null;
    deleteClaimIfAny(filename); // `066`: a done task has nothing left for a claim to protect
    process.stdout.write(`Maestro tasks: marked "${filename}" done — ${summary(map)}\n`);
    if (ranInWorktree) {
      process.stdout.write(
        `  "${filename}" is done but NOT merged: tasks in an epic that depend on it stay blocked until it is merged (ask the user for the merge, or run \`mark-merged ${filename}\` after a hand merge).\n`
      );
    }
    // `163`: Step 4 runs before the commit is offered, so this only warns; `merge` is what refuses.
    if (doneWorktree) {
      try {
        // `173`: repo paths, looked up in the main checkout's top level (see `merge`).
        const lost = ignoredOnlyInWorktree(gitTry, gitTopLevel(gitTry, projectDir), doneWorktree.path);
        if (lost.length) process.stdout.write(formatIgnoredNotice(lost, doneWorktree.path));
      } catch {
        // best effort
      }
    }
    // `170`: a task worked on a branch in the MAIN checkout leaves it off the default branch, where a
    // later merge would land in the wrong place. Say so now: commit there, then switch back.
    if (!doneWorktree) {
      try {
        const def = defaultBranch(gitTry, projectDir);
        const cur = currentBranch(gitTry, projectDir);
        if (def && cur && cur !== def) {
          process.stdout.write(
            `  The main checkout (${projectDir}) is on ${cur}, not the default branch ${def} (origin/HEAD). Commit the task's work on ${cur} (the user approves the commit), then switch back:\n` +
              `    ${selfCommand("switch-back")}\n`
          );
        }
      } catch {
        // best effort
      }
    }
    process.stdout.write(epicReportCommand(filename, claimedName));
    process.exit(0);
  }

  if (command === "plan") {
    planCommand(process.argv.slice(3));
    process.exit(0);
  }

  if (command === "plan-step") {
    planStepCommand(process.argv[3], process.argv[4]);
    process.exit(0);
  }

  if (command === "plan-show") {
    planShowCommand();
    process.exit(0);
  }

  if (command === "handoff-issues") {
    handoffIssuesCommand();
    process.exit(0);
  }

  if (command === "claim") {
    const target = arg;
    if (!target) {
      process.stderr.write('maestro-task-status: "claim" needs a task filename (e.g. claim 002-add-login.md)\n');
      process.exit(1);
    }
    const sessionId = ownSessionId();
    if (!sessionId) {
      process.stderr.write("maestro-task-status: no resolvable session id — cannot claim\n");
      process.exit(1);
    }
    const filename = path.basename(target);
    // `113`: the session's stored name wins over a passed one; `--name` is only the fallback.
    const sessionName = storedName(path.join(projectDir, ".claude"), sessionId) || flagValue("--name");
    const result = claimTask(filename, sessionId, Date.now(), sessionName);
    if (result.outcome === "claimed") {
      // `147`: a claim sets this session's channel scope (`task-<NNN>`) by recording active_task,
      // retiring the scope it leaves. Best-effort: a failure must not lose the claim.
      try {
        recordActiveTask(projectDir, sessionId, filename);
      } catch {
        // The orchestrator's set-session-workflow --task still records it.
      }
      process.stdout.write(
        `Maestro tasks: claimed "${filename}" for session ${sessionId}` +
          (sessionName ? ` (named "${sessionName}")` : " (unnamed)") +
          "\n"
      );
      process.exit(0);
    }
    const holder = result.claim.sessionName
      ? `${result.claim.sessionId}, named "${result.claim.sessionName}"`
      : result.claim.sessionId;
    process.stdout.write(
      `Maestro tasks: "${filename}" is already claimed by an active session (${holder}, since ${result.claim.claimedAt}) — take the next ready task instead\n`
    );
    process.exit(0);
  }

  if (command === "freeform-check") {
    const sessionId = ownSessionId();
    if (!sessionId) {
      process.stderr.write("maestro-task-status: no resolvable session id — cannot check for other sessions\n");
      process.exit(1);
    }
    freeformCheck(sessionId);
    process.exit(0);
  }

  if (command === "worktree") {
    if (!arg) {
      process.stderr.write('maestro-task-status: "worktree" needs a task filename (e.g. worktree 002-add-login.md)\n');
      process.exit(1);
    }
    const sessionId = ownSessionId();
    if (!sessionId) {
      process.stderr.write("maestro-task-status: no resolvable session id — cannot set up a worktree\n");
      process.exit(1);
    }
    setupWorktree(path.basename(arg), sessionId);
    process.exit(0);
  }

  if (command === "merge") {
    if (!arg) {
      process.stderr.write(
        'maestro-task-status: "merge" needs a task filename or number (e.g. merge 002-add-login.md)\n'
      );
      process.exit(1);
    }
    process.exit(mergeWorktreeTask(arg) || 0);
  }

  if (command === "switch-back") {
    process.exit(switchBack());
  }

  if (command === "mark-merged") {
    if (!arg) {
      process.stderr.write(
        'maestro-task-status: "mark-merged" needs a task filename or number (e.g. mark-merged 002-add-login.md)\n'
      );
      process.exit(1);
    }
    const { filename } = resolveTaskName(arg);
    const result = markMerged(projectDir, filename);
    if (!result.done) {
      process.stderr.write(
        `maestro-task-status: "${filename}" is ${result.known ? "not done" : "not in the queue"} — mark-merged only applies to a done task\n`
      );
      process.exit(1);
    }
    process.stdout.write(
      `Maestro tasks: "${filename}" ${result.cleared ? "marked merged" : "was already merged"} — ${summary(result.map)}\n`
    );
    process.exit(0);
  }

  if (command === "release") {
    const target = arg || activeTaskFromSession();
    if (!target) {
      process.stderr.write(
        'maestro-task-status: "release" needs a task filename (e.g. release 002-add-login.md), ' +
          "and no active_task is recorded for this session\n"
      );
      process.exit(1);
    }
    const sessionId = ownSessionId();
    if (!sessionId) {
      process.stderr.write("maestro-task-status: no resolvable session id — cannot release\n");
      process.exit(1);
    }
    const filename = path.basename(target);
    const result = releaseTask(filename, sessionId);
    if (result === "not-owner") {
      process.stderr.write(
        `maestro-task-status: "${filename}" is claimed by a different session — refusing to release it\n`
      );
      process.exit(1);
    }
    process.stdout.write(
      result === "released"
        ? `Maestro tasks: released "${filename}"\n`
        : `Maestro tasks: "${filename}" had no claim — nothing to release\n`
    );
    process.exit(0);
  }

  process.stderr.write(
    "maestro-task-status: unknown command. Usage:\n  maestro-task-status.cjs sync\n  maestro-task-status.cjs done <filename>\n  maestro-task-status.cjs claim <filename>\n  maestro-task-status.cjs release <filename>\n  maestro-task-status.cjs worktree <filename>\n  maestro-task-status.cjs merge <filename|NNN>\n  maestro-task-status.cjs mark-merged <filename|NNN>\n  maestro-task-status.cjs switch-back\n  maestro-task-status.cjs plan <step>...\n  maestro-task-status.cjs plan-step <step> <done|pending>\n  maestro-task-status.cjs plan-show\n  maestro-task-status.cjs handoff-issues\n"
  );
  process.exit(1);
} catch (err) {
  process.stderr.write(`maestro-task-status: ${err.message}\n`);
  process.exit(1);
}
