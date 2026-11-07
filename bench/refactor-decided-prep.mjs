#!/usr/bin/env node
// 073: generate, at $0 and deterministically, the decided-against list bench/refactor/decided-against.json.
// No model call. The entries below were written by hand ONCE, from proposals of the 071 paid run
// (bench/results/refactor-2026-11-06T20-32-24-067Z, scout and baseline answers) that are NOT expected
// improvements of any case and are not tolerated; the 071 expected improvements (readLogLines copies, payload
// routes twice, runtime staleness rule, title-case copies, tasks ready rule, section slicing, SessionRef,
// removal loop, options defaults, atomic write copies, in-place JSON writes) are deliberately left out, so a
// recall loss of the arm shows over-broad suppression and not a planted conflict. It is never built from the
// scoring of a 073 run. `reason` is the declining person's or reviewer's reason, written by the bench author
// standing in for them (the scribe recording step itself is not measured).
//   code reference = file + symbol; contentHash = hash of that symbol's declaration in the PINNED maestro tree
//   (3814a30, `git show`), see codeHash in refactor-decided.mjs; `match` = how the report counts a proposal as a
//   repeat of the entry (same form as an expected improvement's file/change patterns).
// Usage: node bench/refactor-decided-prep.mjs [--check]   (--check writes nothing and exits 1 on drift)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeHash, DECIDED_FILE } from './refactor-decided.mjs';
import { maestroDirOrExit } from './maestro-dir.mjs';

export const PINNED = '3814a30';
const C = 'apps/maestro/src/core';
const P = 'plugins/maestro/scripts';
const GENERIC = '(cop(y|ies)|duplicat|identical|same|repeat|shared|helper|extract|re-?implement|reuse|consolidat)';

