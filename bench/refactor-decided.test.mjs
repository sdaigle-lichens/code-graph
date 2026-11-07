import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REFACTOR_ARMS, classifyItem, promptProblems, refactorPrompt } from './refactor.mjs';
import { REFACTOR_CASES, selectRefactorCases } from './refactor-cases.mjs';
import { applyReplacements } from './edit.mjs';
import {
  DECIDED_ARM, DECIDED_CONTROL, MIN_CONTROL_REPEATS, cellRepeats, codeHash, decidedBlock, decidedFor, decidedReport, decidedStoredProblems, decidedVerdict, entryMatches, hashText,
  loadDecided, scopeFiles, symbolText,
} from './refactor-decided.mjs';
import { PINNED, buildList, DECIDED_SOURCE } from './refactor-decided-prep.mjs';
import { resolveMaestroDir } from './maestro-dir.mjs';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const storedScope = (id) => readFileSync(join(here, 'refactor', `${id}.scope.txt`), 'utf8');
const caseOf = (id) => REFACTOR_CASES.find((c) => c.id === id);

// ---- synthetic fixture: two files in the neighbourhood, one outside -----------------------------------------

const A_TS = 'import x from "y";\n\nexport function alpha(a: number) {\n  return a + 1;\n}\n\nexport const BETA = 2;\n';
const B_TS = 'export interface Gamma {\n  n: number;\n}\n\nfunction delta() {\n  return 4;\n}\n';
const C_TS = 'export function epsilon() {\n  return 5;\n}\n';
const SCOPE = '2 files:\n- src/a.ts (concept one)\n- src/b.ts (concept none: outside every concept)\n';
const tree = (over = {}) => ({ 'src/a.ts': A_TS, 'src/b.ts': B_TS, 'src/c.ts': C_TS, ...over });
const reader = (t) => (f) => (f in t ? t[f] : null);
const entry = (id, file, symbol, text) => ({ id, file, symbol, kind: 'dedupe', contentHash: codeHash(text, symbol), claim: `claim of ${id}.`, reason: `reason of ${id}.`, match: { file, change: [id] } });
const ENTRIES = [entry('ea', 'src/a.ts', 'alpha', A_TS), entry('eb', 'src/b.ts', 'delta', B_TS), entry('ec', 'src/c.ts', 'epsilon', C_TS)];

test('scopeFiles reads the file list of a stored scope', () => {
  assert.deepEqual(scopeFiles(SCOPE), ['src/a.ts', 'src/b.ts']);
  assert.deepEqual(scopeFiles(storedScope('f-c2-session-ipc')).length, 4);
});

test('symbolText and codeHash: the hash is of the symbol only, whitespace at line ends is ignored, a missing symbol is null', () => {
  assert.equal(symbolText(A_TS, 'alpha'), 'export function alpha(a: number) {\n  return a + 1;\n}');
  assert.equal(symbolText(A_TS, 'BETA'), 'export const BETA = 2;');
  assert.equal(symbolText(B_TS, 'Gamma'), 'export interface Gamma {\n  n: number;\n}');
  assert.equal(symbolText(A_TS, 'alph'), null, 'a prefix of a name is not the name');
  assert.equal(symbolText(A_TS, 'nothing'), null);
  assert.equal(codeHash(A_TS, 'alpha'), codeHash(`${A_TS}\nexport const OTHER = 9;\n`, 'alpha'), 'a change outside the symbol keeps the hash');
  assert.equal(codeHash(A_TS, 'alpha'), codeHash(A_TS.replace('return a + 1;', 'return a + 1;   '), 'alpha'), 'trailing blanks do not count');
  assert.notEqual(codeHash(A_TS, 'alpha'), codeHash(A_TS.replace('a + 1', 'a + 2'), 'alpha'));
  assert.equal(codeHash(A_TS, 'nothing'), null);
  assert.equal(codeHash(null, 'alpha'), null);
  assert.equal(codeHash(A_TS, ''), hashText(A_TS), 'without a symbol the whole file is hashed');
  assert.match(codeHash(A_TS, 'alpha'), /^[0-9a-f]{16}$/);
});

