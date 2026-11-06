// 070 refactor cases: structural-improvement cases on the pinned maestro checkout (3814a30). A case is a
// neighbourhood (touched files plus their graph neighbours, bench/refactor/<id>.scope.txt) of a tree to
// which `refactor.plant` has been applied; the agent proposes refactors, the grader says which expected
// improvement it proposed and counts the rest as false findings.
//
// POST-PILOT REWORK (docs/evals.md, "Ticket 070 post-pilot amendment"). The first set (f-r1..f-r4, f-s1..f-s4,
// f-c1..f-c3) was saturated by the baseline in pilot (a): 8 of 8 expected improvements found. It is retired
// except for the clean controls f-c1 and f-c2. The new set is harder by construction, chosen BEFORE reading
// any answer of the pilot: a whole reverted commit across several files instead of one copied function, a
// near-duplicate of a helper that lives in a third file under another name (the canonical copy is not in the
// planted file), and a three-module import cycle with no direct pair. Cases were not tuned to make the
// baseline fail; they were picked for their ground truth.
//
// kind `real`: a real maestro refactor, REVERTED: the plant restores the code as it was before the source
//   commit, so the right proposals are that commit's refactors again. `refactor.source` names the commit.
// kind `seeded`: a structural problem planted on the pinned tree (a helper re-implemented under other
//   names in two files, a new three-module dependency cycle).
// kind `clean`: a neighbourhood with no change and no warranted refactor; every proposal on it is a false
//   finding. The pinned tree is real code, so a clean neighbourhood is only as clean as the author's reading
//   of it (the 066 clean diffs have the same limit); `refactor.tolerated` lists real, pre-existing
//   duplicates that a proposal may name without being scored false.
//
// `refactor.touched`: files the change touched when the case plants nothing (clean). `refactor.extra`: files
// added to the scope by hand: files the source commit also touched or the canonical copy that the
// import graph does not link to the planted file, and maestro's plugin scripts, which are .cjs/.js and outside
// the code index. `refactor.expected`: { id, category, file (regex on the path token of a
// proposal), change: [regex, ...] (every one must match the proposal) }. `samples.good` / `samples.bad` are
// outputs the unit tests grade (good must be fully credited with no false finding, bad must score nothing).
//
// No real removed-cycle refactor exists in the pinned history (3814a30 and its ancestors: a search of the
// commit messages and diffs found none), so the cycle category is covered by a seeded case only.
const base = {
  group: 'maestro@3814a30',
  sets: ['070'],
  setup: 'bash {REPO}/bench/maestro-setup.sh {REPO} {MAESTRO} 3814a30 {ARM}',
  skills: ['task-queue', 'installing-maestro', 'updating-maestro', 'maestro-architecture'],
};

const INJECT = 'plugins/maestro/scripts/maestro-inject-agent-context.js';
const SUBAGENT_LOG = 'plugins/maestro/scripts/maestro-subagent-log.js';
const TEAM_MEETING = 'plugins/maestro/scripts/maestro-team-meeting.cjs';
const RESUME = 'plugins/maestro/scripts/maestro-resume-target.cjs';
const CHECK = 'plugins/maestro/scripts/maestro-check-runtime.cjs';
const SESSION_LIB = 'plugins/maestro/scripts/lib/maestro-session.cjs';
const EPICS = 'apps/maestro/src/core/epics.ts';
const SESSION_TITLE = 'apps/maestro/src/core/session-title.ts';
const SESSION_PATHS = 'apps/maestro/src/core/session-paths.ts';

