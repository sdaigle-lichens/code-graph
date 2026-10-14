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
// `088` adds two kinds of line AFTER the id, each `<kind>: <project-relative file>`:
//
//   deliver: .claude/channels/backend/reviewer.1.md
//       Resume only. A current-run file waiting in the target's lane. A resume never receives
//       SubagentStart's additionalContext, so the orchestrator names this path in its SendMessage
//       and the agent Reads it. Recorded in session.json `resume_deliveries[<agent_id>]`; the
//       resumed run's own SubagentStop retires it (maestro-subagent-log.js).
//   missing: .claude/channels/backend/reviewer.1.md (from reviewer)
//       Resume OR cold. The latest workflow handoff's route to this target expects that payload and
//       no current-run file from the sender is in the lane. Also recorded as a `missing_payload`
//       handoff issue, so `maestro-task-status.cjs handoff-issues` reports it too. A pending
//       `missing_payload` whose files are now in the lane is dropped on the next call, so a
//       payload the sender wrote after the warning isn't reported as missing.
//
// So "no agent_id" means the first line is not a bare id: output empty, or starting `missing:`.
//
// Self-contained on purpose: maestro-install.js copies this file into the project's
// .claude/scripts/ so the orchestrator can run it via $CLAUDE_PROJECT_DIR.

const path = require("path");
const {
  readJson,
  readLogLines,
  readSession,
  writeSession,
  ensureSessionRunId,
  resolveSessionPaths,
  resumeTarget,
  resolveSearchList,
  handoffRoutes,
  routesFrom,
  payloadRoutes,
  pendingResumeDeliveries,
  recordResumeDeliveries,
  latestWorkflowHandoff,
  expectedLoopbackPayloads,
  missingLoopbackPayload,
  dropResolvedMissingPayloads,
  appendHandoffIssue,
} = require("./lib/maestro-session.cjs");

// The global handoff tier, read exactly as the SubagentStart/Stop hooks read it: a separate sqlite
// bundle, required lazily so an old `node` degrades to the seed tier instead of failing this CLI.
function readGlobalHandoff(handoffId) {
  try {
    const { readHandoffDefault } = require("./lib/maestro-handoff-defaults.cjs");
    return readHandoffDefault(handoffId);
  } catch {
    return null;
  }
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
      const out = [];
      if (id) out.push(id);

      // `088`: what this target's lane holds from THIS run, and what the loop-back expects there.
      // Best-effort on its own: a failure here must never cost the orchestrator the id above.
      try {
        const runId = ensureSessionRunId(sess.state);
        let state = readSession(sess.state);
        let changed = false;
        const deliveries = pendingResumeDeliveries(projectDir, agentType, runId);
        // A `missing_payload` the sender has since fixed would send the orchestrator after a file
        // that is already there: drop it before checking again.
        const pending = state.handoff_issues || [];
        const kept = dropResolvedMissingPayloads(pending, deliveries);
        if (kept.length !== pending.length) {
          state = { ...state, handoff_issues: kept };
          if (kept.length === 0) delete state.handoff_issues;
          changed = true;
        }
        if (id) {
          for (const d of deliveries) out.push(`deliver: ${d.file}`);
          state = recordResumeDeliveries(state, id, deliveries);
          changed = true;
        }
        const latest = latestWorkflowHandoff(lines);
        if (latest) {
          const { searchList } = resolveSearchList(cfg, state);
          const senderRoutes = payloadRoutes(
            projectDir,
            routesFrom(handoffRoutes(searchList, cfg.workflow_instances || []), latest.agentType),
            readGlobalHandoff
          );
          const expected = expectedLoopbackPayloads(latest, senderRoutes, agentType);
          const issue = missingLoopbackPayload(latest, expected, deliveries);
          if (issue) {
            for (const r of expected) {
              if (issue.files.includes(r.channelFile)) out.push(`missing: ${r.channelFile} (from ${r.sender})`);
            }
            state = { ...state, handoff_issues: appendHandoffIssue(state.handoff_issues, issue) };
            changed = true;
          }
        }
        if (changed) writeSession(sess.state, state);
      } catch {
        // Keep whatever was gathered; the id line is what matters most.
      }

      if (out.length > 0) process.stdout.write(out.join("\n") + "\n");
    }
  }
} catch {
  // Best-effort — empty output (spawn cold) is always the safe fallback.
}

process.exit(0);
