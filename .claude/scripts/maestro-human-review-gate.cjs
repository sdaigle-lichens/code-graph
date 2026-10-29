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
// Registered from the plugin's hooks.json and from a project-local install; the plugin copy stands
// down when the project registers the same hook (hook-arbitration.ts).

const fs = require("fs");
const path = require("path");
const {
  readStdin,
  readJson,
  resolveSessionPaths,
  checkHumanReview,
  projectOwnsHook,
} = require("./lib/maestro-session.cjs");

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
    const sess = resolveSessionPaths(path.join(p.cwd, ".claude"), p);
    const state = sess ? readJson(sess.state) : null;
    const verdict = checkHumanReview({
      tasksDir: path.join(p.cwd, ".claude", "maestro-tasks"),
      toolName: p.tool_name,
      toolInput: p.tool_input,
      managerName: p.tool_name === "SendMessage" ? managerOf(p.cwd, state) : null,
      state,
      exists: (file) => fs.existsSync(file),
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
