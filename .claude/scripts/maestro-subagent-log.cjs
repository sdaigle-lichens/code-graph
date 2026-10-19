#!/usr/bin/env node
// SubagentStart / SubagentStop hook — appends communication entries to the same per-session
// log.jsonl as maestro-session-log.js (PreToolUse): <cwd>/.claude/maestro_sessions/<id>/log.jsonl.
//
// SubagentStart  → dispatch entry:  who was called, with the full spawning message.
// SubagentStop   → handoff entry:   the agent's outcome, parsed from its HANDOFF: line,
//                                   with the full final message for debugging; then (`036`)
//                                   stamps every unstamped `.claude/channels/*/<this agent>.*`
//                                   file this agent just wrote with the run's own id — see
//                                   apps/maestro/src/core/handoff-channels.ts.
//
// Both are no-ops when maestro.json is absent (Maestro not configured for this project).
// Entries use kind:"dispatch"/"handoff" so the reader can distinguish them from
// the plain tool-call entries written by maestro-session-log.js.
// Append-only to the same file so parallel subagents don't race.
//
// TEAM MEETINGS: for an agent type listed as a participant of this session's active meeting
// (apps/maestro/src/core/meeting-mode.ts), both entries carry `meeting: true` — which keeps the run
// out of `agentRunsFromLog` (no later loop-back resumes a meeting turn) and lets the post-mortem
// digest label it — and SubagentStop skips the `078` transcript recovery and the channel stamping:
// a meeting turn has no HANDOFF to recover, and anything it left in a lane must not be delivered
// into a workflow step as this run's payload.
//
// OWNER RUNS (`081`): an agent type listed in session.json's `owner_runs` (set between a closed
// meeting and the last approved change being applied) gets the same treatment under `owner_run: true`:
// never a resume target, no recovery, no stamping. Unlike a meeting turn it is not write-confined.

const fs = require("fs");
const path = require("path");
const {
  readStdin,
  appendSessionLog,
  readJson,
  readSession,
  resolveSearchList,
  collectAgentSkills,
  bareAgentName,
  projectOwnsHook,
  ensureSessionRunId,
  writeStamp,
  meetingLeftovers,
  ensureSessionPaths,
  handbackHandoff,
  meetingFor,
  checkHandoff,
  checkRoute,
  checkPayload,
  handoffRoutes,
  routesFrom,
  payloadRoutes,
  payloadWrittenSince,
  runStartedAt,
  writeSession,
  ownerRunFor,
  ownerRunLeftovers,
  readLogLines,
  retireResumeDeliveries,
} = require("./lib/maestro-session.cjs");

// Resolve the loaded/referenced skills the SubagentStart hook would offer this
// agent, so the dispatch entry records what was on the table. /session-log diffs
// this against the agent's reported skillsTriage to surface silent omissions.
// Uses the same resolveSearchList + collectAgentSkills as maestro-inject-agent-context.js,
// so the logged set can't drift from the injected one. Returns null on any miss.
function offeredSkills(claudeDir, agentType, sessionStatePath) {
  if (!agentType) return null;
  const cfg = readJson(path.join(claudeDir, "maestro.json"));
  if (!cfg || cfg.version !== 3) return null;
  const session = readSession(sessionStatePath);
  const { searchList } = resolveSearchList(cfg, session);
  const { loaded, referenced, matchedInstances } = collectAgentSkills(
    searchList,
    cfg.workflow_instances || [],
    agentType
  );
  if (matchedInstances.length === 0) return null;
  return { loaded, referenced };
}

// `087`: the routes this agent may take whose receiver expects a payload — the same resolution
// (project file, global sqlite, seed) maestro-inject-agent-context.js told the agent to write.
function readGlobalHandoff(handoffId) {
  try {
    const { readHandoffDefault } = require("./lib/maestro-handoff-defaults.cjs");
    return readHandoffDefault(handoffId);
  } catch {
    return null;
  }
}

