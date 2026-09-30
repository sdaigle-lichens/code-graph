#!/usr/bin/env node
// Hook for the `maestro-post-mortem` skill: inject its active task's post-mortem history as
// context, so the skill's own prose doesn't have to spend three manual steps re-deriving it every
// single run.
//
// TWO EVENTS, same as maestro-step0.js, because there are two ways into this skill: the user
// TYPING `/maestro-post-mortem` (UserPromptExpansion, matched on the command name) and the model
// invoking it through the Skill tool (PreToolUse, matcher Skill, filtered to this one skill by
// name). UserPromptExpansion's plain stdout IS read as context; PreToolUse's is not, so that path
// emits `hookSpecificOutput.additionalContext` instead — see maestro-step0.js's own header for why
// getting this backwards silently injects nothing.
//
// What it gathers, both read-only:
//   - This session's `active_task` (from <project>/.claude/maestro_sessions/<id>/session.json) and,
//     if that task file carries a `## Post-Mortem` section, its content — the orchestrator's Step 4
//     writes this when a task didn't go cleanly, and /maestro-post-mortem itself annotates it with
//     what fix was applied to each bullet.
//   - `<project>/.claude/postmortems.log`, if present — the committed history of DELETED tickets'
//     `## Post-Mortem` sections (see apps/maestro/src/core/tasks.ts's `deleteTask`). Capped to its
//     last LOG_TAIL_CHARS so a project with a long history doesn't inject an ever-growing blob.
//
// No active_task and no postmortems.log ⇒ nothing to inject ⇒ silent, same as maestro-step0.js's
// "continue" answer. Never blocks the skill call: any failure degrades to saying nothing.

const fs = require("fs");
const path = require("path");
const { readStdin, projectOwnsHook, ensureSessionPaths, readSession } = require("./lib/maestro-session.cjs");

const SKILL = "maestro-post-mortem";
const LOG_TAIL_CHARS = 4000;

/** Same tolerant match as maestro-step0.js's isOrchestrator: a leading `/`, a `plugin:` namespace. */
function matchesSkill(name, want) {
  if (typeof name !== "string") return false;
  const bare = name.replace(/^\//, "");
  const last = bare.includes(":") ? bare.slice(bare.lastIndexOf(":") + 1) : bare;
  return last === want;
}

function invokesPostMortem(p) {
  if (p.hook_event_name === "UserPromptExpansion") return matchesSkill(p.command_name, SKILL);
  if (p.hook_event_name === "PreToolUse") {
    if ((p.tool_name || "") !== "Skill") return false;
    const input = p.tool_input || {};
    return matchesSkill(input.skill || input.name || input.skill_name, SKILL);
  }
  return false;
}

/** Emit `text` as context for this event, which is not the same call on both — see header. */
function inject(event, text) {
  if (event === "PreToolUse") {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: text } }));
    return;
  }
  process.stdout.write(text + "\n");
}

/** Same section-slicing convention as apps/maestro/src/core/tasks.ts's extractPostMortemSection. */
function extractPostMortemSection(content) {
  const start = content.search(/^##\s+Post-Mortem\s*$/m);
  if (start === -1) return null;
  const rest = content.slice(start);
  const nextHeading = rest.slice(1).search(/^##\s/m);
  const body = nextHeading === -1 ? rest : rest.slice(0, nextHeading + 1);
  return body.trim();
}

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, "utf8");
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

  if (!invokesPostMortem(p)) process.exit(0);

  const projectDir = process.env.CLAUDE_PROJECT_DIR || p.cwd || "";
  if (!projectDir) process.exit(0);

  // Both delivery paths can register this hook — stand down when the project owns its own copy.
  // See apps/maestro/src/core/hook-arbitration.ts.
  if (projectOwnsHook(__filename, projectDir, p.hook_event_name)) process.exit(0);

  const claudeDir = path.join(projectDir, ".claude");
  const lines = [];

  try {
    const sess = ensureSessionPaths(claudeDir, p);
    const session = sess ? readSession(sess.state) : null;
    const activeTask = session && typeof session.active_task === "string" ? session.active_task : null;
    if (activeTask) {
      const taskContent = readFileSafe(path.join(claudeDir, "maestro-tasks", path.basename(activeTask)));
      const section = taskContent ? extractPostMortemSection(taskContent) : null;
      if (section) {
        lines.push(
          `The active task (${activeTask}) already carries this Post-Mortem section — treat it as this run's known-problems list, not something to rediscover from scratch:\n\n${section}`
        );
      }
    }
  } catch {
    // Degrade to saying nothing about the active task, same stance as every other hook here.
  }

  try {
    const log = readFileSafe(path.join(claudeDir, "postmortems.log"));
    if (log && log.trim()) {
      const tail = log.length > LOG_TAIL_CHARS ? `…(truncated)…\n${log.slice(-LOG_TAIL_CHARS)}` : log;
      lines.push(
        `.claude/postmortems.log (history of deleted tickets' Post-Mortem sections) — check before flagging a problem as new:\n\n${tail.trim()}`
      );
    }
  } catch {
    // Same degrade.
  }

  if (lines.length > 0) inject(p.hook_event_name, lines.join("\n\n---\n\n"));
  process.exit(0);
})().catch(() => process.exit(0));