// source: where the declined proposal came from in the 071 paid run (cases; how many times it came back)
export const DECIDED_SOURCE = [
  {
    id: 'uninstall-find-tasks-is-list-task-files', file: `${C}/uninstall.ts`, symbol: 'findMaestroTasks', kind: 'dedupe',
    claim: '`findMaestroTasks` re-implements `listTaskFiles` of tasks.ts (readdir, keep .md, sort); export `listTaskFiles` and call it.',
    reason: 'The copy is a few lines; exporting a tasks.ts internal to the uninstaller couples the uninstall path to the task queue for no behaviour change.',
    match: { file: 'uninstall', change: ['(findMaestroTasks|MAESTRO_TASKS_REL)', '(listTaskFiles|TASKS_SUBDIR)'] },
    source: 'f-l1 (haiku and sonnet, 3 of 4 runs)',
  },
  {
    id: 'claims-task-claim-built-by-hand', file: `${C}/claims.ts`, symbol: 'readClaims', kind: 'extract-helper',
    claim: 'The `TaskClaim` object is built by hand from a `ClaimFile` in `readClaims` and twice in `claimTask`, and `claimSessionName` repeats the check of `nameOf`; add a `toTaskClaim` helper.',
    reason: 'Each build site differs in what it passes for `live`; a helper adds an indirection to three one-line literals.',
    match: { file: 'claims\\.ts', change: ['(toTaskClaim|TaskClaim|nameOf|claimSessionName|claimPathFor)', '(three|twice|repeat|duplicat|by hand|built|rebuil|inline|helper)'] },
    source: 'f-l1, f-s5 (haiku and sonnet, 6 of 8 runs)',
  },
  {
    id: 'claims-ensure-dir-gitignore-copy', file: `${C}/claims.ts`, symbol: 'ensureClaimsDir', kind: 'dedupe',
    claim: '`ensureClaimsDir` copies the .gitignore "*" write of `ensureSessionsRoot` in session-paths.ts; extract a shared `ensureIgnoredDir`.',
    reason: 'The comment on the copy says it is replicated exactly on purpose: claims.ts must not import session-paths.ts (leaf module).',
    match: { file: 'claims\\.ts|session-paths', change: ['(ensureClaimsDir|ensureSessionsRoot|gitignore)', '(replicat|cop(y|ies)|duplicat|same|shared)'] },
    source: 'f-s5 (haiku, 1 run)',
  },
  {
    id: 'tasks-dir-path-spelled-five-ways', file: `${C}/tasks.ts`, symbol: 'TASKS_SUBDIR', kind: 'extract-helper',
    claim: 'The `.claude/maestro-tasks` location is spelled five ways (`TASKS_SUBDIR`, `MAESTRO_TASKS_REL`, inline joins in tasks.ts, epics.ts and claude-preview.ts); export one constant and a `taskRelativePath` helper.',
    reason: 'The strings sit in different layers (uninstall, preview, queue) and change together only by accident; one shared constant would tie them.',
    match: { file: 'tasks\\.ts|epics|uninstall|claude-preview', change: ['(\\.claude/maestro-tasks|MAESTRO_TASKS_REL|TASKS_SUBDIR|TASKS_REL|taskRelativePath)', '(five|5|spelled|rebuilt|inline|constant)'] },
    source: 'f-l1 (haiku and sonnet, 3 of 4 runs)',
  },
  {
    id: 'lock-helper-copied-epics-run-metrics', file: `${C}/epics.ts`, symbol: 'withLock', kind: 'extract-helper',
    claim: '`withLock` and `sleepSync` of epics.ts are copied in run-metrics.ts (mkdir lock, stale-lock break, retry); extract one shared lock helper with the timeout policy as an option.',
    reason: 'The two differ in what a timeout does (epics throws, run-metrics proceeds); a shared primitive with a policy flag is harder to read than two short loops.',
    match: { file: 'epics|run-metrics', change: ['(withLock|sleepSync|lock helper|lock primitive)', GENERIC] },
    source: 'f-l1, f-l3 (haiku and sonnet, 5 of 8 runs)',
  },
  {
    id: 'epics-inbox-write-report-note', file: `${C}/epics.ts`, symbol: 'writeReport', kind: 'extract-helper',
    claim: '`writeReport` and `writeNote` repeat the inbox sequence (next id, mkdir, write header and body, push a log entry); extract a `writeInboxEntry` helper.',
    reason: 'The two entries have different headers and log fields; the shared part is five lines of fs calls.',
    match: { file: 'epics', change: ['(writeReport|writeNote|writeInboxEntry)', GENERIC] },
    source: 'f-s5, f-l3 (haiku, 3 runs)',
  },
  {
    id: 'epics-exported-types-unused', file: `${C}/epics.ts`, symbol: 'EpicWorker', kind: 'remove-unused',
    claim: 'About 17 exported interfaces and types of epics.ts (`EpicWorker`, `EpicState`, `SpawnableTask`, `EpicReadyView`) are imported nowhere; drop their `export`.',
    reason: 'They document the module shape and type its public functions; the app and the plugin tooling read them from the barrel.',
    match: { file: 'epics', change: ['(EpicWorker|EpicState|SpawnableTask|EpicReadyView|exported (interfaces|types)|types)', '(not imported|not mentioned|unused|nothing imports|no importer|drop|export)'] },
    source: 'f-s5, f-l3 (haiku, 2 runs)',
  },
  {
    id: 'session-runtime-read-json-copies', file: `${C}/session-runtime.ts`, symbol: 'readJson', kind: 'dedupe',
    claim: '`readJson` of session-runtime.ts is identical to `readJsonSafe` of config.ts, and marketplaces.ts, skill-availability.ts, detect.ts and run-metrics.ts carry more copies; keep one exported reader.',
    reason: 'Each copy has its own failure policy at its call site and some modules must stay free of the config module imports (fs-only bundles).',
    match: { file: 'session-runtime|config\\.ts|run-metrics|marketplaces|skill-availability|detect', change: ['(readJson|readJsonSafe)', GENERIC] },
    source: 'f-l3 (haiku and sonnet, 4 of 4 runs)',
  },
  {
    id: 'meeting-mode-owner-run-parallel', file: `${C}/meeting-mode.ts`, symbol: 'ownerRunLeftovers', kind: 'dedupe',
    claim: 'The owner-run functions (`ownerRunLeftovers`, `closeOwnerRuns`, `endOwnerRuns`) repeat the meeting ones line for line; parameterise one marker-in-session.json family by its key.',
    reason: 'The two markers have different lifecycles and are kept apart so that one can change without the other.',
    match: { file: 'meeting-mode', change: ['(ownerRun|meetingLeftovers|owner-run|closeOwnerRuns|endOwnerRuns)', '(same|repeat|parameteri|duplicat|line for line|filter|key)'] },
    source: 'f-l3 (haiku, 2 runs)',
  },
  {
    id: 'agent-sync-template-name-frontmatter', file: `${C}/agent-sync.ts`, symbol: 'templateNameOf', kind: 'dedupe',
    claim: '`templateNameOf` hand-parses frontmatter with its own regex while agent-fork-record.ts has `splitFrontmatter`; export a name reader from agent-fork-record.ts and use it.',
    reason: 'The regex reads one field of a template that may be malformed; reusing the record parser would make a bad template throw.',
    match: { file: 'agent-sync|agent-fork', change: ['(templateNameOf|splitFrontmatter)', '(frontmatter|regex|re-?pars|hand-?pars)'] },
    source: 'f-l3 (haiku, 2 runs)',
  },
  {
    id: 'agent-fork-plugin-version-lookup', file: `${C}/agent-fork.ts`, symbol: 'pluginVersionFor', kind: 'dedupe',
    claim: '`pluginVersionFor` repeats the plugin version lookup of `resolveTemplate` / `installedPluginSources` in agent-sync.ts; move it to one shared resolver.',
    reason: 'The two answer different questions (the bundled version rule for maestro itself, the installed one for other plugins) and drift on purpose.',
    match: { file: 'agent-fork|agent-sync', change: ['(pluginVersionFor|resolveTemplate|installedPluginSources)', GENERIC] },
    source: 'f-l3 (haiku, 2 runs)',
  },
  {
    id: 'session-log-read-session-log-barrel-only', file: `${C}/session-log.ts`, symbol: 'readSessionLog', kind: 'remove-unused',
    claim: '`readSessionLog` has no consumer outside the `core/index.ts` barrel re-export; delete it and its barrel entry.',
    reason: 'It is the supported reader for a whole log and the barrel is the module contract; the tail reader is the only one the app uses today.',
    match: { file: 'session-log', change: ['readSessionLog', '(unused|nothing|no consumer|no caller|barrel|re-?export|never)'] },
    source: 'f-c2 (haiku, 2 of 2 runs)',
  },
  {
    id: 'session-log-dedupe-project-roots-move', file: `${C}/session-log.ts`, symbol: 'dedupeProjectRoots', kind: 'extract-helper',
    claim: '`dedupeProjectRoots` is a project-root utility living in session-log.ts that session-ipc.ts imports across concepts; move it to session-paths.ts.',
    reason: 'It belongs to the log reader that dedupes the roots it scans; moving it only trades one cross-concept import for another.',
    match: { file: 'session-log|session-ipc', change: ['dedupeProjectRoots', '(move|session-paths|cross|concept|import)'] },
    source: 'f-c2 (haiku, 2 of 2 runs)',
  },
  {
    id: 'plugin-read-global-handoff-copies', file: `${P}/maestro-inject-agent-context.js`, symbol: 'readGlobalHandoff', kind: 'extract-helper',
    claim: 'The `readGlobalHandoff` wrapper (a lazy require of maestro-handoff-defaults.cjs that returns null on failure) is copied in maestro-inject-agent-context.js, maestro-subagent-log.js and maestro-resume-target.cjs; move it to one shared module.',
    reason: 'Each script is a separate bundle that loads node:sqlite lazily; a shared module would pull it in eagerly.',
    match: { file: 'maestro-(inject-agent-context|subagent-log|resume-target)', change: ['readGlobalHandoff', GENERIC] },
    source: 'f-r5 (haiku and sonnet, 4 of 4 runs)',
  },
];

