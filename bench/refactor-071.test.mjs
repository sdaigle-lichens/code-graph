// Ticket 071: the batched filter, the inline review, the shared scout, the cost split, the review-verdict
// shift. Pure helpers only; nothing here calls claude.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REFACTOR_ARMS, REVIEW_CONTROL, batchFilterPrompt, batchesOf, classifyItem, gradeFiltered, gradeInline, gradeReviewControl, inlineReviewPrompt, isControlArm,
  isScoutArm, refactorArgs, refactorReport, reviewChangeOf, reviewControlPrompt, reviewPromptProblems, reviewShift, reviewVerdictOf, answerProblems,
  sliceVerdicts, splitCost, stageProblems, stageSpec, stagesOf, tally, verdictsOf, withSupportArms,
} from './refactor.mjs';
import { REFACTOR_CASES, selectRefactorCases } from './refactor-cases.mjs';

const caseOf = (id) => REFACTOR_CASES.find((c) => c.id === id);
const L1 = caseOf('f-l1-tasks-sections');
const L2 = caseOf('f-l2-session-sweep');

test('071 arms: stages, specs and flags', () => {
  assert.deepEqual(stagesOf('haiku-batched-filter'), ['scout', 'batch']);
  assert.deepEqual(stagesOf('haiku-reviewer-inline'), ['scout', 'inline']);
  assert.deepEqual(stagesOf(REVIEW_CONTROL), ['review']);
  assert.deepEqual(stagesOf('haiku-metrics-primer'), ['main']);
  assert.equal(stageSpec('haiku-batched-filter', 'batch').model, 'claude-sonnet-5-5');
  assert.equal(stageSpec('haiku-reviewer-inline', 'inline').model, 'claude-sonnet-5-5');
  assert.equal(stageSpec('haiku-batched-filter', 'scout').model, 'claude-haiku-5-5');
  assert.equal(stageSpec(REVIEW_CONTROL, 'review').model, 'claude-sonnet-5-5');
  for (const [arm, stage] of [['haiku-batched-filter', 'batch'], ['haiku-reviewer-inline', 'inline'], [REVIEW_CONTROL, 'review']]) {
    const a = refactorArgs(arm, stage, 'P', { runBudget: '0.6' });
    assert.equal(a[a.indexOf('--tools') + 1], 'Bash,Read,Grep,Glob,Skill', `${arm} has no Agent tool`);
  }
  assert.equal(isControlArm(REVIEW_CONTROL), true);
  assert.equal(isControlArm('sonnet-plain'), false);
  assert.deepEqual(['sonnet-plain', 'haiku-metrics-primer', 'haiku-batched-filter', 'haiku-reviewer-inline'].map(isScoutArm), [false, true, true, true]);
  assert.deepEqual(withSupportArms(['sonnet-plain', 'haiku-reviewer-inline']), ['sonnet-plain', 'haiku-reviewer-inline', REVIEW_CONTROL]);
  assert.deepEqual(withSupportArms(['sonnet-plain']), ['sonnet-plain'], 'no inline arm, no control');
  assert.deepEqual(withSupportArms(['haiku-reviewer-inline', REVIEW_CONTROL]), ['haiku-reviewer-inline', REVIEW_CONTROL]);
  assert.equal(stageProblems('haiku-reviewer-inline', 'inline', { init: { model: 'claude-sonnet-5-5', tools: ['Bash', 'Read', 'Grep', 'Glob', 'Skill'] } }, '').length, 0);
  assert.match(stageProblems('haiku-batched-filter', 'batch', { init: { model: 'claude-haiku-5-5', tools: ['Bash'] } }, '')[0], /init model/);
});

test('batches: cases group by their pre-registered batch; --only shrinks a batch, never merges two', () => {
  const g = batchesOf(selectRefactorCases('', '071'));
  assert.deepEqual(g.map((b) => b.length), [3, 3]);
  assert.deepEqual(batchesOf(selectRefactorCases('f-l1,f-l2', '071')).map((b) => b.map((c) => c.id)), [['f-l1-tasks-sections'], ['f-l2-session-sweep']]);
});

