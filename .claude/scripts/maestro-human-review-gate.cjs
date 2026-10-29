#!/usr/bin/env node
// PreToolUse hook (matcher: AskUserQuestion). At a human review step the orchestrator must have
// written that round's review file (`<task>.review.md`, `<task>.review-<n>.md` after a loop-back)
// before it asks for approval; this denies the question until it exists, so the summary is
// structural rather than something the agent can skip. Allows every AskUserQuestion outside a human
// review, and anything it cannot read (no session, no plan, no active task). Logic:
// apps/maestro/src/core/human-review-gate.ts.
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

(async () => {
  let p = {};
  try {
    p = JSON.parse((await readStdin()) || "{}");
  } catch {
    process.exit(0);
  }
  try {
    if (!p.cwd || p.tool_name !== "AskUserQuestion") process.exit(0);
    if (projectOwnsHook(__filename, p.cwd, p.hook_event_name)) process.exit(0);
    const sess = resolveSessionPaths(path.join(p.cwd, ".claude"), p);
    const state = sess ? readJson(sess.state) : null;
    const verdict = checkHumanReview({
      tasksDir: path.join(p.cwd, ".claude", "maestro-tasks"),
      toolName: p.tool_name,
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
