#!/usr/bin/env node
// SubagentStart hook for worker subagents.
// Reads <cwd>/.claude/maestro.json (v3), looks up the invoked agent type's instance
// in the active workflow, and emits as additionalContext:
//   1a. loaded_skills     — skills to load (Skill tool) before working,
//   1b. referenced_skills — skills available, loaded only if the task needs them,
//   2. the HANDOFF routing lines this agent may emit (success + condition labels), each paired
//      with the channel file to WRITE its payload to (`.claude/channels/<receiver>/<sender>.1.md`),
//      resolved across three tiers (.claude/handoffs/<sender>/<receiver>.md, then
//      ~/.claude/maestro-handoff-defaults.sqlite, then the seed constant that ships inside
//      lib/maestro-session.cjs) so the whole communication layer lives here rather than in
//      each agent file.
// The skills/routing block above is a no-op when maestro.json is absent, not v3, or the agent
// type is not mapped to any workflow node.
//
// `061`: a `loaded_skills`/`referenced_skills` id that resolves to a project skill OUTSIDE the
// repository root's `.claude/skills` (a monorepo skill living beside the code it documents) is one
// the Skill tool cannot find — it only indexes the root plus installed plugins. Each block below
// additionally resolves its own ids via `resolveProjectSkillPath`/`isRootSkillPath` and, for any
// that land outside the root, names the file to `Read` directly instead. A root or plugin id keeps
// today's wording verbatim; the extra note is appended only when there is something nested to
// report.
//
// A THIRD, INDEPENDENT branch (`036`) delivers whatever is waiting for this agent's BARE type in
// `.claude/channels/<bareAgentType>/` — same-run files inlined and retired, everything else only
// mentioned. See apps/maestro/src/core/handoff-channels.ts. Gated on nothing but the lane having
// files in it: a channel is a filesystem fact, not a workflow-routing one, which is what lets a
// gap reach `@scribe` on a later run even when this run's workflow never wired a route to it.
//
// A FOURTH, INDEPENDENT branch resolves this agent's "Mandatory Output Format" report (project
// override at .claude/reports/<id>.md, else the global default in
// ~/.claude/maestro-report-defaults.sqlite, else nothing) and injects it as its own
// additionalContext part. Deliberately NOT gated on matchedInstances / a resolved workflow, and
// not gated on maestro.json existing at all: a report has to reach an agent used outside
// Maestro's routing (or in a project with no maestro.json, for the global tier) exactly as the
// static `## Mandatory Output Format` section it replaced always did. See
// apps/maestro/src/core/report-resolution.ts for the same order, applied pure-side for the app's
// /agents page.
//
// `SubagentStart` fires again on a RESUME (`039` — a condition edge routing back to an agent that
// already ran this session, `SendMessage`d instead of dispatched cold). Everything above except
// the channel delivery and the warning is therefore already verbatim in the resumed agent's own
// history — re-injecting it is 500-700 tokens of exact repetition, and `loaded_skills` is worse
// than waste: it is an instruction to redo a tool call. `040` detects that case with
// `hasCompletedRun` (a `kind:"handoff"` entry already logged for this `agent_id`, in the SAME
// per-run log `039` reads) and swaps the five static blocks — loaded/referenced skills, HANDOFF
// routing, per-route protocols, and the report — for one line. The channel delivery is NOT
// skipped: a payload may have arrived in this agent's lane between its two runs, and it doesn't
// duplicate on its own (`retire()` already moved the first run's file to `.consumed/`).

const fs = require("fs");
const path = require("path");
const {
  readStdin,
  readJson,
  resolveWorkflowName,
  readSession,
  writeSession,
  ensureSessionRunId,
  appendSessionLog,
  resolveSearchList,
  collectAgentSkills,
  bareAgentName,
  projectOwnsHook,
  handoffRoutes,
  routesFrom,
  resolveHandoff,
  readLane,
  retire,
  ensureSessionPaths,
  hasCompletedRun,
  resolveProjectSkillPath,
  isRootSkillPath,
} = require("./lib/maestro-session.cjs");

// The resume signal (`040`): a `kind:"handoff"` entry already logged for this `agent_id`, read
// straight off disk — best-effort, exactly like maestro-resume-target.cjs's own copy of this same
// tiny reader. A missing or unreadable log comes back `[]`, which `hasCompletedRun` answers
// `false` for, so the safe fall-through is a first run's full injection.
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

