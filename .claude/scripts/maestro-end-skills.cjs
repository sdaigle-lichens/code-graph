#!/usr/bin/env node
// Prints this project's END skills as ONE directive line, for injection into the orchestrator
// skill body through Claude Code's !`command` dynamic-context syntax:
//
//   !`node .claude/scripts/maestro-end-skills.cjs`
//
// Reads `end_skills.maestro` from <projectDir>/.claude/maestro.json through `resolveSkillLists`
// (the same function the desktop app uses, bundled into lib/maestro-skill-lists.cjs). The line
// names the configured skills in order and nothing else about them.
//
// THE CONTRACT is the one maestro-step1-gates.cjs documents, clause for clause:
//
//   * Exits 0 unconditionally, and writes NOTHING to stderr. An injected command that exits
//     non-zero aborts the whole skill invocation, so every degenerate case (no maestro.json, a
//     corrupt one, version !== 3, wrong types, any unexpected throw) resolves quietly to the
//     neutral "nothing to do" line.
//   * Writes exactly one newline-terminated line on stdout.
//
// Self-contained on purpose: the installers copy it (and its lib) into the project's
// .claude/scripts/ so the orchestrator skill can name it by $CLAUDE_PROJECT_DIR path.

const fs = require("fs");
const path = require("path");

const NONE = "End skills — none configured. Nothing to do.";

function endLine(projectDir) {
  let config = null;
  try {
    config = JSON.parse(fs.readFileSync(path.join(projectDir, ".claude", "maestro.json"), "utf8"));
  } catch {
    config = null; // absent, unreadable, or not JSON: the resolver's degenerate answer
  }
  const { resolveSkillLists } = require("./lib/maestro-skill-lists.cjs");
  const list = resolveSkillLists(config).maestroEnd;
  if (list.length === 0) return NONE;
  return (
    "End skills — run these now, in order, with the Skill tool: " + list.map((id) => "/" + id).join(", then ") + "."
  );
}

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
let line = NONE;
try {
  line = endLine(projectDir);
} catch {
  line = NONE;
}
process.stdout.write(line + "\n");
process.exit(0);
