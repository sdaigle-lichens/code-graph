#!/usr/bin/env node
// Resume-target lookup for a condition-edge loop-back (`039`).
//
//   node maestro-resume-target.cjs "<agent type>"
//
// Prints the `agent_id` the orchestrator should RESUME with `SendMessage` — the id of that agent
// type's most recent completed run THIS session — or prints NOTHING (always exit 0) when there is
// none. Empty output is always safe: it means dispatch a cold `Task` instead.
//
// The index behind this is not new state: maestro-subagent-log.js already appends a
// kind:"handoff" entry to THIS SESSION'S log.jsonl on every SubagentStop that carries a real
// agent_type, keyed by that type and stamped with the agent_id that ran. This CLI is a read over
// that log, in the family of maestro-set-session-workflow.cjs and maestro-task-status.cjs — a
// small tool the orchestrator can reach from its allowed-tools frontmatter rather than being asked
// to grep a jsonl file by hand.
//
// The resolution itself — bared agent-name matching, most-recent-wins, and refusing to answer when
// the active workflow's search list resolves this type to more than one DISTINCT instance (the
// ambiguity that would make a resume attach the wrong instance's history under a shared agent
// name) — lives in agent-runs.ts / success-path.ts, shared with the desktop app via
// lib/maestro-session.cjs. This script is the thinnest possible wrapper: read the three inputs,
// call resumeTarget, print or don't.
//
// Self-contained on purpose: maestro-install.js copies this file into the project's
// .claude/scripts/ so the orchestrator can run it via $CLAUDE_PROJECT_DIR.

const fs = require("fs");
const path = require("path");
const { readJson, readSession, resolveSessionPaths, resumeTarget } = require("./lib/maestro-session.cjs");

function readLogLines(p) {
  if (!p) return []; // `064`: no session directory resolved — treat it as an empty log.
  let text;
  try {
    text = fs.readFileSync(p, "utf8");
  } catch {
    return [];
  }
  const lines = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    try {
      lines.push(JSON.parse(raw));
    } catch {
      // A malformed line is skipped, not fatal — best-effort read of a hook-written log.
    }
  }
  return lines;
}

try {
  const agentType = process.argv[2] || "";
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const claudeDir = path.join(projectDir, ".claude");

  if (agentType) {
    const cfg = readJson(path.join(claudeDir, "maestro.json"));
    // `064`: THIS session's directory and no other. Resolved from CLAUDE_CODE_SESSION_ID — this CLI
    // runs with no stdin — and never widened to a scan of `maestro_sessions/`: a sibling session's
    // log can hold a completed run of the SAME agent type, and returning its `agent_id` would
    // `SendMessage` into a foreign session's agent. Printing nothing (a cold `Task`) is merely
    // slower; a wrong resume is corrupt and silent, which is the whole point of agent-runs.ts.
    const sess = resolveSessionPaths(claudeDir);
    if (cfg && cfg.version === 3 && sess) {
      const session = readSession(sess.state);
      const lines = readLogLines(sess.log);
      const id = resumeTarget(lines, cfg, session, agentType);
      if (id) process.stdout.write(id + "\n");
    }
  }
} catch {
  // Best-effort — empty output (spawn cold) is always the safe fallback.
}

process.exit(0);