test('injection: only entries for files of the neighbourhood are injected, the others are outside', () => {
  const d = decidedFor(ENTRIES, SCOPE, reader(tree()));
  assert.deepEqual(d.inject.map((e) => e.id), ['ea', 'eb']);
  assert.deepEqual(d.outside.map((e) => e.id), ['ec'], 'src/c.ts is not in the scope');
  assert.deepEqual(d.expired, []);
  const block = decidedBlock(d.inject);
  assert.match(block, /^<decided-against>/);
  assert.match(block, /<\/decided-against>$/);
  assert.ok(block.includes('claim of ea.') && block.includes('reason of eb.'));
  assert.ok(!block.includes('claim of ec.'), 'an entry outside the neighbourhood never reaches the prompt');
  assert.deepEqual(decidedFor(ENTRIES, '0 files:\n', reader(tree())).inject, [], 'an empty neighbourhood injects nothing');
  assert.throws(() => decidedBlock([]), /at least one entry/);
});

test('expiry: a changed contentHash drops the entry, a change elsewhere in the file or a hash of another file does not', () => {
  const changed = tree({ 'src/a.ts': A_TS.replace('a + 1', 'a * 2') });
  const d = decidedFor(ENTRIES, SCOPE, reader(changed));
  assert.deepEqual(d.inject.map((e) => e.id), ['eb'], 'the entry whose code changed is not injected');
  assert.deepEqual(d.expired.map((e) => e.id), ['ea']);
  assert.ok(!decidedBlock(d.inject).includes('claim of ea.'));
  const elsewhere = tree({ 'src/a.ts': `${A_TS}\nexport const ADDED = 1;\n` });
  assert.deepEqual(decidedFor(ENTRIES, SCOPE, reader(elsewhere)).inject.map((e) => e.id), ['ea', 'eb']);
  const gone = tree({ 'src/b.ts': B_TS.replace('function delta', 'function deltaRenamed') });
  assert.deepEqual(decidedFor(ENTRIES, SCOPE, reader(gone)).expired.map((e) => e.id), ['eb'], 'a removed symbol expires its entry');
  const missing = tree();
  delete missing['src/a.ts'];
  assert.deepEqual(decidedFor(ENTRIES, SCOPE, reader(missing)).expired.map((e) => e.id), ['ea'], 'a missing file expires its entry');
  const wrongHash = ENTRIES.map((e) => (e.id === 'eb' ? { ...e, contentHash: '0000000000000000' } : e));
  assert.deepEqual(decidedFor(wrongHash, SCOPE, reader(tree())).inject.map((e) => e.id), ['ea']);
});

test('the decided-against arm: own session on the primer, prompt carries the block, no other arm does', () => {
  const a = REFACTOR_ARMS[DECIDED_ARM];
  assert.deepEqual([a.model, a.primer, a.spawn, a.filter, !!a.scout, a.decided], [REFACTOR_ARMS[DECIDED_CONTROL].model, true, false, false, false, true]);
  const block = decidedBlock(decidedFor(ENTRIES, SCOPE, reader(tree())).inject);
  const p = refactorPrompt(DECIDED_ARM, SCOPE, 'P', block);
  assert.deepEqual(promptProblems(DECIDED_ARM, p), []);
  assert.ok(p.indexOf('<metrics-primer>') < p.indexOf('<decided-against>') && p.indexOf('<decided-against>') < p.indexOf('PROPOSALS:'));
  const plain = refactorPrompt(DECIDED_CONTROL, SCOPE, 'P');
  assert.ok(!plain.includes('decided-against'));
  assert.deepEqual(promptProblems(DECIDED_CONTROL, plain), []);
  assert.equal(p.replace(`${block}\n\n`, ''), plain, 'the two prompts differ only by the block');
  assert.throws(() => refactorPrompt(DECIDED_ARM, SCOPE, 'P'), /needs the decided-against block/);
  assert.throws(() => refactorPrompt(DECIDED_CONTROL, SCOPE, 'P', block), /takes no decided-against block/);
  assert.match(promptProblems(DECIDED_CONTROL, p)[0], /decided-against block/);
  assert.match(promptProblems(DECIDED_ARM, plain)[0], /lacks the decided-against block/);
});

