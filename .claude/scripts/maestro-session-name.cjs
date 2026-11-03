#!/usr/bin/env node
// Names Maestro sessions deterministically (`113`) so cross-session messages survive a restart.
//
// Manager and worker sessions address each other by session NAME, and the epic and task claims
// record those names. An auto-generated name changes on restart; this hook gives every Maestro
// session `maestro-<id8>` (worker) or `maestro-mgr-<id8>` (manager), derived from the session id
// that `claude --resume` keeps, and applies it with the hook output field `sessionTitle` (the same
// effect as /rename). The logic is lib/maestro-session.cjs's session-name module
// (apps/maestro/src/core/session-name.ts); this script only routes the five registrations to it:
//
//   UserPromptExpansion (the `maestro` / `maestro-manager` commands)  the user typed the skill
//   PreToolUse (matcher Skill, filtered to those two skills)            the model invoked it
//       Both only RECORD the name (first entrance wins): neither event accepts `sessionTitle`.
//   UserPromptSubmit   applies the recorded name once. Also records the entrance itself when the
//                      prompt starts with `/maestro` or `/maestro-manager`, because this event fires
//                      before that prompt's UserPromptExpansion.
//   SessionStart       re-applies the recorded name on every start/resume, re-deriving it from the
//                      claim or epic that recorded it when the session directory was swept.
//
// A custom title the user set (`--name`, `/rename`) is respected and recorded instead. No session
// id, no `.claude/maestro.json`, or any failure at all: no output, exit 0.

const path = require("path");
const {
  readStdin,
  projectOwnsHook,
  resolveSessionId,
  entranceRoleFor,
  promptEntranceRole,
  noteEntrance,
  titleFor,
} = require("./lib/maestro-session.cjs");

/** The entrance this payload is, or null: `worker` for /maestro, `manager` for /maestro-manager. */
function entranceOf(p) {
  if (p.hook_event_name === "UserPromptExpansion") return entranceRoleFor(p.command_name);
  if (p.hook_event_name === "PreToolUse") {
    if ((p.tool_name || "") !== "Skill") return null;
    const input = p.tool_input || {};
    return entranceRoleFor(input.skill || input.name || input.skill_name);
  }
  if (p.hook_event_name === "UserPromptSubmit") return promptEntranceRole(p.prompt);
  return null;
}

(async () => {
  let p = {};
  try {
    p = JSON.parse((await readStdin()) || "{}");
  } catch {
    process.exit(0);
  }
  if (!p || typeof p !== "object") process.exit(0);

  const event = p.hook_event_name;
  if (!["UserPromptExpansion", "PreToolUse", "UserPromptSubmit", "SessionStart"].includes(event)) process.exit(0);

  // PreToolUse fires on every Skill call: bail before touching the disk for any other skill.
  const role = entranceOf(p);
  if ((event === "UserPromptExpansion" || event === "PreToolUse") && !role) process.exit(0);

  const cwd = p.cwd || process.env.CLAUDE_PROJECT_DIR || "";
  if (!cwd) process.exit(0);

  // The plugin's copy stands down when the project registers its own copy of this hook.
  if (projectOwnsHook(__filename, cwd, event)) process.exit(0);

  const sessionId = resolveSessionId(p);
  if (!sessionId) process.exit(0);
  const claudeDir = path.join(cwd, ".claude");

  let title = null;
  try {
    if (role) noteEntrance(claudeDir, sessionId, role);
    if (event === "UserPromptSubmit" || event === "SessionStart") title = titleFor(claudeDir, p);
  } catch {
    process.exit(0);
  }

  if (title) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, sessionTitle: title } }));
  }
  process.exit(0);
})().catch(() => process.exit(0));