function agentPayloadRoutes(cwd, claudeDir, agentType, sessionStatePath) {
  const cfg = readJson(path.join(claudeDir, "maestro.json"));
  if (!cfg || cfg.version !== 3) return [];
  const { searchList } = resolveSearchList(cfg, readSession(sessionStatePath));
  const routes = routesFrom(handoffRoutes(searchList, cfg.workflow_instances || []), agentType);
  return payloadRoutes(cwd, routes, readGlobalHandoff);
}

// `108`: this agent's routes in the workflow the orchestrator recorded, or null when none was
// recorded (or it names no workflow) — the search list is then a guess, and a label missing from a
// guessed workflow is not evidence of a missing edge.
function activeWorkflowRoutes(claudeDir, agentType, sessionStatePath) {
  const cfg = readJson(path.join(claudeDir, "maestro.json"));
  if (!cfg || cfg.version !== 3) return null;
  const { searchList, activeWorkflowName } = resolveSearchList(cfg, readSession(sessionStatePath));
  if (!activeWorkflowName || !searchList.length || searchList.some((w) => w.name !== activeWorkflowName)) return null;
  return {
    workflow: activeWorkflowName,
    routes: routesFrom(handoffRoutes(searchList, cfg.workflow_instances || []), agentType),
  };
}

