#!/usr/bin/env node
// Prints this project's Step 4 task-routing configuration as ONE directive line, for injection
// into the orchestrator skill body through Claude Code's !`command` dynamic-context syntax:
//
//   !`node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/maestro-step4-gate.cjs"`
//
// Reads `use_maestro_tasks` from <projectDir>/.claude/maestro.json. When true, tells the
// orchestrator to consider running /to-maestro-tasks at this point to queue up follow-up work;
// otherwise says plainly there is nothing to do here.
//
// THE CONTRACT, and every clause of it is load-bearing (same shape as maestro-step1-gates.cjs):
//
//   * Takes NO arguments.
//   * Exits 0 unconditionally, and writes NOTHING to stderr. There is no failure branch. An
//     injected command that exits non-zero ABORTS the whole skill invocation, so every degenerate
//     case (no maestro.json, a corrupt one, version !== 3, no `use_maestro_tasks`, a non-boolean
//     value, any unexpected throw) resolves quietly to LINES.off rather than to an error. That is
//     the same "absent means off" stance `resolveUseMaestroTasks` takes in
//     apps/maestro/src/core/config.ts, which this file mirrors — it cannot import from src/core,
//     so a change to that rule needs the same change here.
//   * Writes exactly one newline-terminated line on stdout, one of the two in LINES below.
//
// Self-contained on purpose: the installers copy it into the project's .claude/scripts/ so the
// orchestrator skill can name it by $CLAUDE_PROJECT_DIR path.

const fs = require("fs");
const path = require("path");
const { appendSessionLog } = require("./lib/maestro-session.cjs");

// Best-effort `kind:"phase"` marker, same shape and same no-ctx_pct caveat as
// maestro-step1-gates.cjs's own logPhase — see its comment, including `064`'s env-resolved session
// and the silent skip when no id resolves.
function logPhase(projectDir) {
  try {
    const claudeDir = path.join(projectDir, ".claude");
    if (!fs.existsSync(path.join(claudeDir, "maestro.json"))) return;
    appendSessionLog(claudeDir, {
      ts: new Date().toISOString(),
      origin: "main_session",
      kind: "phase",
      phase: "step4_task_routing",
      log: "phase: step4_task_routing",
    });
  } catch {
    // Best-effort — never fail Step 4 on a logging error.
  }
}

const LINES = {
  on: "Step 4 — this project routes follow-up work through the task queue. Consider running /to-maestro-tasks now to queue up any follow-up work this session surfaced.",
  // Printed rather than staying silent on purpose: an explicit line says the script RAN and the
  // answer is deliberate. Silence is indistinguishable from a broken or missing script.
  off: "Step 4 — task routing is not enabled for this project. Nothing to do here.",
};

function gateLine(projectDir) {
  let config = null;
  try {
    config = JSON.parse(fs.readFileSync(path.join(projectDir, ".claude", "maestro.json"), "utf8"));
  } catch {
    return LINES.off; // absent, unreadable, or not JSON
  }
  if (!config || typeof config !== "object" || config.version !== 3) return LINES.off;

  // Strict `=== true`: a string, a number, null or a missing field is off, never truthy.
  return config.use_maestro_tasks === true ? LINES.on : LINES.off;
}

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
let line = LINES.off;
try {
  line = gateLine(projectDir);
} catch {
  // Belt and braces: gateLine already swallows the expected failures, and anything it doesn't
  // must still not take the orchestrator down with it.
  line = LINES.off;
}
logPhase(projectDir);
process.stdout.write(line + "\n");
process.exit(0);