// ── nested-skill fallback (`061`) ───────────────────────────────────────────
//
// `skills_available` can hold ids discovered outside the repository ROOT's `.claude/skills` (a
// monorepo skill living beside the code it documents), and the Skill tool only indexes that root
// directory plus installed plugins — it answers "Unknown skill" for the rest. `loadedIds`/
// `referencedIds` below name which of a block's ids fall into that case, so the message can tell
// the agent to read the file directly instead of repeating an instruction the Skill tool can't
// act on.
function nestedSkillPaths(projectDir, ids) {
  const nested = [];
  for (const id of ids) {
    const skillPath = resolveProjectSkillPath(projectDir, id);
    if (skillPath && !isRootSkillPath(projectDir, skillPath)) {
      nested.push({ id, path: path.relative(projectDir, skillPath) });
    }
  }
  return nested;
}

function nestedSkillNote(nested) {
  const lines = nested.map((n) => `- \`${n.id}\` — read \`${n.path}\` directly.`);
  return (
    `${nested.length === 1 ? "One of these" : "Some of these"} ${nested.length === 1 ? "lives" : "live"} outside this ` +
    `project's root \`.claude/skills\`, so the Skill tool will answer "Unknown skill" for it instead of finding it:\n` +
    `${lines.join("\n")}\n\n` +
    `Reading the file gets you its content, not the Skill tool's own resource handling — for a concept skill (prose, ` +
    `no bundled scripts or resources) that is the whole of it, so this is not a lesser substitute here.`
  );
}

// ── handoff protocol resolution — three tiers, one shared decision ─────────

// The project tier: `.claude/handoffs/<sender>/<receiver>.md`, which install now MATERIALIZES for
// every route the workflows wire (see apps/maestro/src/core/handoff-sync.ts) rather than leaving
// as an undocumented escape hatch. There is no second file candidate any more: the plugin's
// `templates/handoffs/` copy is gone, because an installer that blind-overwrites its own fallback
// on every run means a user's edit there disappears silently.
function readProjectHandoff(projectDir, handoffId) {
  try {
    const [sender, receiver] = handoffId.split("/");
    const body = fs.readFileSync(path.join(projectDir, ".claude", "handoffs", sender, `${receiver}.md`), "utf8").trim();
    return body || null;
  } catch {
    return null;
  }
}

// The global tier: ~/.claude/maestro-handoff-defaults.sqlite. Wrapped in try/catch like every
// other caller of a generated sqlite lib — an older `node` on this session's PATH (< 22.5, no
// node:sqlite) or a missing bundle degrades to null, and `resolveHandoff` then falls through to
// the SEED, which travels inside lib/maestro-session.cjs and needs no sqlite at all. That
// fall-through is the whole reason the seeds were split out of the store.
function readGlobalHandoff(handoffId) {
  try {
    const { readHandoffDefault } = require("./lib/maestro-handoff-defaults.cjs");
    return readHandoffDefault(handoffId);
  } catch {
    return null;
  }
}

// Project file -> global row -> shipped seed -> nothing. `resolveHandoff` is the same pure
// function apps/maestro's own surfaces call, so the hook and the app cannot disagree about what
// an agent will be told to emit.
function handoffProtocol(projectDir, handoffId) {
  const resolved = resolveHandoff(handoffId, readProjectHandoff(projectDir, handoffId), readGlobalHandoff(handoffId));
  return resolved.content;
}

