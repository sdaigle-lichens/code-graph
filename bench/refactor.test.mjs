import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATEGORIES, DEFAULT_REFACTOR_ARMS, DEFAULT_REFACTOR_RUNS, OPT_IN_REFACTOR_ARMS, REFACTOR_ARMS, REFACTOR_ARM_NAMES, REFACTOR_BASELINE, anchoring, buildMetricsPrimer, buildScope,
  falseVerdict, filterPrompt, findCycles, gradeItems, gradePipeline, gradeRefactor, isAllClear, neighbourFiles, parseRefactorArms, pilotScreen, promptProblems, proposalCategory, answerProblems, proposalsOf,
  refactorArgs, refactorPrompt, refactorReport, rowCost, stageProblems, stageSpec, stagesOf, storedProblems, tally, unusedExports, verdictsOf,
} from './refactor.mjs';
import { REFACTOR_CASES, selectRefactorCases } from './refactor-cases.mjs';
import { findingsOf } from './review.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const stored = (id, ext) => readFileSync(join(here, 'refactor', `${id}.${ext}`), 'utf8');
const caseOf = (id) => REFACTOR_CASES.find((c) => c.id === id);
const AGENT_INIT = (model, tools) => ({ init: { model, tools } });

test('arms: the four arms in table order, unknown or empty throws, default is the three without the opt-in spawn arm, 2 runs', () => {
  assert.deepEqual(REFACTOR_ARM_NAMES, ['sonnet-plain', 'haiku-metrics-primer', 'haiku-scout-sonnet-filter', 'sonnet-spawns-haiku-scouts']);
  assert.deepEqual(OPT_IN_REFACTOR_ARMS, ['sonnet-spawns-haiku-scouts']);
  assert.equal(DEFAULT_REFACTOR_ARMS, 'sonnet-plain,haiku-metrics-primer,haiku-scout-sonnet-filter');
  assert.deepEqual(parseRefactorArms(DEFAULT_REFACTOR_ARMS).includes('sonnet-spawns-haiku-scouts'), false);
  assert.deepEqual(parseRefactorArms(REFACTOR_ARM_NAMES.join(',')), REFACTOR_ARM_NAMES, 'the spawn arm is still accepted when named');
  assert.equal(DEFAULT_REFACTOR_RUNS, '2');
  assert.equal(REFACTOR_BASELINE, 'sonnet-plain');
  assert.deepEqual(parseRefactorArms('haiku-metrics-primer,sonnet-plain'), ['sonnet-plain', 'haiku-metrics-primer']);
  assert.throws(() => parseRefactorArms('sonnet-plain,opus'), /unknown refactor arm/);
  assert.throws(() => parseRefactorArms(''), /no arm/);
});

test('refactorArgs: each session pins its model and an exact tool set; only the spawn arm has Agent; the cap is the caller\'s', () => {
  const a = (arm, stage = stagesOf(arm)[0]) => refactorArgs(arm, stage, 'P', { runBudget: '1.5' });
  const flag = (args, f) => args[args.indexOf(f) + 1];
  assert.equal(flag(a('sonnet-plain'), '--model'), 'claude-sonnet-5-5');
  assert.equal(flag(a('haiku-metrics-primer'), '--model'), 'claude-haiku-5-5');
  assert.equal(flag(a('haiku-scout-sonnet-filter', 'scout'), '--model'), 'claude-haiku-5-5');
  assert.equal(flag(a('haiku-scout-sonnet-filter', 'filter'), '--model'), 'claude-sonnet-5-5');
  for (const [arm, stage] of [['sonnet-plain', 'main'], ['haiku-metrics-primer', 'main'], ['haiku-scout-sonnet-filter', 'scout'], ['haiku-scout-sonnet-filter', 'filter']]) {
    assert.equal(flag(a(arm, stage), '--tools'), 'Bash,Read,Grep,Glob,Skill', `${arm} ${stage}`);
  }
  assert.equal(flag(a('sonnet-spawns-haiku-scouts'), '--tools'), 'Bash,Read,Grep,Glob,Skill,Agent');
  assert.equal(flag(a('sonnet-spawns-haiku-scouts'), '--allowedTools'), 'Bash,Read,Grep,Glob,Skill,Agent');
  assert.equal(flag(a('sonnet-plain'), '--max-budget-usd'), '1.5');
  assert.ok(!a('sonnet-plain').includes('--plugin-dir'));
  assert.deepEqual(stagesOf('haiku-scout-sonnet-filter'), ['scout', 'filter']);
  assert.deepEqual(stagesOf('sonnet-plain'), ['main']);
  assert.throws(() => stageSpec('nope', 'main'), /unknown refactor arm/);
});

const SCOPE = stored('f-r5-plugin-scripts-05d5b76', 'scope.txt');
const PRIMER = stored('f-r5-plugin-scripts-05d5b76', 'primer.txt');

test('refactorPrompt: the neighbourhood and format in every arm, the primer only in primer arms, the spawn paragraph only in the spawn arm', () => {
  for (const arm of REFACTOR_ARM_NAMES) {
    const p = refactorPrompt(arm, SCOPE, REFACTOR_ARMS[arm].primer ? PRIMER : '');
    assert.match(p, /<neighbourhood>[\s\S]*maestro-resume-target\.cjs[\s\S]*<\/neighbourhood>/);
    assert.match(p, /`PROPOSALS:`/);
    assert.equal(p.includes('<metrics-primer>'), REFACTOR_ARMS[arm].primer, arm);
    assert.equal(p.includes('Haiku subagents'), REFACTOR_ARMS[arm].spawn, arm);
    assert.deepEqual(promptProblems(arm, p), [], arm);
  }
  assert.throws(() => refactorPrompt('haiku-metrics-primer', SCOPE, ''), /needs the stored metrics primer/);
  assert.throws(() => refactorPrompt('nope', SCOPE), /unknown refactor arm/);
  assert.match(promptProblems('sonnet-plain', refactorPrompt('haiku-metrics-primer', SCOPE, PRIMER))[0], /carries a metrics primer/);
  assert.match(promptProblems('haiku-metrics-primer', refactorPrompt('sonnet-plain', SCOPE))[0], /no metrics primer/);
  assert.match(promptProblems('sonnet-plain', refactorPrompt('sonnet-spawns-haiku-scouts', SCOPE))[0], /spawn subagents/);
});

