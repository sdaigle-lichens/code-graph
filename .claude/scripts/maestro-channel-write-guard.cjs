#!/usr/bin/env node
// PreToolUse hook (matcher: Write|Edit|MultiEdit|NotebookEdit). Also refuses, for ANY caller, a
// write into the main checkout while the session runs its task in a git worktree (`082`; logic in
// apps/maestro/src/core/worktree-write-guard.ts). Its original job — confines the reviewer and
// refactor agents' file writes to `<cwd>/.claude/channels/`, so they can hand a payload to the
// next agent without being able to modify code, docs or config. Every other agent is untouched.
//
// Registered from the plugin's hooks.json AND, since `121`, from a project-local install (a
// project can run a forked or user-tier `reviewer` with the plugin disabled, and this hook is the
// only thing confining it). When the project registers its own copy, the plugin's copy stands down
// (projectOwnsHook below). Deliberately NOT gated on maestro.json: the agents'
// frontmatter no longer carries `disallowedTools`, so this hook is the only thing standing between
// them and a write anywhere. Logic: apps/maestro/src/core/channel-write-guard.ts.

//
// Team meetings: while this session's session.json carries a `meeting` naming this agent type as a
// participant, ANY agent type is confined to `<session dir>/meeting/` instead (see
// apps/maestro/src/core/meeting-mode.ts). Only a subagent call is in scope — the main session's
// PreToolUse payload carries no `agent_type`, so the moderator can still apply approved changes.

const path = require("path");
const {
  readStdin,
  readJson,
  checkChannelWrite,
  isChannelOnlyAgent,
  resolveSessionPaths,
  meetingFor,
  meetingDirFor,
  checkWorktreeWrite,
  projectOwnsHook,
} = require("./lib/maestro-session.cjs");

(async () => {
  let p = {};
  try {
    p = JSON.parse((await readStdin()) || "{}");
  } catch {
    process.exit(0);
  }

  // The plugin's copy stands down when the project registers its own (no-op in the project's copy).
  // See src/core/hook-arbitration.ts. Before any fail-closed path: a stood-down copy decides nothing.
  if (p.cwd && projectOwnsHook(__filename, p.cwd, p.hook_event_name)) process.exit(0);

  let verdict;
  let participant = false;
  try {
    let meetingDir = null;
    if (p.agent_type && p.cwd) {
      const sess = resolveSessionPaths(path.join(p.cwd, ".claude"), p);
      if (sess && meetingFor(readJson(sess.state), p.agent_type)) {
        participant = true;
        meetingDir = meetingDirFor(sess.dir);
      }
    }
    // A session running its task in a git worktree may not write into the main checkout (`082`).
    // Applies to every agent AND the main session. Fails open: it only ever narrows.
    let worktreeVerdict = { allow: true };
    try {
      if (p.cwd) {
        const sess = resolveSessionPaths(path.join(p.cwd, ".claude"), p);
        const state = sess ? readJson(sess.state) : null;
        worktreeVerdict = checkWorktreeWrite({
          cwd: p.cwd,
          toolName: p.tool_name,
          toolInput: p.tool_input,
          worktree: state && state.worktree,
        });
      }
    } catch {
      worktreeVerdict = { allow: true };
    }
    verdict = checkChannelWrite({
      cwd: p.cwd || "",
      agentType: p.agent_type,
      toolName: p.tool_name,
      toolInput: p.tool_input,
      meetingDir,
    });
    if (verdict.allow) verdict = worktreeVerdict;
  } catch (err) {
    // A restricted agent or a meeting participant must fail closed; anyone else was never in scope.
    if (!participant && !isChannelOnlyAgent(p.agent_type)) process.exit(0);
    verdict = { allow: false, reason: `Blocked: channel write check failed (${err && err.message}).` };
  }

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
  process.exit(0);
})();