// ---- the stored list -----------------------------------------------------------------------------------------

test('the stored list is well formed: code reference, contentHash, claim and reason on every entry; unique ids', () => {
  const list = loadDecided();
  assert.deepEqual(decidedStoredProblems(list), []);
  assert.equal(list.entries.length, DECIDED_SOURCE.length);
  assert.deepEqual(decidedStoredProblems({ entries: [] }), ['the decided-against list has no entries']);
  const e = list.entries[0];
  assert.match(decidedStoredProblems({ entries: [{ ...e, contentHash: '' }] }).join(), /no contentHash/);
  assert.match(decidedStoredProblems({ entries: [{ ...e, reason: ' ' }] }).join(), /no reason/);
  assert.match(decidedStoredProblems({ entries: [{ ...e, claim: undefined }] }).join(), /no claim/);
  assert.match(decidedStoredProblems({ entries: [{ ...e, file: '' }] }).join(), /no file/);
  assert.match(decidedStoredProblems({ entries: [{ ...e, contentHash: 'xyz' }] }).join(), /16 hex/);
  assert.match(decidedStoredProblems({ entries: [e, e] }).join(), /duplicate id/);
});

test('the stored list holds no expected improvement: no entry matches an expected improvement, its good sample or its text', () => {
  const list = loadDecided();
  for (const c of REFACTOR_CASES) {
    for (const x of list.entries) {
      for (const it of c.samples.good.split('\n').filter((l) => l.startsWith('- '))) assert.ok(!entryMatches(x, it.slice(2)), `${x.id} matches a good sample of ${c.id}`);
      const asProposal = `${x.file}: ${x.kind}: ${x.claim}`;
      assert.ok(!classifyItem(c, asProposal).startsWith('expected:'), `${x.id} is an expected improvement of ${c.id}`);
      for (const ex of c.refactor.expected) assert.ok(!entryMatches(x, `${ex.file.split('|')[0].replace(/\\/g, '')}: ${ex.category}: ${ex.desc}`), `${x.id} matches the description of ${ex.id}`);
    }
  }
});

test('every 073 case gets at least one stored entry for its neighbourhood, and none is injected from outside it', () => {
  const list = loadDecided();
  const cases = selectRefactorCases('', '073');
  assert.deepEqual(cases.map((c) => c.id), ['f-r5-plugin-scripts-05d5b76', 'f-s5-titlecase-copies', 'f-c2-session-ipc', 'f-l1-tasks-sections', 'f-l3-atomic-json-writes']);
  for (const c of cases) {
    const files = new Set(scopeFiles(storedScope(c.id)));
    const reachable = list.entries.filter((e) => files.has(e.file));
    assert.ok(reachable.length >= 1, `${c.id} has no entry to inject`);
    assert.ok(reachable.length < list.entries.length, `${c.id} would get the whole list`);
    // a reader that returns each entry's own hash-matching text is not available offline: assert on the scope filter
    const d = decidedFor(list.entries, storedScope(c.id), () => null);
    assert.deepEqual(d.inject, [], 'no code to hash: nothing is injected');
    assert.deepEqual(d.expired.map((e) => e.id), reachable.map((e) => e.id), 'exactly the neighbourhood entries are candidates');
    assert.deepEqual(d.outside.map((e) => e.id), list.entries.filter((e) => !files.has(e.file)).map((e) => e.id));
  }
  assert.equal(selectRefactorCases('', '071').length, 6, 'the 071 set is unchanged');
  assert.ok(!selectRefactorCases('', '073').some((c) => c.id === 'f-l2-session-sweep'), 'f-l2 has nothing to inject and stays out');
});