function collect(cfg, sessionPath, agentType) {
  const instances = cfg.workflow_instances || [];

  const session = readSession(sessionPath);

  // Scope to the active workflow when it resolves; fall back to the default
  // workflow when none is set yet, or union-and-warn on a broken active name.
  // resolveSearchList owns this logic (shared with maestro-subagent-log.js so
  // the offered-skills it logs match exactly what we inject here).
  const { searchList, warning, activeWorkflowName } = resolveSearchList(cfg, session);

  // loaded = auto-load before working; referenced = available, load only if the
  // task needs it. collectAgentSkills owns the node-walk + dedup (loaded wins).
  const { loaded: loadedList, referenced: referencedList, matchedInstances } = collectAgentSkills(
    searchList,
    instances,
    agentType
  );

  // The route walk USED TO LIVE HERE, inline. It is `handoffRoutes()` in
  // apps/maestro/src/core/handoff-routes.ts now, reached through the generated lib, because the
  // install-time sync has to answer the same question — "which handoffs does this project have?"
  // — and two implementations is how the materialized files and the injected protocols drift.
  // Both ends come back BARE, which is the fix for a project whose instances carry namespaced
  // agents (`maestro:test`): the receiver used to be compared and pathed un-bared and resolved no
  // protocol at all, silently.
  const routes = routesFrom(handoffRoutes(searchList, instances), agentType);

  if (matchedInstances.length === 0) return null;

  // Record the generated instances in the session (best-effort). Spread the session read above
  // rather than building a bare object — `run_id` (`036`) and anything else a caller has already
  // set (e.g. `active_task`, from maestro-set-session-workflow.cjs) must survive this write, or a
  // channel file stamped earlier in the SAME run stops matching what this hook mints next.
  try {
    const generated = session.generated_instances || [];
    for (const name of matchedInstances) if (!generated.includes(name)) generated.push(name);
    // `064`: `sessionPath` is null when no session id resolved. Nothing to write back then — the
    // injection itself still happens in full, which is this hook's existing safe direction.
    if (!sessionPath) throw new Error("no session");
    writeSession(sessionPath, {
      ...session,
      workflow: activeWorkflowName || resolveWorkflowName(cfg),
      generated_instances: generated,
    });
  } catch {
    // Don't fail the hook on session write errors.
  }

  return {
    loadedSkills: loadedList,
    referencedSkills: referencedList,
    routes,
    warning,
  };
}

// ── report injection — independent of workflow matching ────────────────────

// A project override at .claude/reports/<id>.md, where <id> is whatever the project's `reports`
// slice maps this agent to (usually the agent's own name, but the schema allows any id). null
// when the project has no such mapping, or the mapped file is absent/empty.
function readProjectReportOverride(projectDir, cfg, bareAgent) {
  const entry = cfg && cfg.reports && cfg.reports[bareAgent];
  if (!entry || !entry.id) return null;
  try {
    const body = fs.readFileSync(path.join(projectDir, ".claude", "reports", `${entry.id}.md`), "utf8").trim();
    if (body) return { content: body, reportId: entry.id };
  } catch {
    // absent file — fall through
  }
  return null;
}

// The global tier: ~/.claude/maestro-report-defaults.sqlite, via the generated lib — wrapped in
// try/catch exactly like maestro-skill-tags.cjs's caller, so an older `node` on this session's
// PATH (< 22.5, no node:sqlite) degrades to "no global default" rather than failing the hook.
function readGlobalReportDefault(bareAgent) {
  try {
    const { readAgentReportDefault } = require("./lib/maestro-report-defaults.cjs");
    return readAgentReportDefault(bareAgent);
  } catch {
    return null;
  }
}

// Order: project override -> global default -> none (nothing emitted). `cfg` may be null (no
// maestro.json at all) — a project override is then impossible, but the global tier still applies,
// which is the whole reason this is a separate, unconditional branch.
function collectReportContext(cfg, projectDir, agentType) {
  const bareAgent = bareAgentName(agentType);
  const resolved = readProjectReportOverride(projectDir, cfg, bareAgent) || readGlobalReportDefault(bareAgent);
  if (!resolved) return null;
  return `Mandatory output format for the \`${agentType}\` agent:\n\n${resolved.content}`;
}