test('batchFilterPrompt: one numbered backlog across the cases, file-it or drop-it only; empty throws', () => {
  const p = batchFilterPrompt([{ id: 'a', scope: 'S1', items: ['x.ts: dedupe: one', 'y.ts: extract-helper: two'] }, { id: 'b', scope: 'S2', items: ['z.ts: dedupe: three'] }]);
  assert.match(p, /1\. x\.ts: dedupe: one\n2\. y\.ts: extract-helper: two/);
  assert.match(p, /3\. z\.ts: dedupe: three/, 'the numbers run on across cases');
  assert.match(p, /<neighbourhood-backlog case="a">/);
  assert.match(p, /<neighbourhood-backlog case="b">/);
  assert.match(p, /`VERDICTS:`/);
  assert.match(p, /do not add suggestions of your own/);
  assert.throws(() => batchFilterPrompt([]), /at least one case/);
});

test('sliceVerdicts and the batch grade: each case gets its own part, renumbered', () => {
  const v = verdictsOf('VERDICTS:\n- 1: drop-it: no\n- 2: file-it: yes\n- 3: file-it: yes\n- 4: drop-it: no', 4);
  assert.deepEqual(sliceVerdicts(v, 0, 2), { structured: true, kept: [2], dropped: [1], unmarked: [], outOfList: 0 });
  assert.deepEqual(sliceVerdicts(v, 2, 2), { structured: true, kept: [1], dropped: [2], unmarked: [], outOfList: 0 });
  const scoutText = `PROPOSALS:\n- apps/maestro/src/core/session-sweep.ts: dedupe: SessionRef in session-sweep.ts and SessionTitleRef in session-title.ts are the same interface, define it once.\n- apps/maestro/src/core/session-sweep.ts: extract-helper: something that is not warranted.`;
  const g = gradeFiltered(L2, scoutText, (n) => sliceVerdicts(v, 2, n));
  assert.equal(g.scout.found, 1);
  assert.equal(g.found, 1, 'the kept proposal is the expected one');
  assert.equal(g.falseFindings, 0, 'the unwarranted one was dropped');
  assert.equal(g.falseRemoved, 1);
  assert.equal(g.anchor.kept, 1);
  const lost = gradeFiltered(L2, scoutText, (n) => sliceVerdicts(verdictsOf('VERDICTS:\n- 1: drop-it: x\n- 2: drop-it: y', 2), 0, n));
  assert.equal(lost.found, 0);
  assert.equal(lost.lostByFilter, 1, 'a dropped expected improvement is lost by the filter');
});

test('splitCost: by proposals, equal when none, always sums to the batch cost', () => {
  const s = splitCost(0.3, [2, 1, 0]);
  assert.deepEqual(s.map((x) => +x.toFixed(4)), [0.2, 0.1, 0]);
  assert.ok(Math.abs(s.reduce((a, b) => a + b, 0) - 0.3) < 1e-9);
  assert.deepEqual(splitCost(0.3, [0, 0, 0]).map((x) => +x.toFixed(4)), [0.1, 0.1, 0.1]);
});