// The four copies of readLogLines that maestro 05d5b76 removed (each script carried its own; they differ in
// the null guard and in the comments, as the originals did).
const readLogLinesCopy = (param, { guard, comment }) => `function readLogLines(${param}) {
${guard ? `  if (!${param}) return []; // \`064\`: no session directory resolved — treat it as an empty log.\n` : ''}  let text;
  try {
    text = fs.readFileSync(${param}, "utf8");
  } catch {
    return [];
  }
  const lines = [];
  for (const raw of text.split("\\n")) {
    if (!raw.trim()) continue;
    try {
      lines.push(JSON.parse(raw));
    } catch {
      // ${comment}
    }
  }
  return lines;
}
`;

const INJECT_COPY = `// The resume signal (\`040\`): a \`kind:"handoff"\` entry already logged for this \`agent_id\`, read
// straight off disk — best-effort, exactly like maestro-resume-target.cjs's own copy of this same
// tiny reader. A missing or unreadable log comes back \`[]\`, which \`hasCompletedRun\` answers
// \`false\` for, so the safe fall-through is a first run's full injection.
${readLogLinesCopy('p', { guard: true, comment: 'A malformed line is skipped, not fatal — best-effort read of a hook-written log.' })}`;

// The payload block of maestro-inject-agent-context.js as 05d5b76 found it: payloadRoutes and
// payloadRequirement called once in the first-run branch and again in a second, resumed-run branch.
const PAYLOAD_FROM = `    );
  }

  // Per-route payload protocol, resolved across the three tiers above so the communication
  // contract is owned here rather than duplicated in the agent files. Only emitted for routes
  // whose pair resolves to something — a wired route with no template anywhere (\`scribe ->
  // reviewer\`) is silently skipped, exactly as the install-time sync skips it.
  //
  // \`036\`: the payload no longer rides in the final-message JSON. Each route names the CHANNEL
  // FILE to write it to instead — \`.claude/channels/<receiver>/<sender>.1.md\` — which the
  // receiving agent's own SubagentStart delivers on its next invocation. The orchestrator never
  // sees the content at all.
  //
  // \`087\`: the write is a REQUIRED step before the HANDOFF line (the SubagentStop hook flags a
  // route whose payload was not written this run as \`missing_payload\`). A RESUMED run gets the
  // requirement too, without the shapes: \`040\` drops the routing block above on a resume, and that
  // is how task 086's second @reviewer pass ended without writing its payload — the one
  // instruction that governs the NEW hand-back must not be static.
  if (!offWorkflow && result && result.routes.length > 0) {
    const routes = payloadRoutes(projectDir, result.routes, readGlobalHandoff);
    const required = payloadRequirement(routes, { withShapes: !isResume });
    if (required) parts.push(required);
  }
`;
const PAYLOAD_TO = `    );

    // Per-route payload protocol, resolved across the three tiers above so the communication
    // contract is owned here rather than duplicated in the agent files. Only emitted for routes
    // whose pair resolves to something — a wired route with no template anywhere (\`scribe ->
    // reviewer\`) is silently skipped, exactly as the install-time sync skips it.
    //
    // \`036\`: the payload no longer rides in the final-message JSON. Each route names the CHANNEL
    // FILE to write it to instead — \`.claude/channels/<receiver>/<sender>.1.md\` — which the
    // receiving agent's own SubagentStart delivers on its next invocation. The orchestrator never
    // sees the content at all.
    //
    // \`087\`: the write is a REQUIRED step before the HANDOFF line (the SubagentStop hook flags a
    // route whose payload was not written this run as \`missing_payload\`), and the wording comes
    // from \`payloadRequirement\`, the same helper the resume branch below uses.
    const required = payloadRequirement(payloadRoutes(projectDir, result.routes, readGlobalHandoff), { withShapes: true });
    if (required) parts.push(required);
  }

  // \`087\`: a RESUMED run gets the requirement too, without the shapes. \`040\` drops the routing and
  // protocol blocks on a resume, and that is how task 086's second @reviewer pass ended without
  // writing its payload — the one instruction that governs the NEW hand-back must not be static.
  if (!offWorkflow && isResume && result && result.routes.length > 0) {
    const required = payloadRequirement(payloadRoutes(projectDir, result.routes, readGlobalHandoff), { withShapes: false });
    if (required) parts.push(required);
  }