// Parse the HANDOFF: label from the agent's final message.
// Tolerates backticks, asterisks, and surrounding whitespace, e.g.:
//   HANDOFF: success
//   `HANDOFF: success`
//   **HANDOFF: tests_failed**
// Takes the LAST occurrence so a model preamble doesn't shadow the terminal line.
function parseHandoff(msg) {
  if (!msg || typeof msg !== "string") return { status: "unknown", label: null };
  const matches = [...msg.matchAll(/[`*]*HANDOFF:\s*([^\n`*]+)[`*]*/gi)];
  if (matches.length === 0) return { status: "unknown", label: null };
  const raw = matches[matches.length - 1][1].trim();
  if (!raw) return { status: "unknown", label: null };
  const label = raw;
  const status = label.toLowerCase() === "success" ? "success" : "condition";
  return { status, label };
}

(async () => {
  let p = {};
  try {
    p = JSON.parse((await readStdin()) || "{}");
  } catch {
    process.exit(0);
  }

  const cwd = p.cwd || process.env.CLAUDE_PROJECT_DIR || "";
  if (!cwd) process.exit(0);

  // Both delivery paths can register this hook. When the project registers its own copy, THIS
  // copy — the plugin's, running from the marketplace cache — stands down, so nothing fires twice.
  // A no-op in the copy installed into the project. See src/core/hook-arbitration.ts.
  if (projectOwnsHook(__filename, cwd, p.hook_event_name)) process.exit(0);

  const claudeDir = path.join(cwd, ".claude");
  if (!fs.existsSync(path.join(claudeDir, "maestro.json"))) process.exit(0);

  // `064`: which session's directory does this dispatch/handoff belong in? The payload's own
  // `session_id` (a subagent's payload carries the MAIN session's id, so one workflow run is one
  // directory), else CLAUDE_CODE_SESSION_ID, else nothing — and nothing means a silent no-op,
  // because a `run_id` minted into a shared file is exactly the cross-session bleed `064` removes.
  const sess = ensureSessionPaths(claudeDir, p);
  if (!sess) process.exit(0);

  const event = p.hook_event_name || "";
  const agentType = p.agent_type || "";
  const agentId = p.agent_id || "";
  const lastMsg = p.last_assistant_message || null;
  // A meeting participant's run (null for everyone else, and whenever no meeting runs).
  const sessionState = readJson(sess.state);
  const inMeeting = agentType ? !!meetingFor(sessionState, agentType) : false;
  // An owner run (`081`): a post-meeting run applying an approved change, outside the workflow.
  const inOwnerRun = !inMeeting && agentType ? !!ownerRunFor(sessionState, agentType) : false;
  const meetingMark = inMeeting ? { meeting: true } : inOwnerRun ? { owner_run: true } : {};

  try {
    if (event === "SubagentStart") {
      const offered = offeredSkills(claudeDir, agentType, sess.state);
      appendSessionLog(
        claudeDir,
        {
          ts: new Date().toISOString(),
          origin: "main_session",
          kind: "dispatch",
          agent: agentType,
          agent_id: agentId,
          input: lastMsg,
          ...(offered ? { offered_skills: offered } : {}),
          ...meetingMark,
          log: inMeeting ? `→ ${agentType} (meeting)` : inOwnerRun ? `→ ${agentType} (owner run)` : `→ ${agentType}`,
        },
        p
      );
    } else if (event === "SubagentStop") {
      if (!agentType) {
        // No agent_type → this SubagentStop isn't a real workflow agent handing
        // off (e.g. the /ai-tools listen-loop pausing for the user). Log it as a
        // transition boundary rather than letting it fall back to "unknown".
        appendSessionLog(
          claudeDir,
          {
            ts: new Date().toISOString(),
            origin: "transition",
            kind: "transition",
            output: lastMsg,
            log: "transition",
          },
          p
        );
      } else {
        let handoffMsg = lastMsg;
        let { status, label } = parseHandoff(handoffMsg);
        // `078`: an agent that hands back through a tool call has no HANDOFF: line in its final
        // message. Recover it from the agent's own transcript so the entry is not `unknown`. `087`:
        // that includes `SubagentHandback`, the hand-back tool current Claude Code tells every
        // subagent to end with — matching `SendMessage` alone is what flagged every agent of task
        // 084 as `missing` while each had ended `HANDOFF: success`.
        if (!inMeeting && !inOwnerRun && status === "unknown" && p.agent_transcript_path) {
          try {
            const viaSend = handbackHandoff(fs.readFileSync(p.agent_transcript_path, "utf8"));
            if (viaSend) {
              handoffMsg = viaSend;
              ({ status, label } = parseHandoff(viaSend));
            }
          } catch {
            // No readable transcript — keep the unknown entry.
          }
        }
        // `083`: a workflow agent whose final message has no HANDOFF line, or whose report verdict
        // is FAIL while the line says success, must not be routed by guesswork. Judge it, log it on
        // the entry, and record it in session.json where the orchestrator reads it back
        // (`maestro-task-status.cjs handoff-issues`). Only agents that map to a workflow instance
        // are judged: a generic Explore/general-purpose subagent never carries a HANDOFF line.
        let issue = null;
        if (!inMeeting && !inOwnerRun && offeredSkills(claudeDir, agentType, sess.state)) {
          issue = checkHandoff(handoffMsg);
          // `108`: a condition label the active workflow has no edge for — stop and ask, never improvise.
          if (!issue) {
            const active = activeWorkflowRoutes(claudeDir, agentType, sess.state);
            if (active) issue = checkRoute(handoffMsg, active.routes, active.workflow);
          }
          // `087`: the third issue — the route taken expects a payload and this run wrote none.
          // Checked BEFORE the stamping below; measured from this run's own dispatch entry, so a
          // file left from an earlier pass (or a loop-back's first run) does not count.
          if (!issue) {
            try {
              const since = runStartedAt(readLogLines(sess.log), agentId);
              issue = checkPayload(handoffMsg, agentPayloadRoutes(cwd, claudeDir, agentType, sess.state), (r) =>
                payloadWrittenSince(cwd, r, since)
              );
            } catch {
              // Best-effort — never fail the agent on a payload check.
            }
          }
        }
        // `088`: a RESUMED run was handed its current-run channel files by path, in the
        // orchestrator's SendMessage (`maestro-resume-target.cjs` recorded them), because a resume
        // never receives SubagentStart's additionalContext. This run is over, so it was delivered:
        // retire exactly those files now, logged as `channel_delivery` BEFORE this run's handoff
        // entry so the session-log view attaches it to this run's card.
        if (!inMeeting && !inOwnerRun && agentId) {
          try {
            const before = readSession(sess.state);
            if (before.resume_deliveries && before.resume_deliveries[agentId]) {
              const { session: after, retired } = retireResumeDeliveries(cwd, before, agentId, agentType);
              writeSession(sess.state, after);
              const receiver = bareAgentName(agentType);
              for (const e of retired) {
                appendSessionLog(
                  claudeDir,
                  {
                    ts: new Date().toISOString(),
                    origin: "main_session",
                    kind: "channel_delivery",
                    sender: e.sender,
                    receiver,
                    agent_id: agentId,
                    via: "resume",
                    content: e.body.trim(),
                    log: `channel: ${e.sender} → ${receiver} (resume)`,
                  },
                  p
                );
              }
            }
          } catch {
            // Best-effort — an unretired file is still delivered to a later cold start.
          }
        }
        // `p.transcript_path` here is `SubagentStopHookInput`'s own field — the SAME file the main
        // thread and every sibling subagent share (only `p.agent_transcript_path` is private to
        // this agent, and deriveUsage doesn't read it — see session-usage.ts's header). Treat this
        // handoff's ctx_pct as an estimate under parallel subagents, same caveat as every other kind.
        appendSessionLog(
          claudeDir,
          {
            ts: new Date().toISOString(),
            origin: agentType,
            kind: "handoff",
            agent_id: agentId,
            status,
            label,
            output: handoffMsg,
            ...meetingMark,
            ...(issue
              ? {
                  handoff_issue: {
                    kind: issue.kind,
                    verdict: issue.verdict,
                    label: issue.label,
                    message: issue.message,
                    ...(issue.files ? { files: issue.files } : {}),
                  },
                }
              : {}),
            log: inMeeting
              ? "meeting turn"
              : inOwnerRun
                ? "owner run"
                : (label ? `HANDOFF: ${label}` : "HANDOFF: (none)") + (issue ? ` [${issue.kind}]` : ""),
          },
          p
        );
        if (inMeeting || inOwnerRun) process.exit(0);

        if (issue) {
          try {
            const session = readSession(sess.state);
            const pending = Array.isArray(session.handoff_issues) ? session.handoff_issues : [];
            pending.push({
              ts: new Date().toISOString(),
              agent: agentType,
              agent_id: agentId,
              kind: issue.kind,
              verdict: issue.verdict,
              label: issue.label,
              message: issue.message,
              ...(issue.files ? { files: issue.files } : {}),
            });
            writeSession(sess.state, { ...session, handoff_issues: pending });
          } catch {
            // Best-effort — the log entry above still carries the issue.
          }
          // Also visible to the person watching; the orchestrator reads it from session.json.
          process.stdout.write(
            JSON.stringify({
              systemMessage: `Maestro: ${agentType} handoff problem (${issue.kind}). ${issue.message}`,
            }) + "\n"
          );
        }

        // `036`: stamp every unstamped channel file THIS agent just wrote, under whichever
        // receiver's lane it landed in, with the run's own id. Only the sender's own SubagentStop
        // does this — matched on the filename's sender segment against this agent's own bare
        // type — which is what keeps two parallel subagents from stamping each other's writes. A
        // file this agent was killed before writing (or never wrote) simply isn't found; a file it
        // wrote but the process died before this hook ran stays unstamped, and is treated exactly
        // like a foreign-run file by the receiving agent's SubagentStart.
        //
        // Minus a team meeting's leftovers: an unstamped file a participant left in a lane (Bash
        // writes are invisible to the write guard) is recorded in session.json when the meeting
        // ends, and stays unstamped while unchanged — the run_id lasts the whole session, so
        // otherwise this sender's next workflow run would adopt it as its own payload. No meeting
        // ever held = nothing skipped, the pre-meeting behaviour.
        try {
          const runId = ensureSessionRunId(sess.state);
          writeStamp(cwd, bareAgentName(agentType), runId, {
            skip: [...meetingLeftovers(sessionState), ...ownerRunLeftovers(sessionState)],
          });
        } catch {
          // Best-effort — never fail the agent on a stamping error.
        }
      }
    }
  } catch {
    // Best-effort — never fail the agent on a logging error.
  }

  process.exit(0);
})();
