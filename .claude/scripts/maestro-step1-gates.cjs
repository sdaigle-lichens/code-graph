#!/usr/bin/env node
// Prints this project's START skills as ONE directive line, for injection into a skill body
// through Claude Code's !`command` dynamic-context syntax:
//
//   !`node .claude/scripts/maestro-step1-gates.cjs`
//   !`node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-step1-gates.cjs" --for to_maestro_tasks`
//
// Reads `start_skills` from <projectDir>/.claude/maestro.json (an absent one is an empty
// list — all of that lives in `resolveSkillLists`, the SAME function the
// desktop app uses, bundled into lib/maestro-skill-lists.cjs) and prints THE WHOLE OF Step 1 for
// this project: it names the configured skills in order and says nothing about any one of them.
// Each skill states its own stop rule in its own output; the line only says to honour it.
//
// `--for to_maestro_tasks` selects the `/to-maestro-tasks` list instead of the orchestrator's. That
// skill runs the plugin's own copy of this file through ${CLAUDE_PLUGIN_ROOT}, so a project without
// the runtime installed does not abort it. Any other argument (or none) means the orchestrator.
//
// THE CONTRACT, and every clause of it is load-bearing:
//
//   * Exits 0 unconditionally, and writes NOTHING to stderr. There is no failure branch. An
//     injected command that exits non-zero ABORTS the whole skill invocation, and Claude then
//     never sees the skill body at all — so every degenerate case (no maestro.json, a corrupt one,
//     version !== 3, wrong types, any unexpected throw) resolves quietly to a line, never an error.
//   * Writes exactly one newline-terminated line on stdout. One line even though it is several
//     sentences: it keeps the contract trivially assertable.
//
// Self-contained on purpose: the installers copy it (and its lib) into the project's
// .claude/scripts/ so the orchestrator skill can name it by $CLAUDE_PROJECT_DIR path.

const fs = require("fs");
const path = require("path");

// Best-effort `kind:"phase"` marker so /session-log and /maestro-post-mortem can see where Step 1
// falls in the log — no `ctx_pct` here, since this script runs via `!`command`` substitution with
// no stdin payload and so no transcript_path to derive one from (see session-usage.ts). Never
// throws and never touches stdout/stderr: the one-line stdout contract below is load-bearing.
//
// `064`: WHICH session's log it lands in is resolved by `appendSessionLog` itself, from the
// CLAUDE_CODE_SESSION_ID environment variable. With no id resolvable the append is a silent no-op.
function logPhase(projectDir) {
  try {
    const { appendSessionLog } = require("./lib/maestro-session.cjs");
    const claudeDir = path.join(projectDir, ".claude");
    if (!fs.existsSync(path.join(claudeDir, "maestro.json"))) return;
    appendSessionLog(claudeDir, {
      ts: new Date().toISOString(),
      origin: "main_session",
      kind: "phase",
      phase: "step1_gates",
      log: "phase: step1_gates",
    });
  } catch {
    // Best-effort — never fail Step 1 on a logging error.
  }
}

const NAMES = (list) => list.map((id) => "/" + id).join(", then ");

const HONOUR = "If a start skill says to stop or asks the user something, do that before continuing.";

const LINES = {
  maestro: (list) =>
    "Step 1 — run these start skills now, in this order, and no others: " +
    NAMES(list) +
    ". Use the Skill tool for each, in your own context — never dispatch a subagent for them. " +
    HONOUR.replace("continuing", "Step 2") +
    " Then continue to Step 2.",
  to_maestro_tasks: (list) =>
    "Run these start skills now, in this order, and no others: " +
    NAMES(list) +
    ". Use the Skill tool for each, in your own context. " +
    HONOUR.replace("continuing", "the next step") +
    " Then continue with the next step.",
  // Printed rather than staying silent on purpose: an explicit line says the script RAN and the
  // answer is deliberate. Silence is indistinguishable from a broken or missing script.
  maestroNone:
    "Step 1 — no start skills are configured for this project. Do nothing here; continue straight to Step 2.",
  to_maestro_tasksNone:
    "No start skills are configured for this project. Do nothing here; continue with the next step.",
};

function startLine(projectDir, target) {
  let config = null;
  try {
    config = JSON.parse(fs.readFileSync(path.join(projectDir, ".claude", "maestro.json"), "utf8"));
  } catch {
    config = null; // absent, unreadable, or not JSON: the resolver's degenerate answer
  }
  const { resolveSkillLists } = require("./lib/maestro-skill-lists.cjs");
  const lists = resolveSkillLists(config);
  const list = target === "to_maestro_tasks" ? lists.toMaestroTasksStart : lists.maestroStart;
  if (list.length === 0) return LINES[target + "None"];
  return LINES[target](list);
}

const argv = process.argv.slice(2);
const forIdx = argv.indexOf("--for");
const target = forIdx !== -1 && argv[forIdx + 1] === "to_maestro_tasks" ? "to_maestro_tasks" : "maestro";
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
let line = LINES[target + "None"];
try {
  line = startLine(projectDir, target);
} catch {
  // Belt and braces: anything that escapes must still not take the skill down with it.
  line = LINES[target + "None"];
}
if (target === "maestro") logPhase(projectDir);
process.stdout.write(line + "\n");
process.exit(0);
