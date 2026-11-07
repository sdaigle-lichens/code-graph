// 066 review cases: planted changes on the pinned maestro checkout (3814a30), each a diff the reviewer
// arms judge. `review.plant` is applied to the no-graph workspace before the run; the diff the reviewer
// sees is computed from it (bench/review/<id>.diff, stored by review-prep.mjs). `review.bugs` are the
// planted defects with their graders (finding must match `file` and every `defect` regex). A case with no
// bugs is a clean diff: any finding on it is a false alarm. `samples.good` / `samples.bad` are review
// texts the unit tests grade (good must be fully credited, bad must score nothing).
//
// 068 hardening (after pilot A saturated): a cross case breaks only outside the diff (a sibling module, a
// self-contained twin script, a caller two hops away); a local case is a boundary, ordering or default
// mistake rather than a change that reads wrong on its own line. `review.source` says where each bug's
// kind comes from (a maestro fix, a maestro invariant written in its own source), so the cases are not
// built only to defeat a model.
const SESSIONS = 'apps/maestro/src/core/session-sweep.ts';
const CLAIMS = 'apps/maestro/src/core/claims.ts';
const PATHS = 'apps/maestro/src/core/session-paths.ts';
const TASKS = 'apps/maestro/src/core/tasks.ts';
const CHANNELS = 'apps/maestro/src/core/handoff-channels.ts';

const base = {
  group: 'maestro@3814a30',
  sets: ['066'],
  setup: 'bash {REPO}/bench/maestro-setup.sh {REPO} {MAESTRO} 3814a30 {ARM}',
  skills: ['task-queue', 'installing-maestro', 'updating-maestro', 'maestro-architecture'],
};

