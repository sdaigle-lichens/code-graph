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
//   node maestro-task-status.cjs merge <filename|NNN|freeform-<id>>
//       FINISH a worktree task (`076`) — ONLY ever run because the user explicitly asked for it. Merges
//       branch task-NNN into the main checkout's current branch (`git merge --no-ff`), then removes the
//       worktree and deletes the branch. Refuses, changing nothing, when the task is not `done`, the
//       worktree has uncommitted changes, the branch has no worktree, the main checkout is mid-merge or
//       on a detached HEAD, or the merge would overwrite local changes. On a CONFLICT it aborts the
//       merge (main goes back to how it was), keeps the worktree and branch, and lists the conflicting
//       files — and, when ALL of them are generated plugin libs or their .claude/scripts/lib mirrors
//       (`082`), names the mechanical resolution: rebuild the libs, copy each over its mirror.
//       Never pushes. No pull-request mode: the branch is an ordinary local branch the user
//       can `git push` themselves (see .claude/skills/task-queue, "Finishing a worktree task").
//
// All cascade/status logic lives in lib/maestro-tasks.cjs so the app and the
// orchestrator share one implementation. Claims are derived state, never
// written into status.json — see claimsDir()/claimTask()/releaseTask() below,
// kept in sync with apps/maestro/src/core/claims.ts. Self-contained:
// maestro-install.js copies this file and the lib into the project's
// .claude/scripts/.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { sync, markDone, tasksDir, mainCheckoutRoot } = require("./lib/maestro-tasks.cjs");
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
  isChannelScope,
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

  try {
    git(projectDir, ["worktree", "add", "-b", branch, wtPath]);
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
      `  worktree: ${wtPath}\n  branch:   ${branch}\n` +
      "Do ALL of this session's work there: tell every subagent to use that directory as its working directory and absolute paths under it, " +
      `and never edit the main checkout (${projectDir}). The task queue and this task's .claude/channels/<scope>/ lanes stay in the main checkout (${projectDir}/.claude/...). ` +
      "If edits there are denied, ask the user to allow the worktree directory (/add-dir).\n"
  );
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
function collidingUntracked(branch) {
  const tree = gitTry(projectDir, ["ls-tree", "-r", "-z", "--name-only", branch]);
  const untracked = gitTry(projectDir, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (!tree.ok || !untracked.ok) return [];
  const onBranch = new Set(tree.out.split("\0").filter(Boolean));
  const hits = [];
  for (const rel of untracked.out.split("\0").filter(Boolean)) {
    if (!onBranch.has(rel)) continue;
    let identical = false;
    try {
      const local = path.join(projectDir, rel);
      if (fs.lstatSync(local).isFile()) {
        const theirs = execFileSync("git", ["show", `${branch}:${rel}`], {
          cwd: projectDir,
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
  return (
    "Every conflicting file is a generated plugin lib or its tracked mirror, so do NOT edit the bundle text. Resolve like this in the worktree:\n" +
    "  1. resolve any conflict in apps/maestro/src/core/** first (none listed here means the sources merged cleanly);\n" +
    "  2. run `pnpm refresh:runtime` (rebuilds the libs and copies each over its .claude/scripts/lib/ mirror; a sandboxed agent hands the user `! pnpm refresh:runtime`);\n" +
    "  3. `git add` those files, run `pnpm --filter maestro exec vitest run test/core/parity.test.ts`, commit, then ask for the merge again.\n"
  );
}

function mergeWorktreeTask(arg) {
  // `103`: a freeform run's worktree has no task file or queue entry; it is named by its branch
  // (freeform-<short id>) and merged by exactly the same steps below, minus the "task is done" check.
  const freeform = isFreeformBranch(path.basename(arg));
  const { filename, status } = freeform ? { filename: path.basename(arg), status: "done" } : resolveTaskName(arg);
  const branch = freeform ? filename : worktreeBranchFor(filename);
  if (!branch) refuse(`"${filename}" has no task number, so it has no task branch`);
  if (status !== "done") {
    refuse(
      `"${filename}" is ${status ? `"${status}"` : "not in the queue"}, not "done" — finish the task (and mark it done) first`
    );
  }
  if (!branchExists(branch)) refuse(`branch ${branch} does not exist`);
  const wtPath = worktreeForBranch(branch);
  if (!wtPath) refuse(`branch ${branch} has no worktree checked out`);
  if (path.resolve(wtPath) === path.resolve(projectDir))
    refuse(`branch ${branch} is checked out in the main checkout itself`);

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

  const base = gitTry(projectDir, ["symbolic-ref", "--short", "-q", "HEAD"]);
  if (!base.ok || !base.out)
    refuse(`the main checkout (${projectDir}) is on a detached HEAD — check out the base branch first`);
  if (gitTry(projectDir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).ok) {
    refuse(`the main checkout (${projectDir}) is in the middle of a merge — finish or abort it first`);
  }

  const colliding = collidingUntracked(branch);
  if (colliding.length) {
    refuse(
      `${colliding.length} untracked file(s) in the main checkout (${projectDir}) would be overwritten by the merge`,
      colliding
        .map((c) =>
          c.identical
            ? `  ${c.rel} — identical to ${branch}'s copy (safe to delete)`
            : `  ${c.rel} — DIFFERENT from ${branch}'s copy (needs a look before deleting)`
        )
        .join("\n") + "\nDelete or move each one (the user decides), then ask for the merge again."
    );
  }

  const merged = gitTry(projectDir, [
    "merge",
    "--no-ff",
    "-m",
    freeform ? `Merge ${branch} (freeform run)` : `Merge ${branch} (${filename})`,
    branch,
  ]);
  if (!merged.ok) {
    if (SANDBOX_DENIAL.test(`${merged.err}\n${merged.out}`)) {
      if (gitTry(projectDir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).ok)
        gitTry(projectDir, ["merge", "--abort"]);
      process.stdout.write(
        `Maestro tasks: merge SANDBOX-BLOCKED — git could not write into the main checkout (${merged.err.split("\n")[0] || "write denied"}). ` +
          `Do NOT retry it from this session. Check \`git -C ${shellQuote(projectDir)} status\` for a half-applied merge, then ask the user to run:\n` +
          `  ! CLAUDE_PROJECT_DIR=${shellQuote(projectDir)} node ${shellQuote(__filename)} merge ${shellQuote(filename)}\n`
      );
      process.exit(1);
    }
    const conflicts = gitTry(projectDir, ["diff", "--name-only", "--diff-filter=U"]).out.split("\n").filter(Boolean);
    const mergeStarted = gitTry(projectDir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).ok;
    if (mergeStarted) gitTry(projectDir, ["merge", "--abort"]);
    if (conflicts.length) {
      process.stdout.write(
        `Maestro tasks: merge CONFLICT merging ${branch} into ${base.out}. The merge was aborted; ${base.out} is unchanged, and the worktree (${wtPath}) and branch ${branch} are intact.\n` +
          `Conflicting files:\n${conflicts.map((f) => `  ${f}`).join("\n")}\n` +
          `To resolve: in ${wtPath} run \`git merge ${base.out}\`, fix those files, commit, then ask for the merge again. Do NOT resolve them for the user without asking.\n` +
          (generatedLibResolution(conflicts) || "")
      );
    } else {
      process.stdout.write(
        `Maestro tasks: merge of ${branch} into ${base.out} did not complete (${merged.err.split("\n")[0] || "git refused"}); nothing changed, worktree and branch intact.\n`
      );
    }
    process.exit(1);
  }

  // Merged. Clean up: the worktree (no --force: git itself refuses if something is left), the
  // branch (-d: only deletes a fully merged branch), and any session pointer aimed at the worktree.
  const notes = [];
  const rm = gitTry(projectDir, ["worktree", "remove", wtPath]);
  if (!rm.ok)
    notes.push(`could not remove worktree ${wtPath} (${rm.err.split("\n")[0]}) — remove it yourself when sure`);
  else {
    const del = gitTry(projectDir, ["branch", "-d", branch]);
    if (!del.ok) notes.push(`could not delete branch ${branch} (${del.err.split("\n")[0]})`);
  }
  if (rm.ok) dropPointersTo(wtPath);
  process.stdout.write(
    `Maestro tasks: merged ${branch} into ${base.out}` +
      (rm.ok ? `; removed worktree ${wtPath} and branch ${branch}.` : ".") +
      (notes.length ? `\n  note: ${notes.join("\n  note: ")}` : "") +
      "\n  Nothing was pushed.\n"
  );
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
// step with that label AND every step after it, because everything downstream has to run again.
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
    for (let i = index; i < plan.steps.length; i++) plan.steps[i].status = "pending";
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

// Read-and-clear the handoff problems the SubagentStop hook recorded since the orchestrator last asked.
function handoffIssuesCommand() {
  const file = sessionStateFile();
  const state = file ? readSessionState(file) : {};
  // A `missing_payload` whose files are all in their lane now, stamped with THIS run's id, is
  // resolved (a resumed agent's earlier file still exists): reporting it sends the orchestrator after
  // a file that is already there. Same check `maestro-resume-target.cjs` makes (`139`).
  const recorded = Array.isArray(state.handoff_issues) ? state.handoff_issues : [];
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
      issues = dropResolvedMissingPayloads(recorded, present);
    } catch {
      issues = recorded;
    }
  }
  if (!issues.length) {
    if (recorded.length) {
      delete state.handoff_issues;
      writeSessionState(file, state);
    }
    process.stdout.write("Maestro handoffs: no problems recorded.\n");
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
  process.stdout.write(
    `Maestro handoffs: ${issues.length} problem(s) — route deliberately, never default to success:\n${lines.join("\n")}\n${worktreeNote}`
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
    const { map, marked } = markDone(projectDir, filename);
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
    mergeWorktreeTask(arg);
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
    "maestro-task-status: unknown command. Usage:\n  maestro-task-status.cjs sync\n  maestro-task-status.cjs done <filename>\n  maestro-task-status.cjs claim <filename>\n  maestro-task-status.cjs release <filename>\n  maestro-task-status.cjs worktree <filename>\n  maestro-task-status.cjs merge <filename|NNN>\n  maestro-task-status.cjs plan <step>...\n  maestro-task-status.cjs plan-step <step> <done|pending>\n  maestro-task-status.cjs plan-show\n  maestro-task-status.cjs handoff-issues\n"
  );
  process.exit(1);
} catch (err) {
  process.stderr.write(`maestro-task-status: ${err.message}\n`);
  process.exit(1);
}