test('review prompts: the control is the 066 base plus format, the inline one adds the list and a VERDICTS section before FINDINGS', () => {
  const diff = 'diff --git a/x b/x\n+y\n';
  const ctl = reviewControlPrompt(diff);
  const inl = inlineReviewPrompt(diff, ['a.ts: dedupe: one', 'b.ts: extract-helper: two']);
  assert.ok(ctl.includes('<diff>') && ctl.includes('`FINDINGS:`'));
  assert.ok(!ctl.includes('<scout-suggestions>'));
  assert.ok(inl.startsWith(ctl.slice(0, ctl.indexOf('Finish with a section'))), 'the same base text');
  assert.match(inl, /<scout-suggestions>\n1\. a\.ts: dedupe: one\n2\. b\.ts: extract-helper: two\n<\/scout-suggestions>/);
  assert.ok(inl.indexOf('`VERDICTS:`') < inl.lastIndexOf('`FINDINGS:`'), 'the marks come before the final findings');
  assert.match(inl, /must not appear in FINDINGS/);
  assert.ok(inl.endsWith(ctl.slice(ctl.indexOf('Finish with a section'))), 'the same format text last');
  assert.deepEqual(reviewPromptProblems('haiku-reviewer-inline', inl), []);
  assert.deepEqual(reviewPromptProblems(REVIEW_CONTROL, ctl), []);
  assert.match(reviewPromptProblems(REVIEW_CONTROL, inl)[0], /carries a scout list/);
  assert.match(reviewPromptProblems('haiku-reviewer-inline', ctl)[0], /lacks the scout list/);
  assert.throws(() => inlineReviewPrompt(diff, []), /at least one scout suggestion/);
});

test('reviewChangeOf: the plant when the case has one, else the harmless reviewChange', () => {
  assert.equal(reviewChangeOf(caseOf('f-r5-plugin-scripts-05d5b76')), caseOf('f-r5-plugin-scripts-05d5b76').refactor.plant);
  assert.equal(reviewChangeOf(L1), L1.refactor.reviewChange);
  assert.deepEqual(reviewChangeOf({ refactor: { plant: [] } }), []);
});

test('review verdicts: the review\'s own verdict is its FINDINGS; the marks do not leak into it', () => {
  assert.deepEqual(reviewVerdictOf('FINDINGS: none'), { structured: true, none: true, findings: 0, hasFindings: false });
  const both = 'VERDICTS:\n- 1: file-it: real\n- 2: drop-it: taste\n\nFINDINGS:\n- a.ts: the change drops a null check.';
  assert.equal(reviewVerdictOf(both).hasFindings, true);
  assert.equal(reviewVerdictOf(both).findings, 1);
  const marksOnly = 'VERDICTS:\n- 1: file-it: real\n\nFINDINGS: none';
  assert.equal(reviewVerdictOf(marksOnly).hasFindings, false);
  assert.deepEqual(verdictsOf(marksOnly, 1).kept, [1]);
  assert.equal(reviewVerdictOf('no section at all').structured, false);
});

const SCOUT = `PROPOSALS:\n- apps/maestro/src/core/tasks.ts: dedupe: buildStatusMap and tasksFromFiles each write the blockedBy.every doneSet rule twice, extract one helper.\n- apps/maestro/src/core/tasks.ts: extract-helper: invented problem nobody has.`;

test('gradeInline: marks grade the scout list like a filter; a missing session is a list with no marks; the review is read for its own verdict', () => {
  const g = gradeInline(L1, SCOUT, 'VERDICTS:\n- 1: file-it: real\n- 2: drop-it: no\n\nFINDINGS: none');
  assert.equal(g.found, 1);
  assert.equal(g.falseFindings, 0);
  assert.equal(g.review.hasFindings, false);
  assert.deepEqual(answerProblems('haiku-reviewer-inline', g), []);
  const none = gradeInline(L1, 'PROPOSALS: none', null);
  assert.equal(none.review, null, 'no list, no inline session');
  assert.equal(none.found, 0);
  const unmarked = gradeInline(L1, SCOUT, 'FINDINGS: none');
  assert.match(answerProblems('haiku-reviewer-inline', unmarked).join(' '), /no VERDICTS section/);
  const noFindings = gradeInline(L1, SCOUT, 'VERDICTS:\n- 1: file-it: ok\n- 2: drop-it: no');
  assert.match(answerProblems('haiku-reviewer-inline', noFindings).join(' '), /no FINDINGS section/);
});

