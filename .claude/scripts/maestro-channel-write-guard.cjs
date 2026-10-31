#!/usr/bin/env node
// PreToolUse hook (matcher: Write|Edit|MultiEdit|NotebookEdit). Also refuses, for ANY caller, a
// write into the main checkout while the session runs its task in a git worktree (`082`; logic in
// apps/maestro/src/core/worktree-write-guard.ts). Its original job — confines the reviewer and
// refactor agents' file writes to `<cwd>/.claude/channels/<scope>/`, this session's own channel
// scope (`144`, resolved here from the session, never from the agent), so they can hand a payload
// to the next agent without being able to modify code, docs or config, or another session's lanes.
// Every other agent is untouched.
//
// Registered from the plugin's hooks.json AND, since `121`, from a project-local install (a
// project can run a forked or user-tier `reviewer` with the plugin disabled, and this hook is the
// only thing confining it). EXEMPT from the plugin-copy stand-down the other dual-registered hooks
// use (`122`): standing down on the project's registration alone fails open when the project copy
// can't run (its script or lib/ missing exits 1, which Claude Code treats as non-blocking). This
// guard only ever denies, so both copies running is the stricter outcome; an older plugin copy
// denying what a newer project copy allows is acceptable for a confinement hook.
// Deliberately NOT gated on maestro.json: the agents'
// frontmatter no longer carries `disallowedTools`, so this hook is the only thing standing between
// them and a write anywhere. Logic: apps/maestro/src/core/channel-write-guard.ts.
//
// Known gap: the matcher covers file-write tools only. reviewer/refactor have no `tools:` line, so
// they keep Bash, and a Bash redirect or `tee` is NOT confined. They don't normally write that way;
// a post-mortem finding one doing it is the trigger for a stronger guard.

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
  channelScopeOf,
  resolveSessionId,
} = require("./lib/maestro-session.cjs");

(async () => {
  let p = {};
  try {
    p = JSON.parse((await readStdin()) || "{}");
  } catch {
    process.exit(0);
  }

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
      // Only a confined agent needs it; resolved lazily so nobody else pays for the session read.
      channelScope: p.cwd && isChannelOnlyAgent(p.agent_type) ? channelScopeOf(p.cwd, resolveSessionId(p)) : null,
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
