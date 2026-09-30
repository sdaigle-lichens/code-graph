#!/usr/bin/env node
// PreToolUse hook — appends one line per tool call to the CALLING SESSION'S log,
// <cwd>/.claude/maestro_sessions/<session_id>/log.jsonl. Runs on every tool call from any agent.
// No-op when maestro.json is absent (Maestro not configured for this project).
//
// The log is append-only (one JSON object per line) rather than a JSON array in session.json:
// every PreToolUse fires this hook, and parallel subagents would otherwise race on a
// read-modify-write and lose entries.
//
// `064`: the call site below is UNCHANGED — `appendSessionLog(claudeDir, entry, p)` already took
// the payload (for `ctx_pct`), and the same payload carries the `session_id` that decides which
// directory the line lands in. A payload with no resolvable session id makes the append a silent
// no-op, which is exactly this hook's existing best-effort discipline.

const fs = require("fs");
const path = require("path");
const { readStdin, appendSessionLog, projectOwnsHook } = require("./lib/maestro-session.cjs");

// Short, human-readable summary of a tool call for the session log.
function summarize(toolName, ti) {
  ti = ti || {};
  switch (toolName) {
    case "Read":
    case "Glob":
    case "Grep":
      return `${toolName}(${ti.file_path || ti.pattern || ti.query || ""})`;
    case "Edit":
    case "Write":
    case "NotebookEdit":
      return `${toolName}(${ti.file_path || ""})`;
    case "Bash":
      return `Bash(${String(ti.command || "").slice(0, 60)})`;
    case "Task":
      return `Task(${String(ti.description || "").slice(0, 50)})`;
    case "TaskCreate":
      return `TaskCreate(${String(ti.subject || ti.title || "").slice(0, 50)})`;
    case "Skill":
      return `Skill(${ti.skill || ""})`;
    default:
      return toolName || "";
  }
}

(async () => {
  let p = {};
  try {
    p = JSON.parse((await readStdin()) || "{}");
  } catch {
    process.exit(0);
  }

  const cwd = p.cwd || "";
  if (!cwd) process.exit(0);

  // Both delivery paths can register this hook. When the project registers its own copy, THIS
  // copy — the plugin's, running from the marketplace cache — stands down, so nothing fires twice.
  // A no-op in the copy installed into the project. See src/core/hook-arbitration.ts.
  if (projectOwnsHook(__filename, cwd, p.hook_event_name)) process.exit(0);

  const claudeDir = path.join(cwd, ".claude");
  if (!fs.existsSync(path.join(claudeDir, "maestro.json"))) process.exit(0); // only log Maestro-configured projects

  try {
    appendSessionLog(
      claudeDir,
      {
        ts: new Date().toISOString(),
        origin: p.agent_type || "main_session",
        log: summarize(p.tool_name || "", p.tool_input),
      },
      p
    );
  } catch {
    // Best-effort — never fail the tool call on a logging error.
  }
  process.exit(0);
})();