test('gradeReviewControl: scores nothing as a refactor arm and reads the review verdict', () => {
  const g = gradeReviewControl('FINDINGS:\n- x.ts: a bug.');
  assert.equal(g.planted, 0);
  assert.equal(g.review.hasFindings, true);
  assert.deepEqual(answerProblems(REVIEW_CONTROL, g), []);
  assert.match(answerProblems(REVIEW_CONTROL, gradeReviewControl('looks fine'))[0], /no FINDINGS section/);
});

const row = (c, arm, run, grade, cost, extra = {}) => ({ case: c.id, arm, run, status: 'valid', problems: [], m: { cost }, grade, ...extra });
const planned = (arms) => arms.map((arm) => ({ case: L1.id, arm, run: 1 }));

test('tally and the shift: the control review is not an arm; flips count the cells where the list changes has-findings', () => {
  const ARMS = ['sonnet-plain', 'haiku-reviewer-inline', REVIEW_CONTROL];
  const rows = [
    row(L1, 'sonnet-plain', 1, gradeInline(L1, SCOUT, 'VERDICTS:\n- 1: file-it: a\n- 2: file-it: b\n\nFINDINGS: none'), 0.1),
    row(L1, 'haiku-reviewer-inline', 1, gradeInline(L1, SCOUT, 'VERDICTS:\n- 1: file-it: a\n- 2: file-it: b\n\nFINDINGS:\n- tasks.ts: broke it.'), 0.02, { m2: { cost: 0.05 } }),
    row(L1, REVIEW_CONTROL, 1, gradeReviewControl('FINDINGS: none'), 0.1),
  ];
  const t = tally(rows, planned(ARMS));
  assert.deepEqual(Object.keys(t).sort(), ['haiku-reviewer-inline', 'sonnet-plain']);
  assert.ok(Math.abs(t['haiku-reviewer-inline'].cost - 0.07) < 1e-9, 'scout + extra over the control');
  assert.deepEqual(reviewShift(rows, planned(ARMS)), { cells: 1, flips: 1, toFindings: 1, fromFindings: 0 });
  assert.equal(classifyItem(L1, 'apps/maestro/src/core/tasks.ts: extract-helper: invented problem nobody has.'), 'rest');
});

test('the report: control rows listed, not tabled as an arm; the shift section and the pipeline table appear', () => {
  const ARMS = ['sonnet-plain', 'haiku-reviewer-inline', REVIEW_CONTROL];
  const rows = [
    row(L1, 'sonnet-plain', 1, gradeInline(L1, SCOUT, 'VERDICTS:\n- 1: file-it: a\n- 2: drop-it: b\n\nFINDINGS: none'), 0.1),
    row(L1, 'haiku-reviewer-inline', 1, gradeInline(L1, SCOUT, 'VERDICTS:\n- 1: file-it: a\n- 2: drop-it: b\n\nFINDINGS: none'), 0.02, { m2: { cost: 0.05 } }),
    row(L1, REVIEW_CONTROL, 1, gradeReviewControl('FINDINGS: none'), 0.1),
  ];
  const md = refactorReport(rows, { spent: 0.3, budget: 3, planned: planned(ARMS) });
  assert.match(md, /Does the scout's list change the review's own verdict/);
  assert.match(md, /differs in 0 /);
  assert.match(md, /\| haiku-reviewer-inline \| 1 \|/);
  assert.ok(!/\| sonnet-review-plain \| 1 \| [0-9/ |]*\$/.test(md.split('## Per arm')[1] || ''), 'no control row in the per-arm table');
  assert.match(md, /Counted: 2 of 2 valid runs/);
});

test('the latent cases: not in the 070 set, and the batched-filter arm batches them', () => {
  for (const c of REFACTOR_CASES.filter((x) => x.kind === 'latent')) {
    assert.equal(c.sets.includes('070'), false);
    assert.ok(REFACTOR_ARMS['haiku-batched-filter'].batch && c.batch);
  }
});