test('refactorPrompt: nothing in a prompt reveals the expected improvement, the plant or the source commit', () => {
  for (const c of REFACTOR_CASES) {
    const p = refactorPrompt('haiku-metrics-primer', stored(c.id, 'scope.txt'), stored(c.id, 'primer.txt'));
    for (const e of c.refactor.expected) assert.ok(!p.includes(e.id) && !p.includes(e.desc), `${c.id} leaks ${e.id}`);
    assert.ok(!/refactor: |seeded:|reverted|source commit|touched/i.test(stored(c.id, 'scope.txt')), `${c.id} scope labels the touched files`);
  }
});

test('filterPrompt: numbered proposals, file-it or drop-it only, no verdict on the change, no additions; empty list throws', () => {
  const p = filterPrompt(SCOPE, ['a.ts: dedupe: x', 'b.ts: break-cycle: y']);
  assert.match(p, /<scout-proposals>\n1\. a\.ts: dedupe: x\n2\. b\.ts: break-cycle: y\n<\/scout-proposals>/);
  assert.match(p, /`VERDICTS:`/);
  assert.match(p, /file-it/);
  assert.match(p, /drop-it/);
  assert.match(p, /Do not give a verdict on the change/);
  assert.match(p, /do not add suggestions of your own/);
  assert.throws(() => filterPrompt(SCOPE, []), /at least one proposal/);
});