function showPinned(maestro, file) {
  const r = spawnSync('git', ['-C', maestro, 'show', `${PINNED}:${file}`], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return r.status === 0 ? r.stdout : null;
}

export function buildList(readFile) {
  const entries = DECIDED_SOURCE.map((s) => {
    const h = codeHash(readFile(s.file), s.symbol);
    if (!h) throw new Error(`${s.id}: ${s.symbol} not found in ${s.file} at ${PINNED}`);
    return { id: s.id, file: s.file, symbol: s.symbol, contentHash: h, kind: s.kind, claim: s.claim, reason: s.reason, match: s.match, source: s.source };
  });
  return { version: 1, tree: `maestro@${PINNED}`, builtFrom: 'ticket 071 paid run proposals that are not expected improvements (hand-picked, $0, before any 073 run)', entries };
}

function main() {
  const check = process.argv.includes('--check');
  const maestro = maestroDirOrExit();
  const text = `${JSON.stringify(buildList((f) => showPinned(maestro, f)), null, 1)}\n`;
  if (check) {
    const same = existsSync(DECIDED_FILE) && readFileSync(DECIDED_FILE, 'utf8') === text;
    console.log(`decided-against.json: ${same ? 'unchanged' : 'DIFFERS'} (${text.length} chars)`);
    process.exit(same ? 0 : 1);
  }
  mkdirSync(dirname(DECIDED_FILE), { recursive: true });
  writeFileSync(DECIDED_FILE, text);
  console.log(`decided-against.json: wrote ${text.length} chars`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
