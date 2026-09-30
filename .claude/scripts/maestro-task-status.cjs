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
//   node maestro-task-status.cjs release [filename]
//       Release THIS session's own claim on a task. Never removes a claim held
//       by a DIFFERENT session, live or dead — that check is the whole point.
//       With no filename, falls back to `active_task` the same way `done` does.
//
// All cascade/status logic lives in lib/maestro-tasks.cjs so the app and the
// orchestrator share one implementation. Claims are derived state, never
// written into status.json — see claimsDir()/claimTask()/releaseTask() below,
// kept in sync with apps/maestro/src/core/claims.ts. Self-contained:
// maestro-install.js copies this file and the lib into the project's
// .claude/scripts/.

const fs = require("fs");
const path = require("path");
const { sync, markDone, tasksDir } = require("./lib/maestro-tasks.cjs");
const { resolveSessionPaths, sessionPathsFor, CLAIM_IDLE_CAP_MS } = require("./lib/maestro-session.cjs");

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const [command, arg] = process.argv.slice(2);

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
    return session && typeof session.active_task === "string" ? session.active_task : null;
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

// Live iff the claiming session's directory still exists AND its log.jsonl was modified within
// CLAIM_IDLE_CAP_MS. A missing directory (clean SessionEnd) is dead immediately.
function isSessionLive(sessionId, now) {
  const paths = sessionPathsFor(path.join(projectDir, ".claude"), sessionId);
  if (!paths || !fs.existsSync(paths.dir)) return false;
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
function claimTask(filename, sessionId, now) {
  const base = path.basename(filename);
  ensureClaimsDir();
  const filePath = claimPathFor(base);

  const existing = readClaimFile(filePath);
  if (existing) {
    if (isSessionLive(existing.session_id, now)) {
      return { outcome: "already-claimed", claim: { sessionId: existing.session_id, claimedAt: existing.claimed_at } };
    }
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Fall through — the "wx" create below surfaces EEXIST if this truly failed.
    }
  }

  const payload = { session_id: sessionId, claimed_at: new Date(now).toISOString(), project_root: projectDir };
  try {
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
    return { outcome: "claimed" };
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    const winner = readClaimFile(filePath);
    if (!winner) return { outcome: "claimed" }; // winner released/reaped between our EEXIST and this read
    return { outcome: "already-claimed", claim: { sessionId: winner.session_id, claimedAt: winner.claimed_at } };
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
    const { map, marked } = markDone(projectDir, filename);
    if (!marked) {
      process.stderr.write(
        `maestro-task-status: no task file "${filename}" under .claude/maestro-tasks/ — nothing marked done\n`
      );
      process.exit(1);
    }
    deleteClaimIfAny(filename); // `066`: a done task has nothing left for a claim to protect
    process.stdout.write(`Maestro tasks: marked "${filename}" done — ${summary(map)}\n`);
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
    const result = claimTask(filename, sessionId, Date.now());
    if (result.outcome === "claimed") {
      process.stdout.write(`Maestro tasks: claimed "${filename}" for session ${sessionId}\n`);
      process.exit(0);
    }
    process.stdout.write(
      `Maestro tasks: "${filename}" is already claimed by an active session (${result.claim.sessionId}, since ${result.claim.claimedAt}) — take the next ready task instead\n`
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
    "maestro-task-status: unknown command. Usage:\n  maestro-task-status.cjs sync\n  maestro-task-status.cjs done <filename>\n  maestro-task-status.cjs claim <filename>\n  maestro-task-status.cjs release <filename>\n"
  );
  process.exit(1);
} catch (err) {
  process.stderr.write(`maestro-task-status: ${err.message}\n`);
  process.exit(1);
}
