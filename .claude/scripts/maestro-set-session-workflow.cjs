#!/usr/bin/env node
// Sets the active workflow name in THIS session's state file,
// <cwd>/.claude/maestro_sessions/<session_id>/session.json (`064`).
// Called by the Maestro orchestrator at the start of each workflow execution:
//   node maestro-set-session-workflow.cjs "<workflow name>" [--task <NNN-file.md>]
//
// If no name is given, auto-resolves to the first configured workflow, else "default".
// When `--task <filename>` is passed (the run was invoked to complete a specific
// task-queue file), the bare filename is recorded as `active_task` so the
// orchestrator can mark exactly that task done at the end of the success path
// without re-deriving the filename from the original prompt — the fragile step
// that otherwise gets dropped once the real work is finished.
//
// Creates the session file if absent; preserves every other existing key
// (generated_instances, etc.).
//
// `064`: which session this writes for is resolved from the CLAUDE_CODE_SESSION_ID environment
// variable — this CLI runs with no stdin — so a second concurrent session in the same project can
// no longer overwrite the first's active workflow, which used to make the first session's next
// SubagentStart inject the SECOND workflow's skills. With no id resolvable it reports that plainly
// and exits 0: the orchestrator must not be stopped over it, and writing to a project-wide file is
// precisely the bug being removed.
//
// Self-contained on purpose: maestro-install.js copies this file into the
// project's .claude/scripts/ so the orchestrator agent can run it via $CLAUDE_PROJECT_DIR. The one
// thing it does NOT re-implement is session resolution — that comes from lib/maestro-session.cjs,
// which the same installer copies alongside it, so every caller resolves a session identically.

const fs = require("fs");
const path = require("path");
const { ensureSessionPaths } = require("./lib/maestro-session.cjs");

// Parse args: the first non-flag positional is the workflow name; `--task <f>`
// (or `--task=<f>`) carries the optional task filename.
function parseArgs(argv) {
  let workflowName = null;
  let task = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--task") {
      task = argv[++i] ?? null;
    } else if (a.startsWith("--task=")) {
      task = a.slice("--task=".length);
    } else if (!a.startsWith("--") && workflowName === null) {
      workflowName = a;
    }
  }
  return { workflowName, task };
}

const { workflowName, task } = parseArgs(process.argv.slice(2));
const activeTask = task ? path.basename(task) : null; // tolerate a path; key on the bare filename
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const claudeDir = path.join(projectDir, ".claude");
const maestroJsonPath = path.join(claudeDir, "maestro.json");

function resolveWorkflowName(name) {
  if (name) return name;
  try {
    const cfg = JSON.parse(fs.readFileSync(maestroJsonPath, "utf8"));
    const workflows = cfg.workflows ?? [];
    return (workflows[0] && workflows[0].name) || "default";
  } catch {
    // maestro.json absent or unreadable
    return "default";
  }
}

try {
  const resolvedName = resolveWorkflowName(workflowName);

  // Reported plainly rather than thrown: exit 0 so the orchestrator carries on, and say why the
  // workflow was not recorded, so a subagent later missing its injected skills has a stated cause
  // rather than looking like the hook failing.
  const sess = ensureSessionPaths(claudeDir);
  if (!sess) {
    process.stdout.write(
      `Maestro session: resolved workflow "${resolvedName}", but no Claude Code session id is ` +
        "available, so it was not recorded — subagents will fall back to the default workflow's skills.\n"
    );
    process.exit(0);
  }
  const sessionPath = sess.state;

  let session = {};
  try {
    session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
  } catch {
    // Start fresh
  }

  // Preserve every existing key (generated_instances, active_task from a prior
  // call, etc.) and only override what this invocation sets.
  const updated = {
    ...session,
    workflow: resolvedName,
    generated_instances: session.generated_instances ?? [],
  };
  // Only touch active_task when a task was passed, so re-running this mid-session
  // to switch workflows doesn't silently forget the task being completed.
  if (activeTask) updated.active_task = activeTask;

  const tmp = sessionPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(updated, null, 2));
  fs.renameSync(tmp, sessionPath);

  const taskNote = activeTask ? `, active task "${activeTask}"` : "";
  process.stdout.write(`Maestro session: active workflow set to "${resolvedName}"${taskNote}\n`);
  process.exit(0);
} catch (err) {
  process.stderr.write(`maestro-set-session-workflow: ${err.message}\n`);
  process.exit(1);
}