test('the case set: reverted real refactors naming a source commit, seeded problems of every kind, clean neighbourhoods', () => {
  const kinds = (k) => REFACTOR_CASES.filter((c) => c.kind === k);
  assert.equal(REFACTOR_CASES.length, 6);
  assert.equal(kinds('real').length, 1);
  assert.equal(kinds('seeded').length, 2);
  assert.equal(kinds('clean').length, 3);
  for (const c of kinds('real')) assert.match(c.refactor.source, /^maestro [0-9a-f]{7} "/, `${c.id} names its source commit`);
  const cats = new Set(REFACTOR_CASES.flatMap((c) => c.refactor.expected.map((e) => e.category)));
  assert.deepEqual([...cats].sort(), ['align', 'cycle', 'dedupe'], 'the reworked set covers dedupe, align and cycle; unused and extract are no longer planted');
  for (const k of cats) assert.ok(CATEGORIES.includes(k));
  for (const c of kinds('clean')) { assert.deepEqual(c.refactor.expected, []); assert.deepEqual(c.refactor.plant, []); assert.ok(c.refactor.touched.length); }
  for (const c of [...kinds('real'), ...kinds('seeded')]) { assert.ok(c.refactor.plant.length, c.id); assert.ok(c.refactor.expected.length >= 1, c.id); }
  assert.equal(caseOf('f-r5-plugin-scripts-05d5b76').refactor.expected.length, 3, 'the real case plants three improvements');
  assert.equal(caseOf('f-s5-titlecase-copies').refactor.expected.length, 1);
  assert.equal(caseOf('f-s6-cycle-tasks-session-paths').refactor.expected.length, 1);
  assert.deepEqual(new Set(REFACTOR_CASES.map((c) => c.id)).size, REFACTOR_CASES.length, 'ids are unique');
  assert.deepEqual(selectRefactorCases('f-r5,f-c4').map((c) => c.id), ['f-r5-plugin-scripts-05d5b76', 'f-c4-plugin-scripts']);
  assert.equal(selectRefactorCases('').length, 6);
});

test('graders: a known-good text credits its expected improvement with no false finding; a known-bad one credits nothing', () => {
  for (const c of REFACTOR_CASES) {
    const good = gradeRefactor(c, c.samples.good);
    const bad = gradeRefactor(c, c.samples.bad);
    assert.equal(good.found, good.planted, `${c.id} good`);
    assert.equal(good.falseFindings, 0, `${c.id} good false findings`);
    assert.equal(bad.found, 0, `${c.id} bad credits nothing`);
    assert.equal(bad.structured, true);
    assert.ok(bad.falseFindings >= 1, `${c.id} bad counts false findings, on every case kind`);
  }
});

test('graders: each expected improvement is credited by its own description, and by no other case\'s', () => {
  for (const c of REFACTOR_CASES) for (const e of c.refactor.expected) {
    assert.ok(gradeItems(c, [`${e.file.split('|')[0].replace(/\\/g, '')}: ${e.desc}`]).found === 1, `${e.id} is credited by its description`);
    for (const o of REFACTOR_CASES) {
      if (o === c || !o.refactor.expected.length) continue;
      assert.equal(gradeRefactor(o, c.samples.good).found, 0, `${c.id} good text credits ${o.id}`);
    }
  }
});

test('graders: a proposal for another file that only mentions the right file, or the right file with the wrong change, is not credited', () => {
  const c = caseOf('f-r5-plugin-scripts-05d5b76');
  assert.equal(gradeItems(c, ['plugins/maestro/scripts/maestro-check-runtime.cjs: dedupe: has its own readLogLines like maestro-resume-target.cjs, require it from the lib.']).found, 0, 'the check-runtime file with a readLogLines change is not the copies improvement');
  assert.equal(gradeItems(c, ['plugins/maestro/scripts/maestro-resume-target.cjs: extract-helper: split the file in two.']).found, 0);
  assert.equal(gradeItems(c, ['plugins/maestro/scripts/maestro-resume-target.cjs readLogLines dedupe is fine as written.']).found, 0, 'an unshaped all-clear sentence is not a proposal');
  assert.equal(gradeItems(c, ['plugins/maestro/scripts/maestro-check-runtime.cjs: align-pattern: use runtimeNeedsRefresh, the inline stale rule repeats it.']).found, 1);
  assert.equal(gradeItems(c, ['plugins/maestro/scripts/maestro-inject-agent-context.js: dedupe: payloadRoutes is resolved twice, resolve once.']).found, 1);
});

test('graders: the three improvements of the real case are credited independently', () => {
  const c = caseOf('f-r5-plugin-scripts-05d5b76');
  assert.equal(gradeRefactor(c, 'PROPOSALS:\n- plugins/maestro/scripts/maestro-subagent-log.js: dedupe: readLogLines is a copy of the lib one, require it.').found, 1);
  assert.equal(gradeRefactor(c, c.samples.good).found, 3);
  assert.equal(gradeRefactor(c, c.samples.bad).found, 0);
});

test('graders: the cycle case needs the cycle named; the seeded unused wrapper and the real pre-existing pair are tolerated', () => {
  const cyc = caseOf('f-s6-cycle-tasks-session-paths');
  assert.equal(gradeItems(cyc, ['apps/maestro/src/core/session-paths.ts: align-pattern: rename the helper']).found, 0);
  assert.equal(gradeItems(cyc, ['apps/maestro/src/core/session-paths.ts: break-cycle: it imports tasks.ts, which imports claims.ts, which imports session-paths.ts: a circular import.']).found, 1);
  const g = gradeItems(cyc, ['apps/maestro/src/core/session-paths.ts: remove-unused: `sessionTasksDir` is unused, nothing imports it.']);
  assert.equal(g.tolerated, 1);
  assert.equal(g.falseFindings, 0, 'a tolerated match is not a false finding');
  const dup = caseOf('f-s5-titlecase-copies');
  assert.equal(gradeItems(dup, ['apps/maestro/src/core/epics.ts: dedupe: epicTitle re-implements titleFromName from text.ts, import it.']).found, 1);
  const t = gradeItems(dup, ['apps/maestro/src/core/tasks.ts: dedupe: parseTitle repeats taskHeading of session-title.ts.']);
  assert.equal(t.tolerated, 1);
  assert.equal(t.falseFindings, 0);
  const c2 = gradeItems(caseOf('f-c2-session-ipc'), ['apps/maestro/src/core/tasks.ts: dedupe: parseTitle repeats taskHeading of session-title.ts.']);
  assert.equal(c2.tolerated, 1, 'the real pair is tolerated on the clean control that contains it');
  assert.equal(c2.falseFindings, 0);
});

test('graders: "none", an all-clear and prose outside PROPOSALS credit nothing; every case counts each proposal beyond the expected ones as a false finding, by category', () => {
  const real = caseOf('f-s5-titlecase-copies');
  const clean = caseOf('f-c1-canvas-layout');
  const none = gradeRefactor(clean, 'Nothing warranted.\n\nPROPOSALS: none');
  assert.equal(none.proposals, 0);
  assert.equal(none.falseFindings, 0);
  assert.equal(none.none, true);
  assert.equal(gradeRefactor(real, 'PROPOSALS: none').found, 0);
  assert.equal(gradeRefactor(real, 'epics.ts duplicates titleFromName of text.ts as epicTitle; import the shared one.').found, 0, 'prose with no PROPOSALS bullet and no header is not a proposal list');
  const two = gradeRefactor(clean, 'PROPOSALS:\n- a.ts: dedupe: x\n- b.ts: dedupe: y');
  assert.equal(two.falseFindings, 2);
  const r = gradeRefactor(real, `${real.samples.good}\n- apps/maestro/src/core/other.ts: dedupe: something else`);
  assert.equal(r.found, 1);
  assert.equal(r.falseFindings, 1, 'a proposal beyond the expected ones on a non-clean case is a false finding too');
  assert.deepEqual(r.falseByCat, { dedupe: 1 });
  const mixed = gradeRefactor(real, `${real.samples.good}\n- a.ts: remove-unused: x\n- b.ts: break-cycle: y\n- c.ts: extract-helper: z\n- d.ts: align-pattern: w\n- e.ts: rename: v`);
  assert.deepEqual(mixed.falseByCat, { unused: 1, cycle: 1, extract: 1, align: 1, other: 1 });
  assert.equal(proposalCategory('a.ts: dedupe: x'), 'dedupe');
  const wrapped = gradeRefactor(real, 'PROPOSALS:\n- apps/maestro/src/core/epics.ts: dedupe: it defines its own\n  `epicTitle`, which re-implements `titleFromName` in `core/text.ts`; import it.');
  assert.equal(wrapped.found, 1, 'a wrapped bullet is one proposal');
});

test('findingsOf with a header: PROPOSALS and VERDICTS are read like FINDINGS, the last header wins', () => {
  assert.deepEqual(findingsOf('PROPOSALS:\n- a\n- b', 'PROPOSALS').items, ['a', 'b']);
  assert.deepEqual(findingsOf('**PROPOSALS:**\n1. a\n\nPROPOSALS:\n- c', 'PROPOSALS').items, ['c']);
  assert.equal(findingsOf('FINDINGS:\n- a', 'PROPOSALS').structured, false);
  assert.deepEqual(findingsOf('FINDINGS:\n- a').items, ['a'], 'the default header is unchanged');
});

test('verdictsOf: file-it and drop-it per numbered proposal; an unmarked one does not survive; a number outside the list is counted, not kept', () => {
  const v = verdictsOf('thoughts\n\nVERDICTS:\n- 1: file-it: real duplicate\n- 2: drop-it: taste\n- 4: file-it: made up', 3);
  assert.deepEqual(v.kept, [1]);
  assert.deepEqual(v.dropped, [2]);
  assert.deepEqual(v.unmarked, [3]);
  assert.equal(v.outOfList, 1);
  assert.equal(v.structured, true);
  const loose = verdictsOf('VERDICTS:\n1. **file-it** - yes\n2) Drop it: no\n3: drop-it, but file-it later', 3);
  assert.deepEqual(loose.kept, [1]);
  assert.deepEqual(loose.dropped, [2, 3], '"Drop it" with a space reads as drop-it; the first verdict word on a line wins');
  assert.deepEqual(loose.unmarked, []);
});

test('verdictsOf: the first line for a proposal wins; no VERDICTS section marks nothing', () => {
  const v = verdictsOf('VERDICTS:\n- 1: file-it: ok\n- 1: drop-it: changed my mind', 1);
  assert.deepEqual(v.kept, [1]);
  assert.deepEqual(v.dropped, []);
  const none = verdictsOf('I approve the change as a whole.', 2);
  assert.equal(none.structured, false);
  assert.deepEqual(none.kept, []);
  assert.deepEqual(none.unmarked, [1, 2]);
});

test('anchoring: survivors over the scout list; unchanged only when everything passed; null when the scout proposed nothing', () => {
  assert.deepEqual(anchoring(4, { kept: [1, 2], dropped: [3], unmarked: [4], outOfList: 1 }), { scout: 4, kept: 2, dropped: 1, unmarked: 1, outOfList: 1, rate: 0.5, unchanged: false });
  assert.equal(anchoring(2, { kept: [1, 2], dropped: [], unmarked: [], outOfList: 0 }).unchanged, true);
  assert.equal(anchoring(2, { kept: [1, 2], dropped: [], unmarked: [], outOfList: 0 }).rate, 1);
  assert.equal(anchoring(0, null).rate, null);
  assert.equal(anchoring(0, null).unchanged, false);
  assert.equal(anchoring(3, null).kept, 0);
});

test('gradePipeline: scored on the survivors; the filter\'s losses and removals are counted; a skipped filter keeps nothing', () => {
  const c = caseOf('f-s5-titlecase-copies');
  const scout = `PROPOSALS:\n- ${c.samples.good.split('\n')[1].slice(2)}\n- apps/maestro/src/core/epics.ts: extract-helper: split the file.`;
  const keepGood = gradePipeline(c, scout, 'VERDICTS:\n- 1: file-it: yes\n- 2: drop-it: no');
  assert.equal(keepGood.found, 1);
  assert.equal(keepGood.falseFindings, 0, 'the false proposal was filtered out');
  assert.equal(keepGood.scout.falseFindings, 1);
  assert.equal(keepGood.falseRemoved, 1);
  const kept2 = gradePipeline(c, scout, 'VERDICTS:\n- 1: file-it\n- 2: file-it');
  assert.equal(kept2.falseFindings, 1, 'a false finding the filter kept is counted on a non-clean case');
  assert.deepEqual(kept2.falseByCat, { extract: 1 });
  assert.equal(keepGood.anchor.kept, 1);
  assert.equal(keepGood.anchor.scout, 2);
  assert.equal(keepGood.lostByFilter, 0);
  const lost = gradePipeline(c, scout, 'VERDICTS:\n- 1: drop-it: no\n- 2: drop-it: no');
  assert.equal(lost.found, 0);
  assert.equal(lost.lostByFilter, 1);
  const stamp = gradePipeline(c, scout, 'VERDICTS:\n- 1: file-it\n- 2: file-it');
  assert.equal(stamp.anchor.unchanged, true);
  assert.equal(stamp.found, 1);
  const skipped = gradePipeline(c, scout, null);
  assert.equal(skipped.found, 0);
  assert.equal(skipped.verdicts, null);
  const clean = caseOf('f-c1-canvas-layout');
  const cl = gradePipeline(clean, 'PROPOSALS:\n- a.ts: dedupe: x\n- b.ts: dedupe: y', 'VERDICTS:\n- 1: file-it\n- 2: drop-it');
  assert.equal(cl.falseFindings, 1);
  assert.equal(cl.scout.falseFindings, 2);
  assert.equal(cl.falseRemoved, 1);
  const empty = gradePipeline(clean, 'PROPOSALS: none', null);
  assert.equal(empty.proposals, 0);
  assert.equal(empty.anchor.rate, null);
});

test('gradePipeline: a filter answer with no VERDICTS header keeps nothing (fails closed) and the expected improvement counts as lost', () => {
  const c = caseOf('f-s5-titlecase-copies');
  const scout = `PROPOSALS:\n- ${c.samples.good.split('\n')[1].slice(2)}\n- apps/maestro/src/core/epics.ts: extract-helper: split the file.`;
  const prose = gradePipeline(c, scout, 'I approve this list, both proposals are real.');
  assert.equal(prose.verdicts.structured, false);
  assert.equal(prose.anchor.kept, 0);
  assert.equal(prose.anchor.unmarked, 2);
  assert.equal(prose.anchor.unchanged, false);
  assert.equal(prose.found, 0);
  assert.equal(prose.falseFindings, 0);
  assert.equal(prose.lostByFilter, 1);
});

test('gradeRefactor: an answer with no PROPOSALS header is unstructured and proposes nothing; it is not a "none"', () => {
  const c = caseOf('f-s5-titlecase-copies');
  const g = gradeRefactor(c, 'epics.ts duplicates titleFromName of text.ts as epicTitle; import the shared one.');
  assert.equal(g.structured, false);
  assert.equal(g.none, false);
  assert.equal(g.proposals, 0);
  assert.equal(g.found, 0);
});

test('answerProblems: an unstructured answer or filter answer is a run problem; a structured one, even "none", is not', () => {
  const c = caseOf('f-s5-titlecase-copies');
  assert.match(answerProblems('sonnet-plain', gradeRefactor(c, 'prose only'))[0], /no PROPOSALS section/);
  assert.deepEqual(answerProblems('sonnet-plain', gradeRefactor(c, 'PROPOSALS: none')), []);
  const scout = `PROPOSALS:\n- ${c.samples.good.split('\n')[1].slice(2)}`;
  assert.match(answerProblems('haiku-scout-sonnet-filter', gradePipeline(c, scout, 'I approve'))[0], /no VERDICTS section/);
  assert.deepEqual(answerProblems('haiku-scout-sonnet-filter', gradePipeline(c, scout, 'VERDICTS:\n- 1: file-it')), []);
});

test('all-clear text is its own count: not credited, not a proposal, not a false finding; header-line and bullet forms, prose after the header', () => {
  const c = caseOf('f-c1-canvas-layout');
  const forms = [
    'PROPOSALS: no proposals',
    'PROPOSALS:\n- Leave it as is.',
    'PROPOSALS:\n- No issues found.',
    'PROPOSALS:\n- Not needed.',
    'PROPOSALS:\n- Nothing found.',
    'PROPOSALS:\n- none',
    'PROPOSALS: nothing to do',
    'PROPOSALS: No refactor is warranted.',
    'PROPOSALS:\n- nothing to change here',
    'PROPOSALS: The neighbourhood looks fine, I would leave it alone.',
  ];
  for (const f of forms) {
    const g = gradeRefactor(c, f);
    assert.equal(g.falseFindings, 0, f);
    assert.equal(g.proposals, 0, f);
    assert.equal(g.allClear, 1, f);
    assert.equal(g.structured, true, f);
  }
  const none = gradeRefactor(c, 'PROPOSALS: none');
  assert.equal(none.allClear, 0);
  assert.equal(none.none, true);
  const r = caseOf('f-s5-titlecase-copies');
  const g = gradeRefactor(r, 'PROPOSALS: nothing to do');
  assert.equal(g.found, 0, 'a legitimate zero on a case with expected improvements');
  assert.equal(g.falseFindings, 0);
  const mixed = gradeRefactor(r, `${r.samples.good}\n- nothing to change here\n- a.ts: dedupe: x`);
  assert.equal(mixed.found, 1);
  assert.equal(mixed.allClear, 1);
  assert.equal(mixed.falseFindings, 1);
  assert.equal(mixed.proposals, 2);
  assert.equal(gradeItems(r, ['nothing to change here']).allClear, 1);
  assert.equal(proposalsOf('PROPOSALS: no proposals').items.length, 0);
});

test('a proposal in the <file>: <kind>: shape is never an all-clear, whatever words its text holds', () => {
  const r = caseOf('f-s5-titlecase-copies');
  const texts = [
    'these are good candidates for one shared helper',
    'not worth keeping, so import the shared one',
    'the export is fine to delete',
    'is OK to keep, but duplicates core/json.ts',
    'has no duplication needed elsewhere',
    'is intended to be shared',
    'this module is fine as written, nothing to do.',
  ];
  for (const t of texts) {
    const item = `src/a.ts: dedupe: ${t}`;
    assert.equal(isAllClear(item), false, item);
    const p = proposalsOf(`PROPOSALS:\n- ${item}`);
    assert.equal(p.items.length, 1, item);
    assert.equal(p.allClear, 0, item);
    const g = gradeItems(r, p.items);
    assert.equal(g.falseFindings, 1, item);
    assert.equal(g.allClear, 0, item);
  }
  const none = proposalsOf('PROPOSALS:\n- none-helpers.ts: dedupe: merge x');
  assert.equal(none.items.length, 1);
  assert.equal(none.allClear, 0);
  assert.equal(isAllClear('none'), true);
  assert.equal(isAllClear('None.'), true);
});

test('gradeItems still credits an expected improvement worded "is OK to keep, but duplicates"', () => {
  const r = caseOf('f-s5-titlecase-copies');
  const x = r.refactor.expected[0];
  const item = r.samples.good.split('\n')[1].slice(2).replace(': ', ': ').replace(/^([^:]+: [a-z-]+: )/, '$1is OK to keep, but duplicates: ');
  const g = gradeItems(r, [item]);
  assert.equal(g.credited, 1, item);
  assert.equal(g.found, 1);
  assert.ok(x);
});

test('a bullet on the PROPOSALS: header line is the first item; header prose naming a path is one item, not an all-clear', () => {
  const b = proposalsOf('PROPOSALS: - a.ts: dedupe: x');
  assert.deepEqual(b.items, ['a.ts: dedupe: x']);
  assert.equal(b.allClear, 0);
  const n = proposalsOf('PROPOSALS: 1. a.ts: dedupe: x\n2. b.ts: dedupe: y');
  assert.equal(n.items.length >= 1, true);
  assert.equal(n.items[0], 'a.ts: dedupe: x');
  const prose = proposalsOf('PROPOSALS: src/a.ts duplicates src/core/json.ts; import it.');
  assert.equal(prose.items.length, 1);
  assert.equal(prose.allClear, 0);
});

test('gradePipeline: all-clear lines never reach the filter and are counted from the scout', () => {
  const c = caseOf('f-c1-canvas-layout');
  const g = gradePipeline(c, 'PROPOSALS:\n- nothing to change here\n- a.ts: dedupe: x', 'VERDICTS:\n- 1: file-it');
  assert.equal(g.allClear, 1);
  assert.equal(g.anchor.scout, 1);
  assert.equal(g.falseFindings, 1);
  assert.equal(gradePipeline(c, 'PROPOSALS: nothing to do', null).allClear, 1);
});

test('refactorPrompt: asks for "PROPOSALS: none" and nothing else when nothing is warranted', () => {
  assert.match(refactorPrompt('sonnet-plain', 'f.ts', ''), /`PROPOSALS: none` and nothing else/);
});

test('refactorReport: an unstructured answer is shown as unstructured, not as a clean run with no proposals', () => {
  const c = caseOf('f-s5-titlecase-copies');
  const row1 = { case: c.id, arm: 'sonnet-plain', run: 1, m: { cost: 0.1, turns: 2 }, problems: [], status: 'valid', grade: gradeRefactor(c, 'prose only, no header') };
  const md = refactorReport([row1], { spent: 0.1, budget: 1, stop: null, planned: [{ case: c.id, arm: 'sonnet-plain', run: 1 }] });
  assert.match(md, /unstructured|not structured|structured: no/i);
});

test('stageProblems: the spawn arm is invalid without a Haiku subagent in the transcript; no other session may call Agent', () => {
  const ok = AGENT_INIT('claude-sonnet-5-5', ['Bash', 'Read', 'Grep', 'Glob', 'Skill', 'Agent']);
  const call = (model) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Agent', input: { model } }] } });
  const sub = (model) => JSON.stringify({ type: 'assistant', parent_tool_use_id: 't1', message: { model, content: [] } });
  assert.deepEqual(stageProblems('sonnet-spawns-haiku-scouts', 'main', ok, [call('haiku'), sub('claude-haiku-5-5')].join('\n')), []);
  assert.match(stageProblems('sonnet-spawns-haiku-scouts', 'main', ok, '')[0], /no Agent call, so no Haiku subagent/);
  assert.match(stageProblems('sonnet-spawns-haiku-scouts', 'main', ok, call('sonnet'))[0], /none started a Haiku subagent/);
  assert.match(stageProblems('sonnet-spawns-haiku-scouts', 'main', ok, [call('haiku'), sub('claude-sonnet-5-5')].join('\n'))[0], /none started a Haiku subagent/, 'what ran wins over what was asked');
  assert.match(stageProblems('sonnet-spawns-haiku-scouts', 'main', AGENT_INIT('claude-sonnet-5-5', ['Bash', 'Read']), call('haiku'))[0], /lack Agent/);
  const plain = AGENT_INIT('claude-sonnet-5-5', ['Bash', 'Read', 'Grep', 'Glob', 'Skill']);
  assert.deepEqual(stageProblems('sonnet-plain', 'main', plain, ''), []);
  assert.match(stageProblems('sonnet-plain', 'main', plain, call('haiku'))[0], /1 Agent call/);
  assert.match(stageProblems('sonnet-plain', 'main', AGENT_INIT('claude-haiku-5-5', ['Bash']), '')[0], /init model/);
  assert.match(stageProblems('sonnet-plain', 'main', AGENT_INIT('claude-sonnet-5-5', ['Bash', 'Agent']), '')[0], /list Agent/);
  assert.match(stageProblems('haiku-scout-sonnet-filter', 'scout', AGENT_INIT('claude-sonnet-5-5', ['Bash']), '')[0], /init model/);
  assert.deepEqual(stageProblems('haiku-scout-sonnet-filter', 'filter', AGENT_INIT('claude-sonnet-5-5', ['Bash', 'Read']), ''), []);
});

test('findCycles: components of more than one file (or a self import), sorted; a chain or a diamond is no cycle', () => {
  const e = (a, b) => ({ from: a, to: b });
  assert.deepEqual(findCycles([e('a', 'b'), e('b', 'a'), e('b', 'c')]), [['a', 'b']]);
  assert.deepEqual(findCycles([e('a', 'b'), e('b', 'c'), e('a', 'c')]), []);
  assert.deepEqual(findCycles([e('x', 'x')]), [['x']]);
  assert.deepEqual(findCycles([e('c', 'd'), e('d', 'e'), e('e', 'c'), e('a', 'b'), e('b', 'a')]), [['a', 'b'], ['c', 'd', 'e']]);
  assert.deepEqual(findCycles([]), []);
});

test('unusedExports: an export is unused when no other file mentions it as a whole word', () => {
  const sources = [{ file: 'a.ts', text: 'export const foo = 1; export const bar = 2;' }, { file: 'b.ts', text: 'import { foo } from "./a"; const foobar = 1;' }];
  assert.deepEqual(unusedExports([{ file: 'a.ts', exports: ['foo', 'bar'] }], sources), [{ file: 'a.ts', name: 'bar' }]);
  assert.deepEqual(unusedExports([{ file: 'a.ts', exports: ['foo'] }], [sources[0]]), [{ file: 'a.ts', name: 'foo' }], 'the file\'s own text does not count');
});

test('neighbourFiles: neighbours the change mentions; else the least imported non-hub neighbours; touched files never repeat', () => {
  const edges = [{ from: 'a.ts', to: 'helpers-core.ts' }, { from: 'a.ts', to: 'other.ts' }, { from: 'z.ts', to: 'a.ts' }, { from: 'a.ts', to: 'hubby.ts' }];
  const exportsOf = { 'other.ts': ['someOtherHelper'], 'helpers-core.ts': ['x'] };
  assert.deepEqual(neighbourFiles({ touched: ['a.ts'], edges, exportsOf, text: 'import { someOtherHelper } from' }), ['other.ts']);
  assert.deepEqual(neighbourFiles({ touched: ['a.ts'], edges, exportsOf, text: 'see helpers-core now' }), ['helpers-core.ts']);
  assert.deepEqual(neighbourFiles({ touched: ['a.ts'], edges, text: '', hubs: ['hubby.ts'], fanIn: { 'other.ts': 5, 'helpers-core.ts': 1, 'z.ts': 2 }, fill: 2 }), ['helpers-core.ts', 'z.ts']);
  assert.deepEqual(neighbourFiles({ touched: ['a.ts', 'z.ts'], edges, text: '', fill: 9, fanIn: {} }).includes('a.ts'), false);
});

test('buildScope and buildMetricsPrimer: fixed sections, sorted, deterministic, no touched label; unindexed files and empty sections are said plainly', () => {
  const scope = buildScope([{ file: 'b.ts', concept: 'c2' }, { file: 'a.cjs', concept: '' }]);
  assert.equal(scope, '2 files:\n- a.cjs (concept none: outside every concept)\n- b.ts (concept c2)\n');
  const data = { files: [{ file: 'b.ts', concept: 'c2', indexed: true, fanIn: 3, fanOut: 1, exports: 4 }, { file: 'a.cjs', concept: '', indexed: false }], hubs: [], cycles: [['a.ts', 'b.ts']], unused: [{ file: 'b.ts', name: 'dead' }], crossEdges: [], cross: [{ a: 'c1', b: 'c2', text: '# cross\n\n- x' }] };
  const p = buildMetricsPrimer(data);
  assert.equal(p, buildMetricsPrimer(data));
  assert.ok(p.indexOf('## Scope files') < p.indexOf('## Hubs') && p.indexOf('## Hubs') < p.indexOf('## Import cycles') && p.indexOf('## Import cycles') < p.indexOf('## Exports') && p.indexOf('## Exports') < p.indexOf('## Cross-concept import edges') && p.indexOf('## Cross-concept import edges') < p.indexOf('## Cross-concept relations'));
  assert.match(p, /a\.cjs \(concept none\): not in the code index/);
  assert.match(p, /b\.ts \(concept c2\): fan-in 3, fan-out 1, 4 exports/);
  assert.match(p, /- a\.ts <-> b\.ts/);
  assert.match(p, /- `dead` in b\.ts/);
  assert.match(p, /## Hubs[^\n]*\nnone/);
  assert.match(p, /### c1 <-> c2\n\n- x/);
});

test('stored scopes and primers exist for every case, list the planted files, carry their sections and no machine-specific path', () => {
  for (const c of REFACTOR_CASES) {
    for (const ext of ['scope.txt', 'primer.txt']) assert.ok(existsSync(join(here, 'refactor', `${c.id}.${ext}`)), `${c.id}.${ext} exists`);
    const scope = stored(c.id, 'scope.txt');
    const primer = stored(c.id, 'primer.txt');
    assert.deepEqual(storedProblems(c, scope, primer), [], c.id);
    assert.ok(!/\/home\/|\/tmp\/|\/Users\//.test(scope + primer), `${c.id} carries a machine path`);
    assert.ok(scope.split('\n').filter((l) => l.startsWith('- ')).length <= 12, `${c.id} scope is at most 12 files`);
  }
  assert.match(storedProblems(caseOf('f-s5-titlecase-copies'), '1 files:\n- other.ts\n', 'x').join(';'), /omits the planted file/);
  assert.match(storedProblems(caseOf('f-c4-plugin-scripts'), '0 files:\n', '## Scope files').join(';'), /omits the touched file/);
});

test('stored primers see the seeded cycle the primer arms are meant to be helped by, without naming the expected improvement; the cycle\'s middle module is outside the scope', () => {
  assert.match(stored('f-s6-cycle-tasks-session-paths', 'primer.txt'), /## Import cycles[^\n]*\n- [^\n]*claims\.ts <-> [^\n]*session-paths\.ts[^\n]*tasks\.ts/);
  assert.match(stored('f-s6-cycle-tasks-session-paths', 'primer.txt'), /`sessionTasksDir` in apps\/maestro\/src\/core\/session-paths\.ts/);
  assert.doesNotMatch(stored('f-s6-cycle-tasks-session-paths', 'scope.txt'), /claims\.ts/, 'the cycle has no pair of scope files importing each other');
  assert.doesNotMatch(stored('f-s5-titlecase-copies', 'primer.txt'), /titleFromName.*(duplicate|re-implement)/i, 'the primer does not measure duplication');
  assert.match(stored('f-s5-titlecase-copies', 'scope.txt'), /text\.ts/, 'the canonical copy is in a third scope file');
});

const row = (c, arm, run, grade, cost, extra = {}) => ({ case: c, arm, run, m: { cost, turns: 3 }, problems: [], status: 'valid', grade, ...extra });
const g = (found, planted, o = {}) => ({
  found, planted, expected: Array.from({ length: planted }, (_, i) => ({ id: `e${i}`, category: o.cat || 'dedupe', found: i < found })),
  proposals: 2, falseFindings: 0, falseByCat: {}, clean: planted === 0, ...o,
});

test('tally: valid paired runs only; kept improvements by category, false findings on clean runs, cost with both pipeline stages, anchoring', () => {
  const rows = [
    row('c1', 'sonnet-plain', 1, g(1, 1, { falseFindings: 2, falseByCat: { dedupe: 1, other: 1 } }), 0.2),
    row('c1', 'haiku-scout-sonnet-filter', 1, g(1, 1, { anchor: { scout: 3, kept: 2, unchanged: false }, lostByFilter: 0, falseRemoved: 1, scout: { found: 1, falseFindings: 0 } }), 0.05, { m2: { cost: 0.1 } }),
    row('c2', 'sonnet-plain', 1, g(0, 0, { falseFindings: 1 }), 0.1),
    row('c2', 'haiku-scout-sonnet-filter', 1, g(0, 0, { falseFindings: 0, anchor: { scout: 2, kept: 0, unchanged: false }, scout: { found: 0, falseFindings: 2 }, falseRemoved: 2 }), 0.02, { m2: { cost: 0.08 } }),
    { ...row('c3', 'sonnet-plain', 1, g(1, 1), 0.2), status: 'invalid', problems: ['x'] },
    row('c3', 'haiku-scout-sonnet-filter', 1, g(1, 1), 0.1),
  ];
  assert.ok(Math.abs(rowCost(rows[1]) - 0.15) < 1e-9);
  const t = tally(rows);
  assert.equal(t['sonnet-plain'].runs, 2, 'the c3 cell is dropped for both arms');
  assert.equal(t['haiku-scout-sonnet-filter'].runs, 2);
  assert.deepEqual(t['sonnet-plain'].overall, { found: 1, planted: 1 });
  assert.deepEqual(t['sonnet-plain'].cats.dedupe, { found: 1, planted: 1 });
  assert.equal(t['sonnet-plain'].falseFindings, 3, 'false findings count on every case, not only clean ones');
  assert.deepEqual(t['sonnet-plain'].falseByCat, { dedupe: 1, other: 1 });
  assert.equal(t['haiku-scout-sonnet-filter'].falseFindings, 0);
  assert.ok(Math.abs(t['haiku-scout-sonnet-filter'].cost - 0.25) < 1e-9, 'scout + filter cost');
  assert.deepEqual(t['haiku-scout-sonnet-filter'].anchor, { runs: 2, scout: 5, kept: 2, unchanged: 0 });
  assert.equal(t['haiku-scout-sonnet-filter'].falseRemoved, 3);
});

test('falseVerdict: fewer or more by at least 3, else no difference shown', () => {
  assert.equal(falseVerdict(8, 5), 'fewer');
  assert.equal(falseVerdict(8, 6), 'no difference shown');
  assert.equal(falseVerdict(3, 6), 'more');
  assert.equal(falseVerdict(3, 5), 'no difference shown');
});

test('pilotScreen: the baseline pilot is saturated under 3 misses, at the floor under a third found, else ok', () => {
  const mk = (found, planted, fp = 0) => [row('c', 'sonnet-plain', 1, g(found, planted)), row('c2', 'sonnet-plain', 1, g(0, 0, { falseFindings: fp }))];
  assert.equal(pilotScreen(mk(8, 8)).saturated, true);
  assert.equal(pilotScreen(mk(8, 8)).ok, false);
  assert.equal(pilotScreen(mk(6, 8)).saturated, true, 'missing 2 is still saturated');
  assert.equal(pilotScreen(mk(2, 9)).floor, true);
  const ok = pilotScreen(mk(5, 8, 2));
  assert.equal(ok.ok, true);
  assert.match(ok.note, /missed 3 of 8 and kept 2 false finding/);
  assert.equal(pilotScreen([]).ok, false);
});

test('refactorReport: invalid runs, per-arm table with the pipeline anchoring block, verdicts per category against the baseline', () => {
  const rows = [
    row('c1', 'sonnet-plain', 1, g(0, 4)), row('c1', 'haiku-scout-sonnet-filter', 1, g(4, 4, { anchor: { scout: 5, kept: 4, unchanged: false }, scout: { found: 4, falseFindings: 0 } }), 0.05, { m2: { cost: 0.1 } }),
    { ...row('c2', 'sonnet-plain', 1, g(1, 1), 0.2), status: 'invalid', problems: ['invalid spawn run: no Agent call, so no Haiku subagent started'] },
  ];
  const md = refactorReport(rows, { spent: 0.5, budget: 'CAP', stop: null, planned: rows.map((r) => ({ case: r.case, arm: r.arm, run: r.run })) });
  assert.match(md, /^# refactor bench report \(spent \$0\.500 of \$CAP\)/);
  assert.match(md, /INVALID OR USAGE-LIMIT RUNS \(1/);
  assert.match(md, /no Haiku subagent started/);
  assert.match(md, /Pipeline: anchoring/);
  assert.match(md, /\| haiku-scout-sonnet-filter \| 1 \| 5 \| 4 \| 80% \|/);
  assert.match(md, /\$0\.150 \(\$0\.050 \+ \$0\.100\)/);
  assert.match(md, /Verdicts against sonnet-plain/);
  assert.match(md, /helps \(missed 4 -> 0\)/);
});

test('every case\'s plant text is consistent: each plant has file, from and to, and a clean case plants nothing', () => {
  for (const c of REFACTOR_CASES) for (const p of c.refactor.plant) {
    assert.ok(p.file && typeof p.from === 'string' && typeof p.to === 'string' && p.from !== p.to, `${c.id} plant`);
    assert.ok(p.from.length > 20, `${c.id} plant "from" is specific enough to match once`);
  }
});

test('classifier: bullet and numbering variants, decorated file names, and prose around a shaped list (070 adversarial pass)', () => {
  const star = proposalsOf('PROPOSALS:\n* src/a.ts: dedupe: x\n• src/b.ts: dedupe: y\n3) src/c.ts: dedupe: z');
  assert.equal(star.items.length, 3);
  assert.equal(star.allClear, 0);
  const deco = proposalsOf('PROPOSALS:\n- **src/a.ts**: dedupe: x\n- `src/b.ts`: Dedupe: y');
  assert.equal(deco.items.length, 2);
  assert.equal(deco.allClear, 0);
  const around = proposalsOf('I reviewed it.\n\nPROPOSALS:\n- src/a.ts: dedupe: x\n\nThat is all.');
  assert.deepEqual(around.items, ['src/a.ts: dedupe: x']);
  const tail = proposalsOf('PROPOSALS:\n- src/a.ts: dedupe: x\n- src/b.ts: extract-helper: nothing else is fine as written; move it.');
  assert.equal(tail.items.length, 2, 'a shaped line with an all-clear tail is still a proposal');
  assert.equal(tail.allClear, 0);
  for (const item of [
    'PROPOSALS:\n- src/a.ts duplicates readJson from src/b.ts, extract it.',
    'PROPOSALS:\n- src/a.ts is a good candidate for extraction of readJson into src/core/json.ts.',
    'PROPOSALS:\n- Fine to delete the copy in src/b.ts; readJson lives in src/a.ts.',
  ]) {
    const p = proposalsOf(item);
    assert.equal(p.items.length, 1, item);
    assert.equal(p.allClear, 0, item);
  }
  const none = proposalsOf('PROPOSALS: none.');
  assert.equal(none.items.length, 0);
  assert.equal(none.none, true);
  assert.equal(none.allClear, 0);
});

test('a shaped <file>: <kind>: line with no dash under PROPOSALS: is a proposal, not dropped', () => {
  assert.equal(proposalsOf('PROPOSALS:\nsrc/a.ts: dedupe: readJson is copied from src/b.ts; import it.').items.length, 1);
  const two = proposalsOf('PROPOSALS:\nsrc/a.ts: dedupe: x\nsrc/b.ts: dedupe: y\n\n- c.ts: dedupe: z\n  src/d.ts: dedupe: continuation');
  assert.equal(two.items.length, 3);
  assert.equal(gradePipeline(caseOf('f-c1-canvas-layout'), 'PROPOSALS:\nsrc/a.ts: dedupe: x', 'VERDICTS:\n- 1: file-it').anchor.scout, 1);
});

test('the unbulleted-line scan agrees with findingsOf: an empty "- " bullet or a header-line bullet owns the shaped line after it', () => {
  const empty = proposalsOf('PROPOSALS:\n- \nsrc/a.ts: dedupe: readJson is copied from src/b.ts; import it.');
  assert.equal(empty.items.length, 1);
  const c = caseOf('f-c1-canvas-layout');
  const g = gradePipeline(c, 'PROPOSALS:\n- \nsrc/a.ts: dedupe: x', 'VERDICTS:\n- 1: file-it');
  assert.equal(g.anchor.scout, 1);
  assert.equal(g.falseFindings, 1, 'not counted twice');
  const hdr = proposalsOf('PROPOSALS: - a.ts: dedupe: x\nb.ts: dedupe: y');
  assert.equal(hdr.items.length, 1);
  assert.equal(proposalsOf('PROPOSALS: - a.ts: dedupe: x\n\nb.ts: dedupe: y').items.length, 2);
});

test('a bare bullet marker on the PROPOSALS header line opens an empty bullet: the dashless shaped line is its content, credited once', () => {
  const T = 'src/a.ts: dedupe: readJson is copied from src/b.ts; import it.';
  for (const m of ['-', '1.', '•', '- ', '*']) {
    const p = proposalsOf(`PROPOSALS: ${m}\n${T}`);
    assert.deepEqual(p.items, [T], m);
    assert.equal(p.allClear, 0, m);
    const g = gradePipeline(caseOf('f-c1-canvas-layout'), `PROPOSALS: ${m}\n${T}`, 'VERDICTS:\n- 1: file-it');
    assert.equal(g.anchor.scout, 1, m);
    assert.equal(g.falseFindings, 1, m);
  }
  assert.equal(proposalsOf(`PROPOSALS: -\n${T}\nsrc/c.ts: dedupe: y`).items.length, 2);
  assert.equal(proposalsOf(`PROPOSALS: -\n${T}\n- src/c.ts: dedupe: y`).items.length, 2);
});

test('a dashless shaped line right after "PROPOSALS: - <T>" is that bullet\'s continuation, not a second item', () => {
  const p = proposalsOf('PROPOSALS: - a.ts: dedupe: x\nb.ts: dedupe: y');
  assert.deepEqual(p.items, ['a.ts: dedupe: x']);
});

// Documented limit (docs/evals.md): an all-clear opener followed by "but" in an unshaped line is an all-clear.
test('documented limit: an unshaped line that opens with an all-clear phrase is an all-clear even when it adds "but ..."', () => {
  const p = proposalsOf('PROPOSALS:\n- No changes needed in src/a.ts, but extract the parser from src/b.ts into a helper.');
  assert.equal(p.items.length, 0);
  assert.equal(p.allClear, 1);
});

test('an unshaped all-clear sentence ("None of the files need changes.") is an all-clear, not a false finding', () => {
  for (const line of ['None of the files need changes.', 'Nothing to flag.', 'The files are all good.']) {
    const p = proposalsOf(`PROPOSALS:\n- ${line}`);
    assert.equal(p.items.length, 0, line);
    assert.equal(p.allClear, 1, line);
  }
});
