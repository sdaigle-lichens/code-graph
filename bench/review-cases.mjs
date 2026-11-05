// 066 review cases: planted changes on the pinned maestro checkout (3814a30), each a diff the reviewer
// arms judge. `review.plant` is applied to the no-graph workspace before the run; the diff the reviewer
// sees is computed from it (bench/review/<id>.diff, stored by review-prep.mjs). `review.bugs` are the
// planted defects with their graders (finding must match `file` and every `defect` regex). A case with no
// bugs is a clean diff: any finding on it is a false alarm. `samples.good` / `samples.bad` are review
// texts the unit tests grade (good must be fully credited, bad must score nothing).
const SESSIONS = 'apps/maestro/src/core/session-sweep.ts';
const CLAIMS = 'apps/maestro/src/core/claims.ts';
const TAGS = 'apps/maestro/src/core/project-tags.ts';
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
    id: 'r-l1-future-mtime',
    kind: 'local',
    review: {
      plant: [{ file: SESSIONS, from: '  return idle > idleCapMs; // negative (future mtime) is never > cap', to: '  return Math.abs(idle) > idleCapMs;' }],
      bugs: [{ id: 'abs-idle', category: 'local', file: 'session-sweep', defect: ['(future|clock.?skew|negative|abs)'], desc: 'Math.abs makes a future mtime look idle, so a live session (clock skew) is deleted' }],
    },
    samples: {
      good: 'I read the diff.\n\nFINDINGS:\n- apps/maestro/src/core/session-sweep.ts: `Math.abs(idle)` treats a future mtime (clock skew) as idle, so a live session directory is deleted; the old code kept it.',
      bad: 'FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: the cap constant could use a clearer name.',
    },
  },
  {
    ...base,
    id: 'r-l2-first-entry',
    kind: 'local',
    review: {
      plant: [{ file: SESSIONS, from: '    for (const name of fs.readdirSync(dir)) {', to: '    for (const name of fs.readdirSync(dir).slice(1)) {' }],
      bugs: [{ id: 'slice-first', category: 'local', file: 'session-sweep', defect: ['(\\bslice\\b|\\bskips? (the )?(first|1st|initial)|first (entry|child|file|item)|off.by.one|\\bdrops? the first)'], desc: 'slice(1) skips the first directory entry (log.jsonl sorts first), so a session whose fresh file is that entry looks idle' }],
    },
    samples: {
      good: 'FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: `readdirSync(dir).slice(1)` skips the first entry (an off-by-one), so `log.jsonl` is ignored and an active session can look idle and be swept.',
      bad: 'FINDINGS:\n- apps/maestro/src/core/claims.ts: unrelated to this diff, the doc comment is long.',
    },
  },
  {
    ...base,
    id: 'r-l3-no-log-live',
    kind: 'local',
    review: {
      plant: [{ file: CLAIMS, from: '    return now - stat.mtimeMs <= CLAIM_IDLE_CAP_MS;\n  } catch {\n    return false;', to: '    return now - stat.mtimeMs <= CLAIM_IDLE_CAP_MS;\n  } catch {\n    return true;' }],
      bugs: [{ id: 'catch-true', category: 'local', file: 'claims', defect: ['(catch|error|missing|no log|absent|enoent)', '(true|live)'], desc: 'a missing or unreadable log.jsonl now counts as live, so a crashed session claim is never reaped' }],
    },
    samples: {
      good: 'FINDINGS:\n- apps/maestro/src/core/claims.ts: `isSessionLive` now returns true in the catch branch, so a session with no `log.jsonl` (stat error) counts as live and its claim is never reaped.',
      bad: 'FINDINGS:\n- apps/maestro/src/core/claims.ts: the variable name `stat` shadows nothing but could be renamed.',
    },
  },
  {
    ...base,
    id: 'r-x1-set-return',
    kind: 'cross',
    review: {
      plant: [{
        file: TAGS,
        from: 'export function readAllProjectTags(dbPath: string = DEFAULT_PROJECT_TAGS_DB_PATH): string[] {\n  const db = openDb(dbPath);\n  try {\n    const rows = db.prepare("SELECT tag FROM project_tags ORDER BY tag").all() as Array<{ tag: string }>;\n    return rows.map((r) => r.tag);',
        to: 'export function readAllProjectTags(dbPath: string = DEFAULT_PROJECT_TAGS_DB_PATH): Set<string> {\n  const db = openDb(dbPath);\n  try {\n    const rows = db.prepare("SELECT tag FROM project_tags ORDER BY tag").all() as Array<{ tag: string }>;\n    return new Set(rows.map((r) => r.tag));',
      }],
      bugs: [{ id: 'set-callers', category: 'cross', file: 'project-tags|install\\.ts|claude-preview|ipc\\.ts|claude-session', defect: ['\\bSet\\b', '(callers?|install\\.ts|claude-preview|ipc\\.ts|claude-session|string\\[\\])'], desc: 'readAllProjectTags now returns a Set; callers in install.ts, claude-preview.ts, ipc.ts and claude-session.ts expect string[]' }],
    },
    samples: {
      good: 'FINDINGS:\n- apps/maestro/src/core/project-tags.ts: `readAllProjectTags` now returns a `Set<string>`, but its callers (`install.ts`, `claude-preview.ts`, `ipc.ts` which returns it as `string[]`) still expect an array.',
      bad: 'FINDINGS:\n- apps/maestro/src/core/project-tags.ts: the doc comment still says "sorted" which is fine.',
    },
  },
  {
    ...base,
    id: 'r-x2-sqlite-edge',
    kind: 'cross',
    review: {
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
    id: 'r-x3-arg-swap',
    kind: 'cross',
    review: {
      plant: [{ file: CLAIMS, from: 'export function isSessionLive(claudeDir: string, sessionId: string, now: number = Date.now()): boolean {', to: 'export function isSessionLive(sessionId: string, claudeDir: string, now: number = Date.now()): boolean {' }],
      bugs: [{ id: 'arg-swap', category: 'cross', file: 'claims|per-session-state', defect: ['(swap|order|reorder|argument|parameter|signature)', '(callers?|call sites?|claimTask|readClaims|per-session-state|test)'], desc: 'isSessionLive parameters swapped; both are strings, so claimTask, readClaims and the tests still compile and silently pass the wrong values' }],
    },
    samples: {
      good: 'FINDINGS:\n- apps/maestro/src/core/claims.ts: `isSessionLive` swapped its first two parameters. Both are strings, so the callers `readClaims` and `claimTask` still type-check but now pass the arguments in the wrong order; the tests in `per-session-state` call it the old way.',
      bad: 'FINDINGS:\n- apps/maestro/src/core/claims.ts: the function could have a shorter name.',
    },
  },
  {
    ...base,
    id: 'r-l4-and-guard',
    kind: 'local',
    review: {
      plant: [{ file: SESSIONS, from: '      if (!isValidSessionId(sessionId) || sessionId === ownId) continue;', to: '      if (!isValidSessionId(sessionId) && sessionId === ownId) continue;' }],
      bugs: [{ id: 'and-guard', category: 'local', file: 'session-sweep', defect: ['(&&|\\|\\||\\bor\\b|\\band\\b|operator|condition)', '(own|ownId|invalid|current session|validat)'], desc: 'the skip guard `||` became `&&`: only an id that is both invalid and the caller\'s own is skipped, so the running session itself can be swept' }],
    },
    samples: {
      good: 'FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: the guard changed from `||` to `&&`, so a session is skipped only when its id is invalid and also the caller\'s own; the caller\'s own session (ownId) is no longer protected and can be swept.',
      bad: 'FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: the `continue` could be replaced by a filter call for readability.',
    },
  },
  {
    ...base,
    id: 'r-l5-min-activity',
    kind: 'local',
    review: {
      plant: [{ file: SESSIONS, from: '        newest = Math.max(newest, fs.lstatSync(path.join(dir, name)).mtimeMs);', to: '        newest = Math.min(newest, fs.lstatSync(path.join(dir, name)).mtimeMs);' }],
      bugs: [{ id: 'min-activity', category: 'local', file: 'session-sweep', defect: ['(Math\\.min|\\bmin\\b|oldest|earliest)', '(newest|activity|idle|abandon|swe+p|delete|live)'], desc: 'Math.min yields the oldest mtime instead of the newest, so a session with one old file and fresh activity looks idle and is deleted' }],
    },
    samples: {
      good: 'FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: `Math.min` in `lastActivityMs` returns the oldest mtime rather than the newest, so any session with one old file counts as idle and is swept even while it is active.',
      bad: 'FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: the loop could use `for...of` with entries for clarity.',
    },
  },
  {
    ...base,
    id: 'r-x4-claim-key',
    kind: 'cross',
    review: {
      plant: [{ file: CLAIMS, from: '    const filename = fileName.slice(0, -".json".length);', to: '    const filename = fileName.slice(0, -".md.json".length);' }],
      bugs: [{ id: 'claim-key', category: 'cross', file: 'claims|tasks|epics', defect: ['(\\.md|key|filename|suffix|slice)', '(tasks\\.ts|epics|listTasks|claims\\.get|lookup|look up|overlay|never match|callers?)'], desc: 'readClaims now keys claims without the ".md" suffix; tasksFromFiles (tasks.ts) and the epic view (epics.ts) look them up by the full task filename, so no claim is ever shown or honoured' }],
    },
    samples: {
      good: 'FINDINGS:\n- apps/maestro/src/core/claims.ts: `readClaims` now strips ".md.json" so the map key loses the ".md" suffix, but its callers (`tasksFromFiles` in tasks.ts via `listTasks`, and the epic view in epics.ts) call `claims.get(filename)` with the full ".md" name, so every claim is silently lost.',
      bad: 'FINDINGS:\n- apps/maestro/src/core/claims.ts: the slice length could be a named constant.',
    },
  },
  {
    ...base,
    id: 'r-x5-delete-cap',
    kind: 'cross',
    review: {
      plant: [{ file: SESSIONS, from: 'export const SESSION_DELETE_IDLE_CAP_MS = CLAIM_IDLE_CAP_MS;', to: 'export const SESSION_DELETE_IDLE_CAP_MS = SESSION_SWEEP_IDLE_CAP_MS;' }],
      bugs: [{ id: 'delete-cap', category: 'cross', file: 'session-sweep', defect: ['(SESSION_SWEEP_IDLE_CAP_MS|24 ?h|24.hour|sweep cap)', '(15|delete|running|listDeletable|deleteSession|CLAIM_IDLE_CAP_MS|crashed|ipc|x )'], desc: 'the explicit-delete cap becomes the 24h sweep cap instead of the 15-minute claim cap, so a crashed session stays "running" for a day and listDeletableSessions / deleteSession (and the x on the tab, via ipc) refuse it' }],
    },
    samples: {
      good: 'FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: `SESSION_DELETE_IDLE_CAP_MS` now equals the 24h sweep cap rather than the 15-minute `CLAIM_IDLE_CAP_MS` the comment above promises, so `deleteSession` and `listDeletableSessions` treat a crashed session as running for a day and the x on its tab (ipc) is not offered.',
      bad: 'FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: the exported constant should have a doc comment.',
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
    id: 'r-c2-doc-grammar',
    kind: 'clean',
    review: {
      plant: [{ file: CLAIMS, from: 'A missing session directory (clean `SessionEnd`) is dead immediately', to: 'A missing session directory (a clean `SessionEnd`) is dead immediately' }],
      bugs: [],
    },
    samples: {
      good: 'Only a comment changed.\n\nFINDINGS: none',
      bad: 'FINDINGS:\n- apps/maestro/src/core/claims.ts: the comment change might hide a behaviour change.',
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
    ...base,
    id: 'r-c5-comment-hours',
    kind: 'clean',
    review: {
      plant: [{ file: SESSIONS, from: 'so the 24h sweep cap does not apply', to: 'so the 24-hour sweep cap does not apply' }],
      bugs: [],
    },
    samples: {
      good: 'Comment wording only.\n\nFINDINGS: none',
      bad: 'FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: other docs still say 24h, which is now inconsistent.',
    },
  },
];

export const reviewCaseById = (id) => REVIEW_CASES.find((c) => c.id === id);
export const selectReviewCases = (only = '') => REVIEW_CASES.filter((c) => !only || c.id.includes(only));