export const REVIEW_CASES = [
  {
    ...base,
    id: 'r-l1-resumable-clear',
    kind: 'local',
    review: {
      source: 'maestro 077 / bf86ba8 "keep session state when a session ends in a resumable way": the SessionEnd allow-list of resumable reasons, where `clear` is documented as a final end (the id is abandoned)',
      plant: [{ file: PATHS, from: 'export const RESUMABLE_END_REASONS: readonly string[] = ["prompt_input_exit", "other", "resume"];', to: 'export const RESUMABLE_END_REASONS: readonly string[] = ["prompt_input_exit", "other", "resume", "clear"];' }],
      bugs: [{ id: 'resumable-clear', category: 'local', file: 'session-paths', defect: ['\\bclear\\b', '(final|abandon|resum|remov|director|claim|leak)'], desc: '`clear` joins the resumable SessionEnd reasons, but after /clear the id is abandoned: its session directory is no longer removed, so it leaks and its task claim stays live' }],
    },
    samples: {
      good: 'FINDINGS:\n- apps/maestro/src/core/session-paths.ts: adding `"clear"` to RESUMABLE_END_REASONS keeps the session directory after /clear, but that id is abandoned (a final end), so the directory leaks and a claim held by it stays live.',
      bad: 'FINDINGS:\n- apps/maestro/src/core/session-paths.ts: the list of reasons could be frozen with `as const`.',
    },
  },
  {
    ...base,
    id: 'r-l2-sweep-default-cap',
    kind: 'local',
    review: {
      source: 'maestro 068/066 caps: the sweep is 24h on purpose (the header explains a session parked on a human review) while the explicit delete uses the 15-minute claim cap; the wrong-default kind of the d1-d4 cap tasks in 051',
      plant: [{ file: SESSIONS, from: '  const idleCapMs = options.idleCapMs ?? SESSION_SWEEP_IDLE_CAP_MS;', to: '  const idleCapMs = options.idleCapMs ?? SESSION_DELETE_IDLE_CAP_MS;' }],
      bugs: [{ id: 'sweep-default-cap', category: 'local', file: 'session-sweep', defect: ['(SESSION_DELETE_IDLE_CAP_MS|15.?min|delete cap|claim cap|CLAIM_IDLE_CAP_MS)', '(sweep|default|24 ?h|hours?|parked|idleCapMs|abandon)'], desc: 'sweepStaleSessions now defaults to the 15-minute delete cap instead of the 24h sweep cap, so a session parked for an hour on a human review is deleted with its session.json' }],
    },
    samples: {
      good: 'FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: the default idle cap of `sweepStaleSessions` is now `SESSION_DELETE_IDLE_CAP_MS` (15 minutes) instead of the 24h `SESSION_SWEEP_IDLE_CAP_MS`, so a session parked on a human review is swept as abandoned.',
      bad: 'FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: the options object could be destructured for readability.',
    },
  },
  {
    ...base,
    id: 'r-l3-count-before-remove',
    kind: 'local',
    review: {
      source: 'ordering mistake in a reporting path; the module header says the result count is what the UI reports and "Cannot delete: it stays" (compare maestro a733966, an ordering fix: act only after the thing it depends on is done)',
      plant: [{
        file: SESSIONS,
        from: '        for (const d of sessionDirsFor(claudeDir, sessionId)) fs.rmSync(d, { recursive: true, force: true });\n        removed.push({ projectRoot, sessionId });',
        to: '        removed.push({ projectRoot, sessionId });\n        for (const d of sessionDirsFor(claudeDir, sessionId)) fs.rmSync(d, { recursive: true, force: true });',
      }],
      bugs: [{ id: 'push-before-rm', category: 'local', file: 'session-sweep', defect: ['(\\bpush\\b|removed)', '(before|prior to|ahead of|order|even (if|when)|fails?|throws?)'], desc: 'removed.push runs before the rmSync loop, so a directory whose deletion throws is still reported as removed to the UI' }],
    },
    samples: {
      good: 'FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: `removed.push(...)` now runs before the `rmSync` loop, so when a delete throws the session is still counted as removed even though it stays on disk.',
      bad: 'FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: the try block could be split into a helper for readability.',
    },
  },
  {
    ...base,
    id: 'r-l4-id-min-length',
    kind: 'local',
    review: {
      source: 'maestro 064 session-paths invariant: an id is validated, never sanitised, and the empty string must be rejected before any path is built (a pre-064 sibling-deletes-sibling bug class); a boundary-condition mistake',
      plant: [{ file: PATHS, from: 'const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;', to: 'const SESSION_ID_RE = /^[A-Za-z0-9_-]{0,128}$/;' }],
      bugs: [{ id: 'id-min-length', category: 'local', file: 'session-paths', defect: ['(\\{0,|\\b0\\b|zero|empty|lower bound|minimum)', '(id|session|pattern|regex|quantifier|valid)'], desc: 'the session id pattern now accepts the empty string ({0,128}), so isValidSessionId("") passes and sessionPathsFor builds the sessions root itself as a session directory' }],
    },
    samples: {
      good: 'FINDINGS:\n- apps/maestro/src/core/session-paths.ts: the session id regex changed from `{1,128}` to `{0,128}`, so an empty id is now a valid session id and `sessionPathsFor` resolves the maestro_sessions root as a session directory.',
      bad: 'FINDINGS:\n- apps/maestro/src/core/session-paths.ts: the regex constant could carry a doc comment.',
    },
  },
  {
    ...base,
    id: 'r-l5-empty-dir-zero',
    kind: 'local',
    review: {
      source: 'the "cannot tell = live" invariant in the session-sweep header (an empty directory whose own mtime is fresh is a session that has just started); a wrong initial value, a boundary on the empty case',
      plant: [{ file: SESSIONS, from: '    let newest = fs.statSync(dir).mtimeMs;', to: '    let newest = 0;' }],
      bugs: [{ id: 'empty-dir-zero', category: 'local', file: 'session-sweep', defect: ['(newest|\\b0\\b|zero|initial|seed|starts? (at|from)|own mtime)', '(empty|just started|brand.new|fresh|not logged|own mtime|directory.s own|idle|swe+p)'], desc: 'lastActivityMs starts newest at 0 instead of the directory\'s own mtime, so an empty directory (a session that just started and has not logged yet) reads as idle since 1970 and is swept' }],
    },
    samples: {
      good: 'FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: `lastActivityMs` now starts `newest` at 0 instead of the directory\'s own mtime, so an empty directory of a session that has just started has no activity and reads as idle, and it gets swept.',
      bad: 'FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: the loop could use `for...of` with entries for clarity.',
    },
  },
  {
    ...base,
    id: 'r-x1-list-skips-worktree',
    kind: 'cross',
    review: {
      source: 'maestro 074 worktree pointers (worktree.json in the main checkout) and the session-tab fixes dc0df43 / df66f1a: a session that moved into a worktree resolves through its pointer, and callers of listSessionIds rely on seeing it',
      plant: [{ file: PATHS, from: '    .filter((d) => d.isDirectory() && isValidSessionId(d.name))', to: '    .filter((d) => d.isDirectory() && isValidSessionId(d.name) && !readWorktreePointer(claudeDir, d.name))' }],
      bugs: [{ id: 'list-skips-worktree', category: 'cross', file: 'session-paths|handoff-channels|session-sweep|session-log', defect: ['(pointer|worktree\\.json|worktree)', '(listSessionIds|liveRunIds|pendingLanes|stranded|swe+p|callers?|session-log|omit|skips?|excludes?|drops?|filter)'], desc: 'listSessionIds now skips sessions that moved into a worktree; its callers (liveRunIds / pendingLanes in handoff-channels, the sweep, session-log) no longer see those live sessions, so their channel lanes read as stranded' }],
    },
    samples: {
      good: 'FINDINGS:\n- apps/maestro/src/core/session-paths.ts: `listSessionIds` now filters out any session with a worktree pointer, so callers such as `liveRunIds` / `pendingLanes` in handoff-channels.ts and the sweep stop seeing sessions that run in a worktree; their lanes read as stranded.',
      bad: 'FINDINGS:\n- apps/maestro/src/core/session-paths.ts: the long filter line should be wrapped.',
    },
  },
  {
    ...base,
    id: 'r-x2-sqlite-edge',
    kind: 'cross',
    review: {
      source: 'maestro handoff-channels header: the module is re-exported into the maestro-session bundle every hook requires unconditionally and must stay free of node:sqlite (kept from the 066 first draft; the one case whose primer carries a new cross-concept import edge)',
      plant: [
        { file: CHANNELS, from: 'import type { PendingLane } from "./contracts.js";', to: 'import type { PendingLane } from "./contracts.js";\nimport { readAllProjectTags } from "./project-tags.js";' },
        { file: CHANNELS, from: 'const SCRIBE_LANE = "scribe";', to: 'const SCRIBE_LANE = "scribe";\n/** Project tags the lanes are filed under, read once at load. */\nconst PROJECT_TAGS = new Set(readAllProjectTags());' },
      ],
      bugs: [{ id: 'sqlite-edge', category: 'cross', file: 'handoff-channels', defect: ['(sqlite|project-tags|readAllProjectTags)', '(maestro-session|bundle|plugin|cjs|import|dependency|layer|concept)'], desc: 'handoff-channels (maestro-architecture) now imports project-tags (global-stores, node:sqlite); the module is bundled into maestro-session.cjs and its header says it must not pull in node:sqlite' }],
    },
    samples: {
      good: 'FINDINGS:\n- apps/maestro/src/core/handoff-channels.ts: the new import of `project-tags.js` pulls `node:sqlite` into a module that is bundled into `maestro-session.cjs`; the file header says the plugin lib must not depend on sqlite, and it reads the database at import time.',
      bad: 'FINDINGS:\n- apps/maestro/src/core/handoff-channels.ts: `PROJECT_TAGS` is declared but never used.',
    },
  },
  {
    ...base,
    id: 'r-x3-claim-requires-name',
    kind: 'cross',
    review: {
      source: 'maestro 084 optional claim session_name ("absent when the claimer did not know it ... such a claim still works") and the self-contained twin .claude/scripts/maestro-task-status.cjs, which writes the claim only with a name when it has one; the "copy / keep the twin in sync" class of maestro fixes (809e023, 161b91c)',
      plant: [{ file: CLAIMS, from: '      typeof (data as ClaimFile).claimed_at === "string"\n    ) {', to: '      typeof (data as ClaimFile).claimed_at === "string" &&\n      typeof (data as ClaimFile).session_name === "string"\n    ) {' }],
      bugs: [{ id: 'claim-requires-name', category: 'cross', file: 'claims|task-status|tasks\\.ts|epics', defect: ['(session_name|sessionName)', '(optional|unnamed|without|absent|older|task-status|cjs|\\bCLI\\b|no name|not named)'], desc: 'readClaimFile now requires session_name, but it is optional and maestro-task-status.cjs writes unnamed claims; those read as no claim, so readClaims drops them and claimTask overwrites a live claim' }],
    },
    samples: {
      good: 'FINDINGS:\n- apps/maestro/src/core/claims.ts: `readClaimFile` now requires `session_name` to be a string, but the field is optional and `maestro-task-status.cjs` claims without it when the session has no name; those claims read as absent, `readClaims` skips them and `claimTask` then overwrites a live claim.',
      bad: 'FINDINGS:\n- apps/maestro/src/core/claims.ts: the condition could be extracted into a type guard function.',
    },
  },
  {
    ...base,
    id: 'r-x4-liveness-state-file',
    kind: 'cross',
    review: {
      source: 'maestro 066 claim liveness: a claim is live while the session log.jsonl (appended on every tool call) is fresh, session.json is rewritten only on workflow steps (session-sweep header); the twin maestro-task-status.cjs keeps the log rule, and the stale-claim / false-runtime-warning fix class (1974208)',
      plant: [{ file: CLAIMS, from: '    const stat = fs.statSync(paths.log);', to: '    const stat = fs.statSync(paths.state);' }],
      bugs: [{ id: 'liveness-state-file', category: 'cross', file: 'claims', defect: ['(session\\.json|\\bstate\\b|paths\\.state)', '(log\\.jsonl|\\blog\\b|idle|stale|dead|reap|twin|task-status|workflow step)'], desc: 'isSessionLive reads the mtime of session.json instead of log.jsonl; session.json changes only on workflow steps, so a busy session reads dead after 15 minutes, readClaims reaps its claim file and the app disagrees with maestro-task-status.cjs' }],
    },
    samples: {
      good: 'FINDINGS:\n- apps/maestro/src/core/claims.ts: `isSessionLive` now stats `paths.state` (session.json) instead of the log; session.json is rewritten only on workflow steps, so a busy session looks stale after 15 minutes and `readClaims` reaps its claim, disagreeing with the log-based check in maestro-task-status.cjs.',
      bad: 'FINDINGS:\n- apps/maestro/src/core/claims.ts: the variable `stat` could be named `st` for consistency.',
    },
  },
  {
    ...base,
    id: 'r-x5-queue-root',
    kind: 'cross',
    review: {
      source: 'maestro 074 + 45a3583 "always write maestro tasks to the repository-root .claude": the queue (status.json, claims/) lives in the MAIN checkout, and every tasks.ts entry point maps its project root first (worktree.ts header)',
      plant: [{
        file: TASKS,
        from: '  if (!projectRoot) return [];\n  projectRoot = mainCheckoutRoot(projectRoot);\n  const dir = tasksDirFor(projectRoot);\n  const files = listTaskFiles(dir);\n  const base = path.basename(filename);\n  const existingStatus = readStatusMap(dir);',
        to: '  if (!projectRoot) return [];\n  const dir = tasksDirFor(projectRoot);\n  const files = listTaskFiles(dir);\n  const base = path.basename(filename);\n  const existingStatus = readStatusMap(dir);',
      }],
      bugs: [{ id: 'queue-root', category: 'cross', file: 'tasks\\.ts|worktree', defect: ['(mainCheckoutRoot|main checkout|queue root|repository root)', '(deleteTask|worktree|claims?|status\\.json|postmortems?|ipc|siblings?|other (functions|entry))'], desc: 'deleteTask no longer maps its project root with mainCheckoutRoot; when the open project is a worktree it deletes from and rewrites a different queue and reads its claims against the wrong .claude, unlike listTasks and closeTask' }],
    },
    samples: {
      good: 'FINDINGS:\n- apps/maestro/src/core/tasks.ts: `deleteTask` dropped `projectRoot = mainCheckoutRoot(projectRoot)`; the queue (status.json, claims) always lives in the main checkout, so from a worktree it now operates on another queue and reads claims against the wrong .claude, unlike `listTasks` and `closeTask`.',
      bad: 'FINDINGS:\n- apps/maestro/src/core/tasks.ts: the function is long and could be split.',
    },
  },
  {
    ...base,
    id: 'r-c1-inline-idle',
    kind: 'clean',
    review: {
      plant: [{ file: SESSIONS, from: '  const idle = now - last;\n  return idle > idleCapMs; // negative (future mtime) is never > cap', to: '  return now - last > idleCapMs; // negative (future mtime) is never > cap' }],
      bugs: [],
    },
    samples: {
      good: 'The change inlines a local variable with the same behaviour.\n\nFINDINGS: none',
      bad: 'FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: the inline expression is harder to read.\n- apps/maestro/src/core/session-sweep.ts: the comment is now misplaced.',
    },
  },
  {
    ...base,
    id: 'r-c3-regex-suffix',
    kind: 'clean',
    review: {
      plant: [{ file: CLAIMS, from: '    const filename = fileName.slice(0, -".json".length);', to: '    const filename = fileName.replace(/\\.json$/, "");' }],
      bugs: [],
    },
    samples: {
      good: 'The names are already filtered to end in .json, so the regex strips the same suffix.\n\nFINDINGS: none',
      bad: 'FINDINGS:\n- apps/maestro/src/core/claims.ts: the regex may not match names that contain dots.',
    },
  },
  {
    ...base,
    id: 'r-c4-split-guard',
    kind: 'clean',
    review: {
      plant: [{ file: SESSIONS, from: '  if (!st.isDirectory() || st.isSymbolicLink()) return false;', to: '  if (!st.isDirectory()) return false;\n  if (st.isSymbolicLink()) return false;' }],
      bugs: [],
    },
    samples: {
      good: 'One condition split into two guards with the same result.\n\nFINDINGS: none',
      bad: 'FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: splitting the guard changes which check runs first and may let a symlink through.',
    },
  },
  {
    // 068: replaces the two comment-only clean diffs (c2, c5) with refactors that look riskier than they are.
    ...base,
    id: 'r-c6-drop-exists-guard',
    kind: 'clean',
    review: {
      plant: [{ file: CLAIMS, from: '  if (!paths) return false;\n  if (!fs.existsSync(paths.dir)) return false;\n  try {\n    const stat = fs.statSync(paths.log);', to: '  if (!paths) return false;\n  try {\n    const stat = fs.statSync(paths.log);' }],
      bugs: [],
    },
    samples: {
      good: 'The removed existsSync is redundant: statSync on the log inside paths.dir throws when the directory is missing, and the catch returns false.\n\nFINDINGS: none',
      bad: 'FINDINGS:\n- apps/maestro/src/core/claims.ts: removing the directory existence check means a clean SessionEnd no longer reads as dead immediately.',
    },
  },
  {
    ...base,
    id: 'r-c7-hoist-claude-dir',
    kind: 'clean',
    review: {
      plant: [
        { file: SESSIONS, from: '  const paths = sessionPathsFor(path.join(projectRoot, ".claude"), sessionId);\n  if (!paths) return { removed: false, reason: "invalid" };', to: '  const claudeDir = path.join(projectRoot, ".claude");\n  const paths = sessionPathsFor(claudeDir, sessionId);\n  if (!paths) return { removed: false, reason: "invalid" };' },
        { file: SESSIONS, from: '    for (const d of sessionDirsFor(path.join(projectRoot, ".claude"), sessionId)) {', to: '    for (const d of sessionDirsFor(claudeDir, sessionId)) {' },
      ],
      bugs: [],
    },
    samples: {
      good: 'The repeated path.join is hoisted into one const with the same value.\n\nFINDINGS: none',
      bad: 'FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: the hoisted claudeDir could be stale if projectRoot changes between the two uses.',
    },
  },
];

export const reviewCaseById = (id) => REVIEW_CASES.find((c) => c.id === id);
// `only` is one substring or a comma-separated list of them; a case matches when its id contains any.
export const selectReviewCases = (only = '') => {
  const keys = String(only).split(',').map((k) => k.trim()).filter(Boolean);
  return REVIEW_CASES.filter((c) => !keys.length || keys.some((k) => c.id.includes(k)));
};
