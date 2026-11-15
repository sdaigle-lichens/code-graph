#!/usr/bin/env node
// SubagentStart / SubagentStop hook — appends communication entries to the same per-session
// log.jsonl as maestro-session-log.js (PreToolUse): <cwd>/.claude/maestro_sessions/<id>/log.jsonl.
//
// SubagentStart  → dispatch entry:  who was called, with the full spawning message.
// SubagentStop   → handoff entry:   the agent's outcome, parsed from its HANDOFF: line,
//                                   with the full final message for debugging; then (`036`)
//                                   stamps every unstamped `.claude/channels/<scope>/*/<this agent>.*`
//                                   file this agent just wrote with the run's own id — in this
//                                   session's own channel scope only (`144`) — see
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
  awaitHandback,
  meetingFor,
  checkHandoff,
  checkRoute,
  checkPayload,
  handoffRoutes,
  testHintRoutes,
  routesFrom,
  payloadRoutes,
  payloadWrittenSince,
  runStartedAt,
  agentRunStartedAt,
  isInterimStop,
  recordInterimStop,
  clearInterimStop,
  noteDispatch,
  runProfile,
  writeSession,
  ownerRunFor,
  ownerRunLeftovers,
  readLogLines,
  retireResumeDeliveries,
  parseGapsHandled,
  acknowledgeGaps,
  channelScopeOf,
  resolveSessionId,
  appendHandoffIssue,
  readGlobalHandoff,
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
function agentPayloadRoutes(cwd, scope, claudeDir, agentType, sessionStatePath) {
  const cfg = readJson(path.join(claudeDir, "maestro.json"));
  if (!cfg || cfg.version !== 3) return [];
  const { searchList } = resolveSearchList(cfg, readSession(sessionStatePath));
  const routes = routesFrom(handoffRoutes(searchList, cfg.workflow_instances || []), agentType);
  // `155`: test hints for a later `@test` step, written with `HANDOFF: success` (label "success").
  const hints = routesFrom(testHintRoutes(searchList, cfg.workflow_instances || []), agentType);
  return payloadRoutes(cwd, scope, [...routes, ...hints], readGlobalHandoff);
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
  // `144`: this session's channel scope. Stamping, the payload check, resume retirement and gap
  // acknowledgement below all act on this scope's lanes only.
  const scope = channelScopeOf(cwd, resolveSessionId(p));

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
      // `160`: this agent id's pending interim stop is over (it was resumed); every other pending
      // one is marked "moved on", the orchestrator has dispatched another WORKFLOW agent since. A
      // generic helper (Explore, general-purpose), a meeting or an owner-run agent maps to no workflow
      // instance and is never the orchestrator moving on, so it only clears its own marker (if any).
      // Limit: a workflow agent started inside another agent's run cannot be told from the
      // orchestrator's own dispatch, so it counts as moving on.
      if (agentType && !inMeeting && !inOwnerRun) {
        try {
          const st = readSession(sess.state);
          if (st.pending_interim && Object.keys(st.pending_interim).length > 0) {
            const workflowAgent = !!offeredSkills(claudeDir, agentType, sess.state);
            writeSession(sess.state, {
              ...st,
              pending_interim: workflowAgent
                ? noteDispatch(st.pending_interim, agentId)
                : clearInterimStop(st.pending_interim, agentId),
            });
          }
        } catch {
          // Best-effort.
        }
      }
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
        // `124`: SubagentStop fires BEFORE Claude Code has flushed the agent's final hand-back
        // tool_use to that transcript, so a single read missed it and every hand-back agent was
        // flagged `missing`. awaitHandback re-reads until the call lands (bounded).
        // `153`: this run's dispatch time, so a hand-back older than it (an earlier run's, seen
        // before the resume prompt reached the transcript) is never taken for this run's.
        let runSince = null;
        // `160`: when the WHOLE run started (first dispatch), for the payload check across resumes.
        let wholeRunSince = null;
        try {
          const logLines = readLogLines(sess.log);
          runSince = runStartedAt(logLines, agentId);
          wholeRunSince = agentRunStartedAt(logLines, agentId);
        } catch {
          runSince = null;
        }
        // `160`: a stop with no hand-back call (the agent may be waiting on background work, to be
        // resumed, or may have ended in plain text) cannot be told from a final one by the stop input,
        // so it is not judged now: logged `interim: true` with no issue, and recorded in
        // session.json's `pending_interim`. A resume clears it; `handoff-issues` promotes it to a
        // `missing` issue once nothing resumed it. Set below when the readable transcript shows no
        // hand-back call in this run (a workflow agent only).
        let interim = false;
        if (!inMeeting && !inOwnerRun && status === "unknown" && p.agent_transcript_path) {
          try {
            const viaSend = await awaitHandback(
              () => {
                try {
                  return fs.readFileSync(p.agent_transcript_path, "utf8");
                } catch {
                  return null;
                }
              },
              (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
              undefined,
              undefined,
              runSince
            );
            if (viaSend) {
              handoffMsg = viaSend;
              ({ status, label } = parseHandoff(viaSend));
            } else {
              // No labelled hand-back. A labelless call is a real `missing` (the final stop); no call
              // at all, in a readable transcript, is an interim stop. Unreadable: cannot tell, judge.
              const text = fs.readFileSync(p.agent_transcript_path, "utf8");
              interim = isInterimStop(text, runSince) && !!offeredSkills(claudeDir, agentType, sess.state);
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
        if (!inMeeting && !inOwnerRun && !interim && offeredSkills(claudeDir, agentType, sess.state)) {
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
              // `160`: from the start of the whole run, so a payload written before a resume counts.
              const since = wholeRunSince;
              // `153`: a resumed run that changed no file only re-verified; it has no payload to write.
              let reverifyOnly = false;
              if (p.agent_transcript_path) {
                try {
                  const prof = runProfile(fs.readFileSync(p.agent_transcript_path, "utf8"), runSince);
                  reverifyOnly = prof.resumed && !prof.wroteFiles;
                } catch {
                  // Unreadable transcript — keep checking.
                }
              }
              if (!reverifyOnly)
                issue = checkPayload(
                  handoffMsg,
                  agentPayloadRoutes(cwd, scope, claudeDir, agentType, sess.state),
                  (r) => payloadWrittenSince(cwd, r, since)
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
              const { session: after, retired } = retireResumeDeliveries(cwd, scope, before, agentId, agentType);
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
        // `112`: a scribe's skill-gap reports stay in its lane across deliveries until it names
        // them on a `SKILL_GAPS_HANDLED:` line. Retire exactly those now (gap reports only — a
        // non-scribe agent's line, or a name that is not a gap, retires nothing), logged as a
        // `channel_delivery` with `via: "ack"`.
        if (!inMeeting && !inOwnerRun && bareAgentName(agentType) === "scribe") {
          try {
            const names = parseGapsHandled(`${lastMsg || ""}\n${handoffMsg === lastMsg ? "" : handoffMsg || ""}`);
            const acked = names.length > 0 ? acknowledgeGaps(cwd, scope, names) : [];
            for (const e of acked) {
              appendSessionLog(
                claudeDir,
                {
                  ts: new Date().toISOString(),
                  origin: "main_session",
                  kind: "channel_delivery",
                  sender: e.sender,
                  receiver: "scribe",
                  agent_id: agentId,
                  via: "ack",
                  content: e.body.trim(),
                  log: `channel: ${e.sender} → scribe (gap acknowledged: ${e.fileName})`,
                },
                p
              );
            }
          } catch {
            // Best-effort — an unacknowledged gap is delivered again to the next scribe.
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
            // `169`: `settles_in_log` says `handoff-issues` will log an `interim_settled` line when it
            // settles this stop, so a reader (the post-mortem digest) treats "no line yet" as pending.
            ...(interim ? { interim: true, settles_in_log: true } : {}),
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
                : interim
                  ? "interim stop (no hand-back yet)"
                  : (label ? `HANDOFF: ${label}` : "HANDOFF: (none)") + (issue ? ` [${issue.kind}]` : ""),
          },
          p
        );
        if (inMeeting || inOwnerRun) process.exit(0);

        // `160`: an interim stop is recorded as pending (no issue yet); any other stop of this agent id
        // is a judged one, which settles whatever interim stop preceded it.
        if (agentId) {
          try {
            const st = readSession(sess.state);
            if (interim) {
              writeSession(sess.state, {
                ...st,
                pending_interim: recordInterimStop(st.pending_interim, {
                  ts: new Date().toISOString(),
                  agent: agentType,
                  agent_id: agentId,
                  transcript_path: p.agent_transcript_path,
                  run_since: runSince,
                  cwd,
                  scope,
                }),
              });
            } else if (st.pending_interim && st.pending_interim[agentId]) {
              writeSession(sess.state, { ...st, pending_interim: clearInterimStop(st.pending_interim, agentId) });
            }
          } catch {
            // Best-effort — the log entry above still carries `interim: true`.
          }
        }

        if (issue) {
          try {
            const session = readSession(sess.state);
            // The stop hook can fire twice for one resumed run: appendHandoffIssue lists an issue once.
            const pending = appendHandoffIssue(session.handoff_issues, {
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
              systemMessage:
                issue.kind === "blocked"
                  ? `Maestro: ${agentType} is blocked on you. ${issue.message}`
                  : `Maestro: ${agentType} handoff problem (${issue.kind}). ${issue.message}`,
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
        //
        // `160`: not at an interim stop. The run is not over, and the stamp rewrites each file, which
        // refreshes its mtime, so a stale file left from an earlier run would then pass the payload
        // check at the final stop. The final stop stamps everything the whole run wrote.
        if (!interim) {
          try {
            const runId = ensureSessionRunId(sess.state);
            writeStamp(cwd, scope, bareAgentName(agentType), runId, {
              skip: [...meetingLeftovers(sessionState), ...ownerRunLeftovers(sessionState)],
            });
          } catch {
            // Best-effort — never fail the agent on a stamping error.
          }
        }
      }
    }
  } catch {
    // Best-effort — never fail the agent on a logging error.
  }

  process.exit(0);
})();