(async () => {
  let payload = {};
  try {
    payload = JSON.parse((await readStdin()) || "{}");
  } catch {
    process.exit(0);
  }

  // SubagentStart provides agent_type (the subagent's `name` frontmatter value).
  const agentType = payload && payload.agent_type ? payload.agent_type : "";
  if (!agentType) process.exit(0);

  const projectDir = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();

  // Both delivery paths can register this hook. When the project registers its own copy, THIS
  // copy — the plugin's, running from the marketplace cache — stands down, so nothing fires twice.
  // A no-op in the copy installed into the project. See src/core/hook-arbitration.ts.
  if (projectOwnsHook(__filename, projectDir, payload.hook_event_name)) process.exit(0);

  // May be null (absent), or present but not v3 — either way the skills/routing block below is
  // skipped, but `cfg` (even null) is still passed to the report branch, which has its own,
  // looser no-op condition (see collectReportContext's header comment).
  const cfg = readJson(path.join(projectDir, ".claude", "maestro.json"));

  // `064`: this session's own directory — payload `session_id` first (a subagent's payload carries
  // the MAIN session's id), else CLAUDE_CODE_SESSION_ID, else null. Null degrades to FULL
  // injection, never to silence: this hook is the one caller whose safe direction is to say too
  // much rather than too little, the same stance `hasCompletedRun` already takes on an unreadable
  // log. Everything downstream takes `sess && sess.<file>` and tolerates the null.
  const claudeDir = path.join(projectDir, ".claude");
  const sess = ensureSessionPaths(claudeDir, payload);

  const parts = [];

  const result = cfg && cfg.version === 3 ? collect(cfg, sess ? sess.state : null, agentType) : null;

  // `040`: is THIS SubagentStart a resume? See the header comment above for why `handoff` (never
  // `dispatch`, never session.json) is the right, race-proof signal. No session directory ⇒ no
  // lines ⇒ not a resume ⇒ full injection.
  const isResume = payload.agent_id
    ? hasCompletedRun(readLogLines(sess ? sess.log : null), payload.agent_id)
    : false;

  if (result) {
    if (result.warning) {
      parts.push(`⚠️ Maestro warning: ${result.warning}`);
    }
    if (!isResume && result.loadedSkills.length > 0) {
      let text =
        `Skills to load for the \`${agentType}\` agent instance (maestro.json v3, loaded_skills): ${result.loadedSkills.join(", ")}.\n\n` +
        `Load each one with the Skill tool before starting your work, then follow your agent file as written.`;
      const nested = nestedSkillPaths(projectDir, result.loadedSkills);
      if (nested.length > 0) text += `\n\n${nestedSkillNote(nested)}`;
      parts.push(text);
    }

    if (!isResume && result.referencedSkills.length > 0) {
      let text =
        `Skills available to the \`${agentType}\` agent instance (maestro.json v3, referenced_skills): ${result.referencedSkills.join(", ")}.\n\n` +
        `Do NOT bulk-load these up front — but they exist because they document logic you would otherwise have to ` +
        `reverse-engineer from source. So before you open or edit a source file, check what each one covers (its ` +
        `description is in your skills list): if a referenced skill documents that file or the logic it implements, ` +
        `load it with the Skill tool FIRST — ` +
        `read the skill before the source, not after. Load only the ones whose logic the task actually touches and ` +
        `ignore the rest, but do not rediscover from the code what a skill already explains.`;
      const nested = nestedSkillPaths(projectDir, result.referencedSkills);
      if (nested.length > 0) text += `\n\n${nestedSkillNote(nested)}`;
      parts.push(text);
    }
  }

  // Replaces loaded_skills, referenced_skills, HANDOFF routing, the per-route protocols and the
  // report below — not silence. Placed before the channel delivery, which is the one block that
  // is NOT static and is never skipped.
  if (isResume) {
    parts.push("Resumed run — the skills, handoff routes and output format from your first run still apply.");
  }

  if (!isResume && result && result.routes.length > 0) {
    const hasSuccess = result.routes.some((r) => r.label === "success");
    const lines = result.routes.map((r) => {
      const to = r.receiver ? ` (routes to \`${r.receiver}\`)` : "";
      return r.label === "success"
        ? `- \`HANDOFF: success\` — continue along the workflow's success path${to}.`
        : `- \`HANDOFF: ${r.label}\` — when that condition applies${to}.`;
    });
    parts.push(
      `Handoff routing for the \`${agentType}\` agent. End your final message with exactly one \`HANDOFF:\` line so ` +
        `the orchestrator can route deterministically:\n${lines.join("\n")}` +
        (hasSuccess ? "" : "\n(No success path leaves this node — it only feeds back via the condition above.)")
    );

    // Per-route payload protocol, resolved across the three tiers above so the communication
    // contract is owned here rather than duplicated in the agent files. Only emitted for routes
    // whose pair resolves to something — a wired route with no template anywhere (`scribe ->
    // reviewer`) is silently skipped, exactly as the install-time sync skips it.
    //
    // `036`: the payload no longer rides in the final-message JSON. Each route names the CHANNEL
    // FILE to write it to instead — `.claude/channels/<receiver>/<sender>.1.md` — which the
    // receiving agent's own SubagentStart delivers on its next invocation. The orchestrator never
    // sees the content at all.
    const bareAgent = bareAgentName(agentType);
    const protocols = [];
    for (const r of result.routes) {
      if (!r.receiver) continue;
      const proto = handoffProtocol(projectDir, `${r.sender}/${r.receiver}`);
      if (!proto) continue;
      protocols.push(
        `Route \`HANDOFF: ${r.label}\` → \`${r.receiver}\` — write this to ` +
          `\`.claude/channels/${r.receiver}/${bareAgent}.1.md\`:\n\n${proto}`
      );
    }
    if (protocols.length > 0) {
      parts.push(
        `When you hand off, write the shape for the route you take to your channel file, verbatim ` +
          `(skip the write, or write an empty JSON object, when nothing applies):\n\n${protocols.join("\n\n")}`
      );
    }
  }

  // ── channel delivery — independent of workflow matching ────────────────
  //
  // `036`: whatever is waiting for this agent in `.claude/channels/<bare agentType>/`, resolved
  // for the BARE agent type exactly like the report tier below — `maestro:test` reads the `test`
  // lane, the bug `033` fixed on both ends of a route id. Same-run deliveries are inlined and
  // retired (moved to `.consumed/`, never deleted); anything else is only mentioned, never
  // inlined — see the header of handoff-channels.ts for why.
  {
    const bareAgent = bareAgentName(agentType);
    const entries = readLane(projectDir, bareAgent);
    if (entries.length > 0) {
      // `064`: no session directory ⇒ no `run_id` to mint or compare against, so nothing matches
      // and every entry falls into `waiting` — MENTIONED rather than inlined. That is the same
      // answer a foreign-run file already gets, and the conservative one: an un-attributable
      // payload is exactly what must not be inlined verbatim.
      const runId = sess ? ensureSessionRunId(sess.state) : null;
      const delivered = runId ? entries.filter((e) => e.runId === runId) : [];
      const waiting = runId ? entries.filter((e) => e.runId !== runId) : entries;

      if (delivered.length > 0) {
        const blocks = delivered.map((e) => `From \`${e.sender}\` (\`${e.fileName}\`):\n\n${e.body.trim()}`);
        parts.push(
          `Delivered to your channel (\`.claude/channels/${bareAgent}/\`) — inlined verbatim, nothing to re-derive:\n\n` +
            blocks.join("\n\n---\n\n")
        );
        for (const e of delivered) {
          retire(projectDir, bareAgent, e);
          try {
            appendSessionLog(
              claudeDir,
              {
                ts: new Date().toISOString(),
                origin: "main_session",
                kind: "channel_delivery",
                sender: e.sender,
                receiver: bareAgent,
                agent_id: payload.agent_id || "",
                content: e.body.trim(),
                log: `channel: ${e.sender} → ${bareAgent}`,
              },
              payload
            );
          } catch {
            // Best-effort — never fail the hook on a logging error.
          }
        }
      }

      if (waiting.length > 0) {
        const days = (ms) => `${(ms / (24 * 60 * 60 * 1000)).toFixed(1)}d`;
        const lines = waiting.map(
          (e) =>
            `- from \`${e.sender}\`, ${days(e.ageMs)} old${e.runId ? "" : " (unstamped)"}: \`.claude/channels/${bareAgent}/${e.fileName}\``
        );
        parts.push(
          `Waiting in your channel but NOT from this run (not inlined — read the file yourself if it's ` +
            `relevant to this task):\n${lines.join("\n")}`
        );
      }
    }
  }

  // Independent of everything above: fires whenever the agent type resolves to ANY report
  // (project or global), regardless of whether `result` matched a workflow instance at all. Still
  // one of the five static blocks `040` skips on a resume — it governs the NEW final message the
  // resumed agent is about to write, but that message is already in its history from the first run.
  if (!isResume) {
    const reportPart = collectReportContext(cfg, projectDir, agentType);
    if (reportPart) parts.push(reportPart);
  }

  if (parts.length === 0) process.exit(0);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SubagentStart",
        additionalContext: parts.join("\n\n---\n\n"),
      },
    })
  );
})();
