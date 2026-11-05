// 070 refactor cases: structural-improvement cases on the pinned maestro checkout (3814a30). A case is a
// neighbourhood (touched files plus their graph neighbours, bench/refactor/<id>.scope.txt) of a tree to
// which `refactor.plant` has been applied; the agent proposes refactors, the grader says which expected
// improvement it proposed and counts the rest as false findings.
//
// kind `real`: a real maestro refactor, REVERTED: the plant restores the code as it was before the source
//   commit, so the right proposal is that commit's refactor again. `refactor.source` names the commit.
// kind `seeded`: a structural problem planted on the pinned tree (a helper duplicated across two concepts,
//   pattern drift in one file of a family, a new dependency cycle, an export nothing imports).
// kind `clean`: a neighbourhood with no change and no warranted refactor; every proposal on it is a false
//   finding. The pinned tree is real code, so a clean neighbourhood is only as clean as the author's reading
//   of it (the 066 clean diffs have the same limit); `refactor.tolerated` lists real, pre-existing
//   duplicates that a proposal may name without being scored false.
//
// `refactor.touched`: files the change touched when the case plants nothing (clean). `refactor.extra`: files
// added to the scope by hand: files the source commit also touched or the other concept's copy that the
// import graph does not link to the planted file (a barrel import hides the helper's file), and maestro's
// plugin scripts, which are .cjs and outside the code index. `refactor.expected`: { id, category, file (regex on the path token of a
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

const CANVAS = 'apps/maestro/src/renderer/src/components/workflow-canvas.tsx';
const IPC = 'apps/maestro/src/main/ipc.ts';
const RESUME = 'plugins/maestro/scripts/maestro-resume-target.cjs';
const CHECK = 'plugins/maestro/scripts/maestro-check-runtime.cjs';
const SESSION_LIB = 'plugins/maestro/scripts/lib/maestro-session.cjs';
const TASKS = 'apps/maestro/src/core/tasks.ts';
const EPICS = 'apps/maestro/src/core/epics.ts';
const CHANNELS = 'apps/maestro/src/core/handoff-channels.ts';
const TEXT = 'apps/maestro/src/core/text.ts';

const READ_LOG_LINES = `function readLogLines(p) {
  if (!p) return []; // \`064\`: no session directory resolved — treat it as an empty log.
  let text;
  try {
    text = fs.readFileSync(p, "utf8");
  } catch {
    return [];
  }
  const lines = [];
  for (const raw of text.split("\\n")) {
    if (!raw.trim()) continue;
    try {
      lines.push(JSON.parse(raw));
    } catch {
      // A malformed line is skipped, not fatal — best-effort read of a hook-written log.
    }
  }
  return lines;
}
`;