test('073 plants on the pinned tree: a planted tree reads the stored hashes, so each case injects its whole neighbourhood; a plant on an entry symbol expires it (skipped without a maestro checkout)', (t) => {
  let dir;
  try { dir = resolveMaestroDir(); } catch { t.skip('no maestro checkout'); return; }
  if (spawnSync('git', ['-C', dir, 'cat-file', '-e', `${PINNED}^{commit}`]).status !== 0) { t.skip(`maestro has no ${PINNED}`); return; }
  const list = loadDecided();
  const root = mkdtempSync(join(tmpdir(), 'decided073-'));
  try {
    const plantedTree = (id, scope, plant) => {
      const ws = join(root, id);
      for (const f of scopeFiles(scope)) {
        const r = spawnSync('git', ['-C', dir, 'show', `${PINNED}:${f}`], { encoding: 'utf8', maxBuffer: 1 << 26 });
        assert.equal(r.status, 0, `${id}: ${f} is not in ${PINNED}`);
        mkdirSync(dirname(join(ws, f)), { recursive: true });
        writeFileSync(join(ws, f), r.stdout);
      }
      applyReplacements(ws, plant, id);
      return (f) => (existsSync(join(ws, f)) ? readFileSync(join(ws, f), 'utf8') : null);
    };
    for (const c of selectRefactorCases('', '073')) {
      const scope = storedScope(c.id);
      const files = scopeFiles(scope);
      const d = decidedFor(list.entries, scope, plantedTree(c.id, scope, c.refactor.plant || []));
      assert.deepEqual(d.expired.map((e) => e.id), [], `${c.id}: a plant expires a stored entry`);
      assert.deepEqual(d.inject.map((e) => e.id), list.entries.filter((e) => files.includes(e.file)).map((e) => e.id), `${c.id}: not the whole neighbourhood`);
    }
    // negative control: a plant that changes an entry's own declaration line expires that entry, and only that one
    const c = selectRefactorCases('', '073')[0];
    const scope = storedScope(c.id);
    const target = list.entries.find((e) => scopeFiles(scope).includes(e.file));
    const pinned = spawnSync('git', ['-C', dir, 'show', `${PINNED}:${target.file}`], { encoding: 'utf8', maxBuffer: 1 << 26 }).stdout;
    const decl = symbolText(pinned, target.symbol).split('\n')[0];
    const touch = { id: 'negative-control', file: target.file, from: decl, to: `${decl} // touched by the negative control` };
    const d = decidedFor(list.entries, scope, plantedTree('negative', scope, [...(c.refactor.plant || []), touch]));
    assert.deepEqual(d.expired.map((e) => e.id), [target.id], 'a plant on the declaration expires exactly that entry');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the stored hashes are those of the pinned maestro tree (skipped without a maestro checkout)', (t) => {
  let dir;
  try { dir = resolveMaestroDir(); } catch { t.skip('no maestro checkout'); return; }
  if (spawnSync('git', ['-C', dir, 'cat-file', '-e', `${PINNED}^{commit}`]).status !== 0) { t.skip(`maestro has no ${PINNED}`); return; }
  const show = (f) => { const r = spawnSync('git', ['-C', dir, 'show', `${PINNED}:${f}`], { encoding: 'utf8', maxBuffer: 1 << 26 }); return r.status === 0 ? r.stdout : null; };
  assert.deepEqual(buildList(show), JSON.parse(readFileSync(join(here, 'refactor', 'decided-against.json'), 'utf8')));
});

// ---- repeats, verdict, report --------------------------------------------------------------------------------

test('cellRepeats: counts the distinct listed entries the proposals repeat, never an expected one, and the new findings', () => {
  const c = caseOf('f-l1-tasks-sections');
  const list = loadDecided();
  const ids = list.entries.filter((e) => ['uninstall-find-tasks-is-list-task-files', 'claims-task-claim-built-by-hand'].includes(e.id)).map((e) => e.id);
  const items = [
    'apps/maestro/src/core/uninstall.ts: dedupe: `findMaestroTasks` re-implements `listTaskFiles` from tasks.ts; export it and reuse it.',
    'apps/maestro/src/core/uninstall.ts: dedupe: `findMaestroTasks` re-implements `listTaskFiles` of tasks.ts, readdir and sort.',
    'apps/maestro/src/core/claims.ts: dedupe: the `TaskClaim` object is built by hand three times; add `toTaskClaim`.',
    'apps/maestro/src/core/tasks.ts: dedupe: `buildStatusMap` and `tasksFromFiles` both write the ready/blocked decision `blockedBy.every(...)`; extract one helper.',
    'apps/maestro/src/core/tasks.ts: extract-helper: `closeTask` and `deleteTask` repeat the recompute-cascade sequence.',
  ];
  const r = cellRepeats(c, items, list.entries, ids);
  assert.deepEqual(r, { repeated: 2, repeatProposals: 3, fresh: 1 }, 'the expected ready rule is neither a repeat nor new; closeTask is new');
  assert.deepEqual(cellRepeats(c, items, list.entries, []), { repeated: 0, repeatProposals: 0, fresh: 1 }, 'an entry not listed for the cell is not counted');
});

test('decidedVerdict: the pre-registered rule, in order', () => {
  const ctl = { cells: 30, repeated: 40, found: 40, planted: 48, fresh: 100, cost: 1, repeatProposals: 40 };
  const arm = (o) => ({ ...ctl, ...o });
  assert.equal(decidedVerdict(ctl, arm({ cells: 29 })).v, 'not comparable');
  assert.equal(decidedVerdict(arm({ repeated: MIN_CONTROL_REPEATS - 1 }), arm({ repeated: 0 })).v, 'inconclusive');
  assert.equal(decidedVerdict(ctl, arm({ repeated: 21 })).v, 'no cut shown');
  assert.equal(decidedVerdict(ctl, arm({ repeated: 20 })).v, 'cuts repeats and keeps recall');
  assert.equal(decidedVerdict(ctl, arm({ repeated: 20, found: 36 })).v, 'cuts repeats and keeps recall', '90% of the control found is allowed');
  assert.equal(decidedVerdict(ctl, arm({ repeated: 20, found: 35 })).v, 'cuts repeats but loses recall');
  assert.equal(decidedVerdict(ctl, arm({ repeated: 20, fresh: 49 })).v, 'cuts repeats but over-broad');
  assert.equal(decidedVerdict(ctl, arm({ repeated: 20, fresh: 50 })).v, 'cuts repeats and keeps recall');
  assert.equal(decidedVerdict(ctl, arm({ repeated: 20, found: 30, fresh: 10 })).v, 'cuts repeats but loses recall', 'a recall loss comes before the over-broad check');
});

test('decidedReport: paired cells only, both arms in the table, the verdict and the pilot screen', () => {
  const c = caseOf('f-l1-tasks-sections');
  const list = loadDecided();
  const listed = ['uninstall-find-tasks-is-list-task-files'];
  const rep = 'apps/maestro/src/core/uninstall.ts: dedupe: `findMaestroTasks` re-implements `listTaskFiles` from tasks.ts.';
  const row = (arm, run, items, o = {}) => ({ case: c.id, arm, run, status: 'valid', problems: [], m: { cost: 0.02 }, grade: { items, found: 1, planted: 2, decided: { listed, injected: arm === DECIDED_ARM ? listed : undefined }, ...o } });
  const rows = [row(DECIDED_CONTROL, 1, [rep]), row(DECIDED_ARM, 1, []), row(DECIDED_CONTROL, 2, [rep]), { ...row(DECIDED_ARM, 2, []), status: 'invalid', problems: ['x'] }];
  const planned = rows.map(({ case: cs, arm, run }) => ({ case: cs, arm, run }));
  const md = decidedReport(rows, planned, new Map([[c.id, c]]), list.entries);
  assert.match(md, /\| haiku-metrics-primer \| 1 \| 1 \| 1 \|/, 'only run 1 is paired');
  assert.match(md, /\| haiku-decided-against \| 1 \| 0 \| 0 \|/);
  assert.match(md, /Verdict .*\*\*inconclusive\*\*/, 'one repeat is under the minimum');
  assert.match(md, /Pilot screen .*repeated 1 listed entries over 1 cells; the plan stops under 5: STOP/);
  assert.match(md, /1 invalid run\(s\) are not counted/);
  assert.match(decidedReport([], [], new Map(), list.entries), /No paired valid cell/);
});
