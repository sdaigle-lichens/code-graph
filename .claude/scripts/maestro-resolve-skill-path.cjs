#!/usr/bin/env node
// Skill-id -> SKILL.md path resolver (`061`).
//
//   node maestro-resolve-skill-path.cjs "<skill id>"
//
// Prints the `SKILL.md` path this project's OWN tree walk (every `.claude/skills` directory in
// the tree, not only the root's) recorded that id under — or prints NOTHING and exits 0 when the
// id isn't a project skill at all (a plugin skill, a typo, one that moved). Empty output is always
// safe: an id this doesn't recognise is an ordinary answer, never a failure, so a caller injecting
// this into an agent's context must never abort on it.
//
// Exists because `skills_available` can hold ids discovered outside the repository ROOT's
// `.claude/skills` (a monorepo skill living beside the code it documents), and the Skill tool only
// indexes that root directory plus installed plugins — it answers "Unknown skill" for the rest.
// This script is the fallback: given the id, print the file to `Read` directly instead.
//
// The walk itself — root-wins on a name collision, same order `discoverProjectSkillsTree` (app)
// and `discoverProjectSkillIds` (`maestro-install.js`) already use — lives in
// apps/maestro/src/core/skill-resolve.ts, bundled into lib/maestro-session.cjs so this script, the
// `SubagentStart` hook (`maestro-inject-agent-context.js`) and the terminal installer all agree on
// the same answer rather than carrying three copies of it.
//
// Self-contained on purpose: maestro-install.js copies this file into the project's
// .claude/scripts/ so the orchestrator (and any subagent it dispatches) can run it via
// $CLAUDE_PROJECT_DIR when the Skill tool rejects a name.

const { resolveProjectSkillPath } = require("./lib/maestro-session.cjs");

try {
  const id = process.argv[2] || "";
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (id) {
    const skillPath = resolveProjectSkillPath(projectDir, id);
    if (skillPath) process.stdout.write(skillPath + "\n");
  }
} catch {
  // Best-effort — empty output (treat the id as not a project skill) is always the safe fallback.
}

process.exit(0);