`;

export const REFACTOR_CASES = [
  {
    ...base,
    id: 'f-r5-plugin-scripts-05d5b76',
    kind: 'real',
    refactor: {
      source: 'maestro 05d5b76 "refactor: apply task 087 review cleanups" (a deduplication, a merged branch and an aligned pattern in five plugin scripts), reverted whole except the version bump and the mirrors: four hook and CLI scripts carry their own readLogLines again, maestro-inject-agent-context.js resolves payloadRoutes twice again, and maestro-check-runtime.cjs repeats the staleness rule inline again',
      extra: [SESSION_LIB, 'apps/maestro/src/core/session-runtime.ts', 'apps/maestro/src/core/runtime-version.ts'],
      plant: [
        { file: INJECT, from: '  isRootSkillPath,\n  readLogLines,\n} = require("./lib/maestro-session.cjs");\n\n// ── nested-skill fallback', to: `  isRootSkillPath,\n} = require("./lib/maestro-session.cjs");\n\n${INJECT_COPY}\n// ── nested-skill fallback` },
        { file: INJECT, from: PAYLOAD_FROM, to: PAYLOAD_TO },
        { file: SUBAGENT_LOG, from: '  ownerRunLeftovers,\n  readLogLines,\n  retireResumeDeliveries,', to: '  ownerRunLeftovers,\n  retireResumeDeliveries,' },
        { file: SUBAGENT_LOG, from: '// `108`: this agent\'s routes in the workflow the orchestrator recorded', to: `${readLogLinesCopy('p', { guard: false, comment: 'A malformed line is skipped.' })}\n// \`108\`: this agent's routes in the workflow the orchestrator recorded` },
        { file: TEAM_MEETING, from: '  renderMetricsDigest,\n  readLogLines,\n} = require("./lib/maestro-session.cjs");', to: '  renderMetricsDigest,\n} = require("./lib/maestro-session.cjs");' },
        { file: TEAM_MEETING, from: 'function readText(file) {', to: `${readLogLinesCopy('file', { guard: false, comment: 'tolerate a partial line' })}\nfunction readText(file) {` },
        { file: RESUME, from: 'const path = require("path");\nconst {\n  readJson,\n  readLogLines,\n  readSession,', to: 'const fs = require("fs");\nconst path = require("path");\nconst {\n  readJson,\n  readSession,' },
        { file: RESUME, from: '} = require("./lib/maestro-session.cjs");\n\n// The global handoff tier,', to: `} = require("./lib/maestro-session.cjs");\n\n${readLogLinesCopy('p', { guard: true, comment: 'A malformed line is skipped, not fatal — best-effort read of a hook-written log.' })}\n// The global handoff tier,` },
        { file: CHECK, from: '  const { verdict, stale } = versionVerdict(config.runtimeVersion, match.version);', to: '  const verdict = versionVerdict(config.runtimeVersion, match.version);\n  const stale = verdict === "older" || (verdict === "unknown" && config.runtimeVersion !== match.version);' },
        {
          file: CHECK,
          from: '// `compareRuntimeVersions` and `runtimeNeedsRefresh` live in the generated session lib\n// (apps/maestro/src/core/runtime-version.ts, shared with the app\'s refreshStaleRuntime so both\n// reach the same verdict). Required lazily and defensively: a copy whose lib predates them answers\n// "unknown", stale on any difference — the old equality check.\nfunction versionVerdict(projectVersion, pluginVersion) {\n  try {\n    const { compareRuntimeVersions, runtimeNeedsRefresh } = require("./lib/maestro-session.cjs");\n    if (typeof compareRuntimeVersions === "function" && typeof runtimeNeedsRefresh === "function") {\n      return {\n        verdict: compareRuntimeVersions(projectVersion, pluginVersion),\n        stale: runtimeNeedsRefresh(projectVersion, pluginVersion),\n      };\n    }\n  } catch {\n    /* fall through */\n  }\n  return { verdict: "unknown", stale: projectVersion !== pluginVersion };\n}',
          to: '// `compareRuntimeVersions` lives in the generated session lib (apps/maestro/src/core/runtime-version.ts,\n// shared with the app\'s refreshStaleRuntime so both reach the same verdict). Required lazily and\n// defensively: a copy whose lib predates it answers "unknown", which is the old equality check.\nfunction versionVerdict(projectVersion, pluginVersion) {\n  try {\n    const { compareRuntimeVersions } = require("./lib/maestro-session.cjs");\n    if (typeof compareRuntimeVersions === "function") return compareRuntimeVersions(projectVersion, pluginVersion);\n  } catch {\n    /* fall through */\n  }\n  return "unknown";\n}',
        },
      ],
      expected: [
        { id: 'plugin-readloglines-copies', category: 'dedupe', file: 'maestro-inject-agent-context|maestro-subagent-log|maestro-team-meeting|maestro-resume-target|maestro-session', change: ['readLogLines', '(lib|maestro-session|shared|exported|already|duplicat|cop(y|ies)|require|import|reuse|remove|delete|session-runtime)'], desc: 'four plugin scripts (inject-agent-context, subagent-log, team-meeting, resume-target) each define their own readLogLines, copies of the one lib/maestro-session.cjs already exports: require it and delete the local functions' },
        { id: 'inject-payload-routes-twice', category: 'dedupe', file: 'maestro-inject-agent-context', change: ['(payloadRoutes|payloadRequirement)', '(twice|two (places|calls|branches|blocks|ifs?)|both|duplicat|repeat|once|merge|combin|collaps|single|unif|consolidat)'], desc: 'maestro-inject-agent-context.js resolves payloadRoutes and calls payloadRequirement twice, once for the first run and once for the resumed run: resolve the routes once and pass withShapes: !isResume' },
        { id: 'check-runtime-needs-refresh', category: 'align', file: 'maestro-check-runtime|maestro-session|runtime-version', change: ['(runtimeNeedsRefresh|stale)', '(inline|repeat|duplicat|same rule|reuse|use|call|already|lib|session lib|shared|app|align|consistent)'], desc: 'maestro-check-runtime.cjs recomputes the staleness rule inline (older, or unknown and different) although the session lib exports runtimeNeedsRefresh, the one rule the app uses: call it' },
      ],
      tolerated: [],
    },
    samples: {
      good: 'PROPOSALS:\n- plugins/maestro/scripts/maestro-subagent-log.js: dedupe: `maestro-inject-agent-context.js`, `maestro-subagent-log.js`, `maestro-team-meeting.cjs` and `maestro-resume-target.cjs` each define their own `readLogLines`, copies of the one `lib/maestro-session.cjs` already exports; require it and delete the local functions.\n- plugins/maestro/scripts/maestro-inject-agent-context.js: dedupe: `payloadRoutes` and `payloadRequirement` are called twice, in the first-run branch and again in the resumed-run branch; resolve the routes once and pass `withShapes: !isResume`.\n- plugins/maestro/scripts/maestro-check-runtime.cjs: align-pattern: `checkRuntime` repeats the staleness rule inline although the session lib exports `runtimeNeedsRefresh`, the rule the app uses; call it so both reach the same verdict.',
      bad: 'PROPOSALS:\n- plugins/maestro/scripts/maestro-inject-agent-context.js: extract-helper: the 400-line main function should be split into one function per injected block.\n- plugins/maestro/scripts/maestro-team-meeting.cjs: remove-unused: the `listDir` helper is never called.',
    },
  },
  {
    ...base,
    id: 'f-s5-titlecase-copies',
    kind: 'seeded',
    refactor: {
      source: 'seeded: epics.ts (task-queue) and session-title.ts (claude-session-bridge) each get a private helper that title-cases a dash-separated name (epicTitle, prettyTaskName), re-implementing titleFromName of text.ts (which neither file imports) under other names and with different code; the canonical copy is in a third file. The pinned tree already pairs taskHeading (session-title.ts) with parseTitle (tasks.ts), which is tolerated',
      extra: ['apps/maestro/src/core/text.ts'], // neither planted file imports it, so the import graph does not link it
      plant: [
        {
          file: EPICS,
          from: '/** Create the epic directory, its EPIC.md and state.json. Refuses an existing epic or a bad slug. */',
          to: '/** "haiku-subagents" -> "Haiku Subagents", for the EPIC.md heading. */\nfunction epicTitle(slug: string): string {\n  return slug\n    .split("-")\n    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))\n    .join(" ");\n}\n\n/** Create the epic directory, its EPIC.md and state.json. Refuses an existing epic or a bad slug. */',
        },
        { file: EPICS, from: '`# Epic: ${slug}\\n\\n## Goal', to: '`# Epic: ${epicTitle(slug)}\\n\\n## Goal' },
        {
          file: SESSION_TITLE,
          from: '/** First `# ` heading of a task file\'s text, else null. */',
          to: '/** "087-fix-the-thing.md" -> "087 Fix The Thing", the title shown for a task file with no heading. */\nfunction prettyTaskName(filename: string): string {\n  return filename\n    .replace(/\\.md$/, "")\n    .split("-")\n    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))\n    .join(" ");\n}\n\n/** First `# ` heading of a task file\'s text, else null. */',
        },
        { file: SESSION_TITLE, from: '    return clean(filename);', to: '    return clean(prettyTaskName(filename));' },
      ],
      expected: [{ id: 'titlecase-reimplemented', category: 'dedupe', file: 'epics\\.ts|session-title|text\\.ts', change: ['(epicTitle|prettyTaskName)', '(titleFromName|text\\.ts)'], desc: 'epicTitle (epics.ts) and prettyTaskName (session-title.ts) are each a private re-implementation of titleFromName in text.ts, the shared title-casing helper: import that one instead' }],
      tolerated: [{ file: 'session-title|tasks\\.ts', change: ['(taskHeading|parseTitle)'] }],
    },
    samples: {
      good: 'PROPOSALS:\n- apps/maestro/src/core/epics.ts: dedupe: `epicTitle` (and `prettyTaskName` in session-title.ts) re-implements `titleFromName` from text.ts, which already title-cases a dash-separated name; import the shared helper in both files.',
      bad: 'PROPOSALS:\n- apps/maestro/src/core/epics.ts: extract-helper: split `createEpic` into one function per file it writes.',
    },
  },
  {
    ...base,
    id: 'f-s6-cycle-tasks-session-paths',
    kind: 'seeded',
    refactor: {
      source: 'seeded: session-paths.ts (a leaf that tasks.ts reaches through claims.ts) imports tasks.ts, while tasks.ts imports claims.ts and claims.ts imports session-paths.ts: a three-module import cycle with no pair of modules importing each other directly; the new wrapper sessionTasksDir has no caller and is tolerated',
      plant: [
        { file: SESSION_PATHS, from: 'import type { WorktreePointer } from "./worktree.js";', to: 'import type { WorktreePointer } from "./worktree.js";\nimport { tasksDirFor } from "./tasks.js";' },
        {
          file: SESSION_PATHS,
          from: '/** Validated, never sanitised — see the header. */\nexport function isValidSessionId(id: unknown): id is string {\n  return typeof id === "string" && SESSION_ID_RE.test(id);\n}',
          to: '/** Validated, never sanitised — see the header. */\nexport function isValidSessionId(id: unknown): id is string {\n  return typeof id === "string" && SESSION_ID_RE.test(id);\n}\n\n/** The task queue directory next to a session\'s own directory, so a session listing can show its queue. */\nexport function sessionTasksDir(projectRoot: string): string {\n  return tasksDirFor(projectRoot);\n}',
        },
      ],
      expected: [{ id: 'paths-tasks-claims-cycle', category: 'cycle', file: 'session-paths|tasks\\.ts|claims', change: ['(cycl|circular|import loop|back-?edge|depends? on each other|mutual)', 'session-paths', '(tasks|claims)'], desc: 'session-paths.ts now imports tasks.ts, which imports claims.ts, which imports session-paths.ts: a three-module import cycle; break it, e.g. by not importing tasks.ts from the leaf session-paths.ts' }],
      tolerated: [{ file: 'session-paths', change: ['(sessionTasksDir)', '(unused|never used|not used|nothing imports|no (caller|consumer|importer)|dead)'] }],
    },
    samples: {
      good: 'PROPOSALS:\n- apps/maestro/src/core/session-paths.ts: break-cycle: it imports `tasks.ts`, which imports `claims.ts`, which imports `session-paths.ts`, so the three modules form an import cycle; drop the import from the leaf `session-paths.ts`.\n- apps/maestro/src/core/session-paths.ts: remove-unused: `sessionTasksDir` has no caller.',
      bad: 'PROPOSALS:\n- apps/maestro/src/core/claims.ts: extract-helper: split `claimTask` into smaller functions.',
    },
  },
  {
    ...base,
    id: 'f-c1-canvas-layout',
    kind: 'clean',
    refactor: {
      source: 'a clean control: the tree as it is, where workflow-canvas.tsx already imports canvas-layout.ts (retained from the first set, which its pilot run exercised)',
      touched: ['apps/maestro/src/core/canvas-layout.ts'],
      plant: [],
      expected: [],
      tolerated: [],
    },
    samples: {
      good: 'The helpers are pure, imported by the canvas and not duplicated.\n\nPROPOSALS: none',
      bad: 'PROPOSALS:\n- apps/maestro/src/core/canvas-layout.ts: extract-helper: the constants should move to their own file.\n- apps/maestro/src/core/canvas-layout.ts: align-pattern: rename `PlacedNode` to `LayoutNode`.',
    },
  },
  {
    ...base,
    id: 'f-c2-session-ipc',
    kind: 'clean',
    refactor: {
      source: 'a clean control: the tree as it is, where main/ipc.ts already delegates to session-ipc.ts (retained from the first set; not run in pilot (a)). taskHeading in session-title.ts and parseTitle in tasks.ts are a real pre-existing pair, tolerated',
      touched: ['apps/maestro/src/core/session-ipc.ts'],
      plant: [],
      expected: [],
      tolerated: [{ file: 'session-title|tasks\\.ts', change: ['(taskHeading|parseTitle)'] }],
    },
    samples: {
      good: 'PROPOSALS: none',
      bad: 'PROPOSALS:\n- apps/maestro/src/core/session-ipc.ts: dedupe: `sweepAndRetarget` and `deleteAndRetarget` share a retarget pattern, merge them.',
    },
  },
  {
    ...base,
    id: 'f-c4-plugin-scripts',
    kind: 'clean',
    refactor: {
      source: 'a clean control for f-r5: the same five plugin scripts and the session lib as they are in the pinned tree (after 05d5b76), a larger neighbourhood with no change',
      touched: [INJECT, SUBAGENT_LOG, TEAM_MEETING, RESUME, CHECK],
      extra: [SESSION_LIB],
      plant: [],
      expected: [],
      tolerated: [],
    },
    samples: {
      good: 'The scripts require readLogLines and runtimeNeedsRefresh from the lib.\n\nPROPOSALS: none',
      bad: 'PROPOSALS:\n- plugins/maestro/scripts/maestro-team-meeting.cjs: extract-helper: the command dispatch should move to its own module.',
    },
  },
];

export const refactorCaseById = (id) => REFACTOR_CASES.find((c) => c.id === id);
// `only` is one substring or a comma-separated list of them; a case matches when its id contains any.
export const selectRefactorCases = (only = '') => {
  const keys = String(only).split(',').map((k) => k.trim()).filter(Boolean);
  return REFACTOR_CASES.filter((c) => !keys.length || keys.some((k) => c.id.includes(k)));
};