export const REFACTOR_CASES = [
  {
    ...base,
    id: 'f-r1-canvas-align',
    kind: 'real',
    refactor: {
      source: 'maestro 58eb91f "refactor: move alignMainSession into src/core so it is unit-testable" (an extracted helper): the canvas component carried its own alignMainSession, the saved-positions check and the dagre spacing literals; canvas-layout.ts (a pure module) now owns them',
      plant: [
        { file: CANVAS, from: 'import dagre from "dagre";\nimport {\n  alignMainSession,\n  DAGRE_NODE_BASE_HEIGHT,\n  DAGRE_RANK_SEP,\n  hasSavedPositions,\n} from "../../../core/canvas-layout.js";', to: 'import dagre from "dagre";' },
        { file: CANVAS, from: '  return DAGRE_NODE_BASE_HEIGHT + skills * 30;', to: '  return 60 + skills * 30;' },
        { file: CANVAS, from: 'ranksep: DAGRE_RANK_SEP,', to: 'ranksep: 80,' },
        {
          file: CANVAS,
          from: '\n// ── Helpers: MaestroWorkflowV3 <-> React Flow',
          to: '\n// `main-session` is synthetic and never persisted, so with saved positions it would sit at (0,0)\n// while dagre had put it above the first step. Re-derive the same relation: same x as the first\n// step, one rank (140px) above it.\nfunction alignMainSession(nodes: Node[], edges: Edge[]): Node[] {\n  const entry = edges.find((e) => e.source === "main-session" && e.type === "successEdge");\n  const target = entry && nodes.find((n) => n.id === entry.target);\n  if (!target) return nodes;\n  return nodes.map((n) =>\n    n.id === "main-session" ? { ...n, position: { x: target.position.x, y: target.position.y - 140 } } : n\n  );\n}\n\n// ── Helpers: MaestroWorkflowV3 <-> React Flow',
        },
        { file: CANVAS, from: '    const hasPositions = hasSavedPositions(workflow.nodes);', to: '    const hasPositions = workflow.nodes.length > 0 && workflow.nodes.every((n) => n.position != null);' },
      ],
      expected: [{ id: 'canvas-use-core-align', category: 'extract', file: 'workflow-canvas|canvas-layout', change: ['(alignMainSession|hasSavedPositions|DAGRE_|main-session)', '(canvas-layout|core|pure|existing|already|import|reuse|use the|replace|delete|remove|duplicat)'], desc: 'workflow-canvas.tsx carries its own alignMainSession (with a 140px literal) and an inline saved-positions check, while core/canvas-layout.ts already exports alignMainSession, hasSavedPositions and the dagre spacing constants: import them and delete the local copy' }],
      tolerated: [],
    },
    samples: {
      good: 'PROPOSALS:\n- apps/maestro/src/renderer/src/components/workflow-canvas.tsx: dedupe: the component defines its own `alignMainSession` (and an inline saved-positions check) although `core/canvas-layout.ts` already exports `alignMainSession` and `hasSavedPositions`; import them and delete the local copy.',
      bad: 'PROPOSALS:\n- apps/maestro/src/renderer/src/components/workflow-canvas.tsx: extract-helper: split the 1200-line component into several files.\n- apps/maestro/src/renderer/src/components/workflow-canvas.tsx: align-pattern: rename `dagreNodeHeight` to match the other layout helpers.',
    },
  },
  {
    ...base,
    id: 'f-r2-ipc-core-helpers',
    kind: 'real',
    refactor: {
      source: 'maestro 71569fd "refactor: move session sweep, delete and titles decisions into src/core" (an extracted helper): main/ipc.ts decided the allow-list of project roots and the session titles inline; core/session-ipc.ts now owns composeAllowedRoots and titlesForRefs so they run without Electron',
      extra: ['apps/maestro/src/core/session-ipc.ts'], // ipc.ts reaches it through the core barrel, so it is no direct neighbour
      plant: [
        { file: IPC, from: '  titlesForRefs,\n  composeAllowedRoots,\n', to: '  resolveSessionTitles,\n  sessionTitleKey,\n  dedupeProjectRoots,\n' },
        {
          file: IPC,
          from: '  return composeAllowedRoots(getState());',
          to: '  const state = getState();\n  const roots = state.current\n    ? [state.current.root, ...state.recent.map((r) => r.root)]\n    : state.recent.map((r) => r.root);\n  return dedupeProjectRoots(roots);',
        },
        {
          file: IPC,
          from: '    return titlesForRefs(allowedProjectRoots(), list);',
          to: '    const allowed = new Set(allowedProjectRoots());\n    const asked: Array<{ projectRoot: string; sessionId: string }> = [];\n    const known: Array<{ projectRoot: string; sessionId: string }> = [];\n    if (Array.isArray(list)) {\n      for (const r of list) {\n        if (!r || typeof r.projectRoot !== "string" || typeof r.sessionId !== "string") continue;\n        asked.push(r);\n        if (allowed.has(r.projectRoot)) known.push(r);\n      }\n    }\n    // Every asked-for key is present: refs outside the allow-list resolve to null.\n    const out: Record<string, string | null> = {};\n    for (const r of asked) out[sessionTitleKey(r.projectRoot, r.sessionId)] = null;\n    return Object.assign(out, resolveSessionTitles(known));',
        },
      ],
      expected: [{ id: 'ipc-use-session-ipc', category: 'extract', file: 'main/ipc|session-ipc', change: ['(titlesForRefs|composeAllowedRoots|session-ipc|allowedProjectRoots|sessionsTitles|titles)', '(core|extract|move|helper|unit|test|without electron|existing|already|import|reuse|delegate|inline)'], desc: 'the sessionsTitles handler and allowedProjectRoots in main/ipc.ts decide inline what core/session-ipc.ts already exports as titlesForRefs and composeAllowedRoots: delegate to them (and keep them testable without Electron)' }],
      tolerated: [],
    },
    samples: {
      good: 'PROPOSALS:\n- apps/maestro/src/main/ipc.ts: extract-helper: the `sessionsTitles` handler and `allowedProjectRoots` decide the allow-list and the title lookup inline, but `core/session-ipc.ts` already exports `titlesForRefs` and `composeAllowedRoots`; delegate to them so the logic stays unit-testable without Electron.',
      bad: 'PROPOSALS:\n- apps/maestro/src/main/ipc.ts: align-pattern: `registerIpc` is 800 lines long, split it by channel group.',
    },
  },
  {
    ...base,
    id: 'f-r3-readloglines-copy',
    kind: 'real',
    refactor: {
      source: 'maestro 05d5b76 "refactor: apply task 087 review cleanups" (a deduplication): readLogLines is exported once from the session lib and the four hook and CLI scripts that each carried a copy now require it; this case restores the copy in maestro-resume-target.cjs',
      extra: [SESSION_LIB, 'apps/maestro/src/core/session-runtime.ts'],
      plant: [
        { file: RESUME, from: 'const path = require("path");\nconst {\n  readJson,\n  readLogLines,\n  readSession,', to: 'const fs = require("fs");\nconst path = require("path");\nconst {\n  readJson,\n  readSession,' },
        { file: RESUME, from: '} = require("./lib/maestro-session.cjs");\n\n// The global handoff tier,', to: `} = require("./lib/maestro-session.cjs");\n\n${READ_LOG_LINES}\n// The global handoff tier,` },
      ],
      expected: [{ id: 'resume-target-readloglines', category: 'dedupe', file: 'maestro-resume-target|maestro-session', change: ['readLogLines', '(lib|maestro-session|shared|exported|already|duplicat|copy|require|import|reuse|remove|delete|session-runtime)'], desc: 'maestro-resume-target.cjs defines its own readLogLines, a copy of the one the session lib already exports: require it from lib/maestro-session.cjs and delete the local function' }],
      tolerated: [],
    },
    samples: {
      good: 'PROPOSALS:\n- plugins/maestro/scripts/maestro-resume-target.cjs: dedupe: it defines its own `readLogLines`, a copy of the helper `lib/maestro-session.cjs` already exports; require that one and delete the local function and the now-unused `fs` import.',
      bad: 'PROPOSALS:\n- plugins/maestro/scripts/maestro-resume-target.cjs: extract-helper: the 120-line header comment should move to a doc file.',
    },
  },
  {
    ...base,
    id: 'f-r4-stale-rule-inline',
    kind: 'real',
    refactor: {
      source: 'maestro 05d5b76 "refactor: apply task 087 review cleanups" (an aligned pattern): maestro-check-runtime.cjs called runtimeNeedsRefresh instead of repeating its rule inline (the app and the other scripts already decide staleness through it); this case restores the inline rule',
      extra: [SESSION_LIB, 'apps/maestro/src/core/runtime-version.ts'],
      plant: [
        { file: CHECK, from: '  const { verdict, stale } = versionVerdict(config.runtimeVersion, match.version);', to: '  const verdict = versionVerdict(config.runtimeVersion, match.version);\n  const stale = verdict === "older" || (verdict === "unknown" && config.runtimeVersion !== match.version);' },
        {
          file: CHECK,
          from: '// `compareRuntimeVersions` and `runtimeNeedsRefresh` live in the generated session lib\n// (apps/maestro/src/core/runtime-version.ts, shared with the app\'s refreshStaleRuntime so both\n// reach the same verdict). Required lazily and defensively: a copy whose lib predates them answers\n// "unknown", stale on any difference — the old equality check.\nfunction versionVerdict(projectVersion, pluginVersion) {\n  try {\n    const { compareRuntimeVersions, runtimeNeedsRefresh } = require("./lib/maestro-session.cjs");\n    if (typeof compareRuntimeVersions === "function" && typeof runtimeNeedsRefresh === "function") {\n      return {\n        verdict: compareRuntimeVersions(projectVersion, pluginVersion),\n        stale: runtimeNeedsRefresh(projectVersion, pluginVersion),\n      };\n    }\n  } catch {\n    /* fall through */\n  }\n  return { verdict: "unknown", stale: projectVersion !== pluginVersion };\n}',
          to: '// `compareRuntimeVersions` lives in the generated session lib (apps/maestro/src/core/runtime-version.ts,\n// shared with the app\'s refreshStaleRuntime so both reach the same verdict). Required lazily and\n// defensively: a copy whose lib predates it answers "unknown", which is the old equality check.\nfunction versionVerdict(projectVersion, pluginVersion) {\n  try {\n    const { compareRuntimeVersions } = require("./lib/maestro-session.cjs");\n    if (typeof compareRuntimeVersions === "function") return compareRuntimeVersions(projectVersion, pluginVersion);\n  } catch {\n    /* fall through */\n  }\n  return "unknown";\n}',
        },
      ],
      expected: [{ id: 'check-runtime-needs-refresh', category: 'align', file: 'maestro-check-runtime|maestro-session|runtime-version', change: ['(runtimeNeedsRefresh|stale)', '(inline|repeat|duplicat|same rule|reuse|use|call|already|lib|session lib|shared|app|align|consistent)'], desc: 'maestro-check-runtime.cjs recomputes the staleness rule inline (older, or unknown and different) although the session lib exports runtimeNeedsRefresh, the one rule the app uses: call it' }],
      tolerated: [],
    },
    samples: {
      good: 'PROPOSALS:\n- plugins/maestro/scripts/maestro-check-runtime.cjs: align-pattern: `checkRuntime` repeats the staleness rule inline (`older`, or `unknown` and different) although the session lib exports `runtimeNeedsRefresh`, the rule the app uses; call it so both reach the same verdict.',
      bad: 'PROPOSALS:\n- plugins/maestro/scripts/maestro-check-runtime.cjs: remove-unused: the `INSTRUCTIONS` export is never imported.',
    },
  },
  {
    ...base,
    id: 'f-s1-dup-readjson',
    kind: 'seeded',
    refactor: {
      source: 'seeded: tasks.ts (task-queue) gets a private copy of session-runtime.ts readJson (maestro-architecture), the helper-duplicated-across-two-concepts class; the pinned tree already has older copies in detect.ts, marketplaces.ts and config.ts, which are tolerated',
      extra: ['apps/maestro/src/core/session-runtime.ts'], // the other concept's copy, not an import neighbour of tasks.ts
      plant: [{
        file: TASKS,
        from: 'function readStatusMap(dir: string): StatusMap {\n  try {\n    const data: unknown = JSON.parse(fs.readFileSync(path.join(dir, STATUS_FILE), "utf8"));\n    return data && typeof data === "object" ? (data as StatusMap) : {};\n  } catch {\n    return {};\n  }\n}',
        to: '/** Reads a JSON file; null when it is missing or not valid JSON. */\nfunction readJsonOrNull<T>(p: string): T | null {\n  try {\n    return JSON.parse(fs.readFileSync(p, "utf8")) as T;\n  } catch {\n    return null;\n  }\n}\n\nfunction readStatusMap(dir: string): StatusMap {\n  const data = readJsonOrNull<unknown>(path.join(dir, STATUS_FILE));\n  return data && typeof data === "object" ? (data as StatusMap) : {};\n}',
      }],
      expected: [{ id: 'tasks-dup-readjson', category: 'dedupe', file: 'tasks\\.ts|session-runtime', change: ['(readJson|readJsonOrNull)', '(duplicat|copy|identical|same|already|session-runtime|share|reuse|import|exists)'], desc: 'tasks.ts (task-queue) defines readJsonOrNull, the same read-or-null helper session-runtime.ts (maestro-architecture) exports as readJson: import the shared one' }],
      tolerated: [{ file: 'detect|marketplaces|config\\.ts|session-runtime', change: ['readJson'] }],
    },
    samples: {
      good: 'PROPOSALS:\n- apps/maestro/src/core/tasks.ts: dedupe: the new `readJsonOrNull` is the same read-or-null helper `session-runtime.ts` already exports as `readJson`; import that one instead of keeping a copy in another concept.\n- apps/maestro/src/core/detect.ts: dedupe: it also has its own `readJson`, the same helper again.',
      bad: 'PROPOSALS:\n- apps/maestro/src/core/tasks.ts: extract-helper: `tasksFromFiles` is long and should be split in two.',
    },
  },
  {
    ...base,
    id: 'f-s2-drift-epic-write',
    kind: 'seeded',
    refactor: {
      source: 'seeded: writeEpicState in epics.ts stops writing through a temp file and a rename, while the sibling stores (writeStatusMap in tasks.ts, writeSession, the meeting state) all write atomically; pattern drift in one file of a family',
      plant: [{
        file: EPICS,
        from: '  const tmp = `${target}.${process.pid}.tmp`;\n  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\\n`);\n  fs.renameSync(tmp, target);',
        to: '  fs.writeFileSync(target, `${JSON.stringify(state, null, 2)}\\n`);',
      }],
      expected: [{ id: 'epics-nonatomic-write', category: 'align', file: 'epics', change: ['(atomic|tmp|temp file|rename|writeFileSync|write)', '(tasks\\.ts|writeStatusMap|writeSession|sibling|other (stores|writers|modules)|pattern|consisten|align|drift|elsewhere|unlike|match|same)'], desc: 'writeEpicState writes the state file in place, unlike its siblings (writeStatusMap in tasks.ts and the other JSON stores), which write a temp file and rename it: restore the atomic write' }],
      tolerated: [],
    },
    samples: {
      good: 'PROPOSALS:\n- apps/maestro/src/core/epics.ts: align-pattern: `writeEpicState` writes the state in place with `writeFileSync`, unlike `writeStatusMap` in tasks.ts and the other stores, which write a temp file and rename it; use the same atomic write.',
      bad: 'PROPOSALS:\n- apps/maestro/src/core/epics.ts: extract-helper: the epic log entry types should be moved to contracts.ts.',
    },
  },
  {
    ...base,
    id: 'f-s3-cycle-claims-channels',
    kind: 'seeded',
    refactor: {
      source: 'seeded: handoff-channels.ts imports claims.ts, while claims.ts already imports CLAIM_IDLE_CAP_MS from handoff-channels.ts: a new two-module import cycle across the task-queue and maestro-architecture concepts',
      plant: [
        { file: CHANNELS, from: 'import type { PendingLane } from "./contracts.js";', to: 'import type { PendingLane } from "./contracts.js";\nimport { claimPathFor } from "./claims.js";' },
        {
          file: CHANNELS,
          from: 'const SCRIBE_LANE = "scribe";',
          to: 'const SCRIBE_LANE = "scribe";\n\n/** Where the claim for a task file lives, so a lane listing can show who holds it. */\nexport function claimFileForTask(projectDir: string, filename: string): string {\n  return claimPathFor(path.join(projectDir, ".claude", "maestro-tasks"), filename);\n}',
        },
      ],
      expected: [{ id: 'claims-channels-cycle', category: 'cycle', file: 'handoff-channels|claims', change: ['(cycl|circular|mutual|each other|both (import|depend)|back-?edge|import loop)', '(claims|handoff-channels)'], desc: 'handoff-channels.ts and claims.ts now import each other (claims.ts takes CLAIM_IDLE_CAP_MS from handoff-channels.ts): break the cycle, e.g. by moving the constant or the claim path helper to a leaf module' }],
      tolerated: [{ file: 'handoff-channels', change: ['(unused|never used|not used|nothing imports|no (caller|consumer|importer))'] }],
    },
    samples: {
      good: 'PROPOSALS:\n- apps/maestro/src/core/handoff-channels.ts: break-cycle: it now imports `claims.ts` while `claims.ts` imports `CLAIM_IDLE_CAP_MS` from it, so the two modules form an import cycle; move the constant to a leaf module.',
      bad: 'PROPOSALS:\n- apps/maestro/src/core/handoff-channels.ts: extract-helper: split the channel listing into its own module.',
    },
  },
  {
    ...base,
    id: 'f-s4-unused-export-pluralize',
    kind: 'seeded',
    refactor: {
      source: 'seeded: text.ts (the shared string helpers) gets an exported pluralize that no file imports',
      plant: [{
        file: TEXT,
        from: 'export function joinOxford(items: string[]): string {\n  if (items.length === 0) return "";\n  if (items.length === 1) return items[0];\n  return items.slice(0, -1).join(", ") + " or " + items.slice(-1)[0];\n}',
        to: 'export function joinOxford(items: string[]): string {\n  if (items.length === 0) return "";\n  if (items.length === 1) return items[0];\n  return items.slice(0, -1).join(", ") + " or " + items.slice(-1)[0];\n}\n\n/** "1 task", "2 tasks". */\nexport function pluralize(count: number, noun: string): string {\n  return `${count} ${noun}${count === 1 ? "" : "s"}`;\n}',
      }],
      expected: [{ id: 'text-unused-pluralize', category: 'unused', file: 'text\\.ts', change: ['pluralize', '(unused|never (used|imported|called)|no (caller|importer|consumer|import)|nothing (imports|uses|calls)|dead|not (used|imported|referenced)|remove|delete)'], desc: 'text.ts exports pluralize and no file imports it (neither core/index.ts nor the renderer re-export): remove it' }],
      tolerated: [],
    },
    samples: {
      good: 'PROPOSALS:\n- apps/maestro/src/core/text.ts: remove-unused: `pluralize` is exported but no file imports it (core/index.ts does not re-export it either); delete it.',
      bad: 'PROPOSALS:\n- apps/maestro/src/core/text.ts: dedupe: `firstSentence` and `clip` overlap, merge them.',
    },
  },
  {
    ...base,
    id: 'f-c1-canvas-layout',
    kind: 'clean',
    refactor: {
      source: 'control for f-r1: the tree as it is, where workflow-canvas.tsx already imports canvas-layout.ts',
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
      source: 'control for f-r2: the tree as it is, where main/ipc.ts already delegates to session-ipc.ts',
      touched: ['apps/maestro/src/core/session-ipc.ts'],
      plant: [],
      expected: [],
      tolerated: [],
    },
    samples: {
      good: 'PROPOSALS: none',
      bad: 'PROPOSALS:\n- apps/maestro/src/core/session-ipc.ts: dedupe: `sweepAndRetarget` and `deleteAndRetarget` share a retarget pattern, merge them.',
    },
  },
  {
    ...base,
    id: 'f-c3-handoff-label',
    kind: 'clean',
    refactor: {
      source: 'a small, single-purpose module (handoff-label.ts) added in ec72705 and left as is',
      touched: ['apps/maestro/src/core/handoff-label.ts'],
      plant: [],
      expected: [],
      tolerated: [],
    },
    samples: {
      good: 'Nothing to change: one purpose, no duplicate, no cycle.\n\nPROPOSALS: none',
      bad: 'PROPOSALS:\n- apps/maestro/src/core/handoff-label.ts: extract-helper: the label parsing could be its own module.',
    },
  },
];

export const refactorCaseById = (id) => REFACTOR_CASES.find((c) => c.id === id);
// `only` is one substring or a comma-separated list of them; a case matches when its id contains any.
export const selectRefactorCases = (only = '') => {
  const keys = String(only).split(',').map((k) => k.trim()).filter(Boolean);
  return REFACTOR_CASES.filter((c) => !keys.length || keys.some((k) => c.id.includes(k)));
};
