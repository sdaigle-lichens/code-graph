#!/usr/bin/env node
// PreToolUse hook (matcher: AskUserQuestion|SendMessage). At a human review step the orchestrator
// must have written that round's review file (`<task>.review.md`, `<task>.review-<n>.md` after a
// loop-back) before it asks for approval; this denies the question until it exists, so the summary
// is structural rather than something the agent can skip. At a manager review step (`132`) the same
// file is the direction brief: the question (escalation, fallback) AND a SendMessage to the active
// task's epic manager (the review request) are denied until it exists. Allows everything outside a
// review stop, and anything it cannot read (no session, no plan, no active task, no epic manager).
// Logic: apps/maestro/src/core/human-review-gate.ts.
//
// `177`: with `manager_approval` on in maestro.json, a CONTAINERIZED worker (MAESTRO_WORKER_RUNTIME
// docker) never asks the user at a human review: the question is denied, and the denial says whether
// a manager approval record (read from the read-only approvals mount) covers this task, stop and
// commit. Host workers are untouched. The same script is also registered on PostToolUse
// (AskUserQuestion): in the epic's MANAGER session it records the user's answer to an escalation
// question (one carrying the `approval-escalation:` marker) as a `source: "user"` approval record, the
// only way such a record can be written.
//
// Registered from the plugin's hooks.json and from a project-local install; the plugin copy stands
// down when the project registers the same hook (hook-arbitration.ts).

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  readStdin,
  readJson,
  resolveSessionPaths,
  checkHumanReview,
  projectOwnsHook,
  storedSessionName,
} = require("./lib/maestro-session.cjs");

// The epic bundle is optional (an older install lacks it): every use below tolerates null.
function epicsLib() {
  try {
    return require("./lib/maestro-epic.cjs");
  } catch {
    return null;
  }
}

// The active task's epic manager name, or null (no task, no epic, no manager, or the epic bundle is
// missing from an older install): a null name leaves SendMessage ungated.
function managerOf(cwd, state) {
  try {
    if (!state || typeof state.active_task !== "string" || !state.active_task) return null;
    const epics = require("./lib/maestro-epic.cjs");
    const slug = epics.epicOfTask(cwd, state.active_task);
    return slug ? (epics.readEpicState(cwd, slug)?.manager?.name ?? null) : null;
  } catch {
    return null;
  }
}

function projectConfig(cwd) {
  return readJson(path.join(cwd, ".claude", "maestro.json"));
}

function headCommit(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

// `177`: the gate's view of manager approval for this worker, or null when it does not apply.
function managerApprovalFor(cwd, state) {
  try {
    const epics = epicsLib();
    if (!epics || !state || typeof state.active_task !== "string" || !state.active_task) return null;
    const task = state.active_task;
    // `181`: the value recorded for THIS worker at launch decides, not the live maestro.json.
    if (!epics.managerApprovalForTask(cwd, task, projectConfig(cwd), epics.isContainerWorker())) return null;
    const epic = epics.epicOfTask(cwd, task);
    if (!epic) return null;
    const verdict = epics.findApproval(
      epics.approvalsDir(os.homedir()),
      { project: epics.projectKeyFor(cwd), epic, task, stop: "human review" },
      headCommit(cwd)
    );
    return { active: true, message: epics.approvalGuidance(verdict, task, "human review") };
  } catch {
    return null;
  }
}

// `177`: PostToolUse on AskUserQuestion in the epic's manager session: record the user's answer.
function recordEscalationAnswer(p) {
  try {
    const epics = epicsLib();
    if (!epics) return;
    const answer = epics.parseEscalationAnswer(p.tool_input, p.tool_response);
    if (!answer) return;
    const epic = epics.epicOfTask(p.cwd, answer.task);
    if (!epic) return;
    // Only the epic's own manager session may record: its stored name must be the recorded manager.
    const own = storedSessionName(path.join(p.cwd, ".claude"), p.session_id || null);
    const manager = epics.readEpicState(p.cwd, epic)?.manager?.name ?? null;
    if (!own || !manager || own.name !== manager) return;
    if (!epics.managerApprovalForTask(p.cwd, answer.task, projectConfig(p.cwd), true)) return;
    epics.recordUserAnswer(epics.approvalsDir(os.homedir()), { project: epics.projectKeyFor(p.cwd), epic, answer });
  } catch {
    // Recording is best effort; an unrecorded answer leaves the stop waiting, never approved.
  }
}

(async () => {
  let p = {};
  try {
    p = JSON.parse((await readStdin()) || "{}");
  } catch {
    process.exit(0);
  }
  try {
    if (!p.cwd || (p.tool_name !== "AskUserQuestion" && p.tool_name !== "SendMessage")) process.exit(0);
    if (projectOwnsHook(__filename, p.cwd, p.hook_event_name)) process.exit(0);
    if (p.hook_event_name === "PostToolUse") {
      if (p.tool_name === "AskUserQuestion") recordEscalationAnswer(p);
      process.exit(0);
    }
    const sess = resolveSessionPaths(path.join(p.cwd, ".claude"), p);
    const state = sess ? readJson(sess.state) : null;
    const verdict = checkHumanReview({
      tasksDir: path.join(p.cwd, ".claude", "maestro-tasks"),
      toolName: p.tool_name,
      toolInput: p.tool_input,
      managerName: p.tool_name === "SendMessage" ? managerOf(p.cwd, state) : null,
      state,
      exists: (file) => fs.existsSync(file),
      managerApproval: p.tool_name === "AskUserQuestion" ? managerApprovalFor(p.cwd, state) : null,
    });
    if (!verdict.allow) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: verdict.reason,
          },
        })
      );
    }
  } catch {
    // Fails open: the gate only ever narrows.
  }
  process.exit(0);
})();
