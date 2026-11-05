import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASELINE, DEFAULT_BUDGET, DEFAULT_REVIEW_ARMS, DEFAULT_RUNS, PRIMER_OPEN, REVIEW_ARMS, REVIEW_TOOLS, SPAWN_TOOLS, addedImports, buildPrimer, changedSymbols,
  diffForPlants, findingsOf, gradeReview, importCandidates, parseFileVertices, parseImpact, parseReviewArms, promptProblems,
  pairedRows, reviewArgs, reviewPrompt, reviewProblems, reviewReport, spawnEvidence, tally, toolsFor, unifiedDiff, untestedCallers, verdict,
} from './review.mjs';
import { REVIEW_CASES, selectReviewCases } from './review-cases.mjs';

export const PILOT_ONLY = 'r-l1,r-l4,r-x1,r-x4,r-c6'; // the 068 pilot A case list (2 local, 2 cross, 1 clean)

const here = dirname(fileURLToPath(import.meta.url));
const stored = (id, ext) => readFileSync(join(here, 'review', `${id}.${ext}`), 'utf8');

// ---- arms, args, prompts ----

test('parseReviewArms: known arms in table order, unknown or empty throws; default is the four planned arms (068)', () => {
  assert.deepEqual(parseReviewArms(DEFAULT_REVIEW_ARMS), ['sonnet-nograph', 'sonnet-diff-primer', 'haiku-diff-primer', 'haiku-nograph']);
  assert.ok(!parseReviewArms(DEFAULT_REVIEW_ARMS).includes('sonnet-spawns-haiku'), 'the spawn arm is defined but not planned');
  assert.deepEqual(parseReviewArms(`${DEFAULT_REVIEW_ARMS},sonnet-spawns-haiku`), ['sonnet-nograph', 'sonnet-diff-primer', 'haiku-diff-primer', 'sonnet-spawns-haiku', 'haiku-nograph']); // still selectable
  assert.deepEqual(parseReviewArms('haiku-nograph, sonnet-nograph,sonnet-nograph'), ['sonnet-nograph', 'haiku-nograph']);
  assert.throws(() => parseReviewArms('sonnet-nograph,opus'), /unknown review arm/);
  assert.throws(() => parseReviewArms(''), /no arm given/);
});

test('reviewArgs: each arm pins its model and an exact tool set; only the spawn arm has Agent; no plugin dir', () => {
  for (const arm of Object.keys(REVIEW_ARMS)) {
    const a = reviewArgs(arm, 'P', { runBudget: 1 });
    assert.equal(a[a.indexOf('--model') + 1], REVIEW_ARMS[arm].model);
    const tools = a[a.indexOf('--tools') + 1];
    assert.equal(tools, a[a.indexOf('--allowedTools') + 1]);
    assert.equal(tools, REVIEW_ARMS[arm].spawn ? SPAWN_TOOLS : REVIEW_TOOLS);
    assert.equal(tools.split(',').includes('Agent'), REVIEW_ARMS[arm].spawn);
    assert.equal(a.includes('--plugin-dir'), false);
    assert.equal(a[a.indexOf('--permission-mode') + 1], 'dontAsk');
  }
  assert.equal(REVIEW_ARMS['haiku-diff-primer'].model, 'claude-haiku-5-5');
  assert.equal(REVIEW_ARMS[BASELINE].model, 'claude-sonnet-5-5');
});

test('reviewPrompt: diff and format in every arm, primer only in primer arms, spawn paragraph only in the spawn arm', () => {
  const diff = 'diff --git a/x b/x\n-a\n+b\n';
  for (const arm of Object.keys(REVIEW_ARMS)) {
    const p = reviewPrompt(arm, diff, 'PRIMER BODY');
    assert.ok(p.includes('<diff>') && p.includes('+b') && p.includes('FINDINGS: none'), arm);
    assert.equal(p.includes(PRIMER_OPEN), REVIEW_ARMS[arm].primer, arm);
    assert.equal(p.includes('PRIMER BODY'), REVIEW_ARMS[arm].primer, arm);
    assert.equal(p.includes('Haiku subagent'), REVIEW_ARMS[arm].spawn, arm);
    assert.deepEqual(promptProblems(arm, p), [], arm);
  }
  assert.throws(() => reviewPrompt('sonnet-diff-primer', diff, '  '), /needs the stored primer/);
  assert.throws(() => reviewPrompt('nope', diff), /unknown review arm/);
  assert.match(promptProblems('sonnet-nograph', reviewPrompt('sonnet-diff-primer', diff, 'X'))[0], /carries a diff primer/);
  assert.match(promptProblems('sonnet-diff-primer', reviewPrompt('sonnet-nograph', diff))[0], /no diff primer/);
  assert.match(promptProblems('sonnet-nograph', reviewPrompt('sonnet-spawns-haiku', diff))[0], /spawn/);
});

// ---- diffs ----

test('unifiedDiff: one changed line keeps three lines of context and old-file coordinates', () => {
  const before = 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n';
  const d = unifiedDiff('f.ts', before, before.replace('l5', 'L5'));
  assert.equal(d.text, 'diff --git a/f.ts b/f.ts\n--- a/f.ts\n+++ b/f.ts\n@@ -2,7 +2,7 @@\n l2\n l3\n l4\n-l5\n+L5\n l6\n l7\n l8\n');
  assert.deepEqual([d.lo, d.hi], [5, 5]);
  assert.deepEqual(d.added, ['L5']);
});

test('unifiedDiff: a pure insertion touches the two old lines around it; an unchanged stretch between edits stays context', () => {
  const before = 'a\nb\nc\nd\ne\nf\ng\n';
  const ins = unifiedDiff('f.ts', before, before.replace('c\n', 'c\nNEW\n'));
  assert.deepEqual([ins.lo, ins.hi], [3, 4]);
  assert.ok(ins.text.includes('+NEW'));
  const two = unifiedDiff('f.ts', before, before.replace('b\n', 'b\nX\n').replace('f\n', 'f\nY\n'));
  assert.ok(two.text.includes('+X') && two.text.includes('+Y') && two.text.includes(' d\n') && !two.text.includes('-d'));
  assert.deepEqual(two.added, ['X', 'Y']);
});

test('unifiedDiff: identical text throws', () => assert.throws(() => unifiedDiff('f', 'a\n', 'a\n'), /no change/));

test('diffForPlants: applies replacements per file in order, throws when a "from" is missing or ambiguous', () => {
  const files = { 'a.ts': 'one\ntwo\nthree\n', 'b.ts': 'x\nx\n' };
  const read = (f) => files[f];
  const r = diffForPlants(read, [{ file: 'a.ts', from: 'two', to: 'TWO' }, { file: 'a.ts', from: 'three', to: 'THREE' }]);
  assert.equal(r.changes.length, 1);
  assert.ok(r.diff.includes('-two') && r.diff.includes('+TWO') && r.diff.includes('+THREE'));
  assert.throws(() => diffForPlants(read, [{ file: 'a.ts', from: 'nope', to: 'y' }]), /none/);
  assert.throws(() => diffForPlants(read, [{ file: 'b.ts', from: 'x', to: 'y' }]), /several/);
});

// ---- the cases and their stored artifacts ----

test('the case set covers both categories with several bugs each, and has clean diffs', () => {
  const bugs = REVIEW_CASES.flatMap((c) => c.review.bugs);
  assert.ok(bugs.filter((b) => b.category === 'local').length >= 3);
  assert.ok(bugs.filter((b) => b.category === 'cross').length >= 3);
  assert.ok(REVIEW_CASES.filter((c) => !c.review.bugs.length).length >= 1);
  assert.equal(new Set(REVIEW_CASES.map((c) => c.id)).size, REVIEW_CASES.length);
  for (const c of REVIEW_CASES) {
    assert.ok(c.sets.includes('066') && c.skills.length && c.review.plant.length, c.id);
    for (const p of c.review.plant) assert.ok(p.from && p.to && p.from !== p.to, c.id);
    for (const b of c.review.bugs) assert.ok(['local', 'cross'].includes(b.category) && b.file && b.defect.length && b.desc, `${c.id} ${b.id}`);
  }
});

test('068: every bug case states where its bug kind comes from; clean cases are 5 non-trivial refactors; category matches case kind', () => {
  for (const c of REVIEW_CASES.filter((x) => x.review.bugs.length)) {
    assert.ok(typeof c.review.source === 'string' && c.review.source.length > 40, `${c.id} needs review.source`);
    assert.ok(c.review.bugs.every((b) => b.category === c.kind), c.id);
  }
  const clean = REVIEW_CASES.filter((x) => !x.review.bugs.length);
  assert.equal(clean.length, 5);
  assert.ok(clean.every((c) => c.kind === 'clean'));
  assert.equal(REVIEW_CASES.filter((c) => c.kind === 'local').length, 5);
  assert.equal(REVIEW_CASES.filter((c) => c.kind === 'cross').length, 5);
});

test('068: a cross case breaks only outside the diff: the diff touches no file the grader expects the finding to be only about', () => {
  // The planted files are session-paths, handoff-channels, claims and tasks; each cross bug's description
  // names a consumer (a caller, a sibling module or a twin script) that the plant does not edit.
  const consumers = {
    'r-x1-list-skips-worktree': /handoff-channels|session-log|sweep/,
    'r-x2-sqlite-edge': /maestro-session\.cjs/,
    'r-x3-claim-requires-name': /maestro-task-status\.cjs/,
    'r-x4-liveness-state-file': /maestro-task-status\.cjs/,
    'r-x5-queue-root': /listTasks and closeTask/,
  };
  for (const c of REVIEW_CASES.filter((x) => x.kind === 'cross')) {
    assert.match(c.review.bugs[0].desc, consumers[c.id], c.id);
    const edited = new Set(c.review.plant.map((p) => p.file));
    for (const f of ['maestro-task-status.cjs', 'maestro-session.cjs']) assert.ok(![...edited].some((e) => e.endsWith(f)), `${c.id} edits ${f}`);
  }
});

test('068: the run defaults are the planned arms, 3 runs per cell and the proposed cap', () => {
  assert.equal(DEFAULT_RUNS, '3');
  assert.equal(DEFAULT_BUDGET, '13');
});

test('graders: a known-good review text finds every planted bug with no false alarm; a known-bad one finds none', () => {
  for (const c of REVIEW_CASES) {
    const good = gradeReview(c, c.samples.good);
    const bad = gradeReview(c, c.samples.bad);
    assert.equal(good.found, good.planted, `${c.id} good`);
    assert.equal(good.falseAlarms, 0, `${c.id} good`);
    assert.equal(good.structured, true);
    assert.equal(bad.found, 0, `${c.id} bad`);
    if (c.review.bugs.length) assert.equal(bad.extra, bad.findings, c.id);
    else assert.ok(bad.falseAlarms >= 1, `${c.id} bad counts false alarms`);
  }
});

test('graders: each planted bug is credited by its own description (a grader that cannot see its own bug is broken)', () => {
  for (const c of REVIEW_CASES) for (const b of c.review.bugs) {
    const g = gradeReview(c, `FINDINGS:\n- ${b.file.split('|')[0].replaceAll('\\', '')}: ${b.desc}`);
    assert.equal(g.bugs.find((x) => x.id === b.id)?.found, true, `${c.id}/${b.id}`);
  }
});

test('graders: a finding for one bug does not credit another bug in the same file', () => {
  const cap = REVIEW_CASES.find((x) => x.id === 'r-l2-sweep-default-cap');
  const zero = REVIEW_CASES.find((x) => x.id === 'r-l5-empty-dir-zero');
  const order = REVIEW_CASES.find((x) => x.id === 'r-l3-count-before-remove');
  assert.equal(gradeReview(cap, `FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: ${zero.review.bugs[0].desc}`).found, 0);
  assert.equal(gradeReview(zero, `FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: ${order.review.bugs[0].desc}`).found, 0);
  assert.equal(gradeReview(order, `FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: ${cap.review.bugs[0].desc}`).found, 0);
});

test('graders: no bug description credits a different bug in the same file or any other case', () => {
  for (const a of REVIEW_CASES) for (const b of REVIEW_CASES) {
    if (a === b || !b.review.bugs.length) continue;
    for (const bug of a.review.bugs) {
      const g = gradeReview(b, `FINDINGS:\n- ${bug.file.split('|')[0]}.ts: ${bug.desc}`);
      assert.equal(g.found, 0, `${a.id} description credits ${b.id}`);
    }
  }
});

test('graders: a finding that says the defect is absent is not credited', () => {
  const near = [
    ['r-l1-resumable-clear', 'FINDINGS:\n- apps/maestro/src/core/session-paths.ts: the reasons list with clear is fine and the directory is removed as before.'],
    ['r-l5-empty-dir-zero', 'FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: newest starting at 0 for an empty fresh directory is correct as written.'],
  ];
  for (const [id, text] of near) assert.equal(gradeReview(REVIEW_CASES.find((x) => x.id === id), text).found, 0, id);
});

test('graders: an absent-defect finding phrased "X, correct, ..." is not credited, but "incorrect" is a real finding', () => {
  const c = REVIEW_CASES.find((x) => x.id === 'r-l2-sweep-default-cap');
  const text = 'FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: the default idleCapMs uses SESSION_DELETE_IDLE_CAP_MS, correct, the 24h sweep cap is a separate constant.';
  assert.equal(gradeReview(c, text).found, 0);
  const real = 'FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: the sweep default idle cap is now SESSION_DELETE_IDLE_CAP_MS (15 minutes), incorrect: a session parked for hours is swept instead of the 24h cap.';
  assert.equal(gradeReview(c, real).found, 1);
});

test('graders: a defect in the wrong file, or a file with no defect named, is not credited', () => {
  const c = REVIEW_CASES.find((x) => x.id === 'r-x3-claim-requires-name');
  assert.equal(gradeReview(c, 'FINDINGS:\n- apps/maestro/src/core/other.ts: session_name is required, unnamed values are dropped by the parser').found, 0);
  assert.equal(gradeReview(c, 'FINDINGS:\n- apps/maestro/src/core/claims.ts: looks risky').found, 0);
  assert.equal(gradeReview(c, 'FINDINGS:\n- claims.ts: session_name is required now but optional, and the task-status CLI writes unnamed claims, which are dropped').found, 1);
});

test('stored diffs and primers exist for every case, hold the planted lines, and carry no machine-specific path', () => {
  for (const c of REVIEW_CASES) {
    for (const ext of ['diff', 'primer.txt']) assert.ok(existsSync(join(here, 'review', `${c.id}.${ext}`)), `${c.id}.${ext}`);
    const diff = stored(c.id, 'diff');
    const added = diff.split('\n').slice(4).filter((l) => !l.startsWith('-')).map((l) => l.slice(1)).join('\n'); // added and context lines of the hunk
    const removed = diff.split('\n').slice(4).filter((l) => l.startsWith('-')).map((l) => l.slice(1)).join('\n');
    for (const p of c.review.plant) {
      const fromLines = p.from.split('\n');
      const toLines = p.to.split('\n');
      // lines beyond the three context lines of a hunk are not in the diff: check the changed lines only
      const changedNew = toLines.filter((l) => !fromLines.includes(l));
      const changedOld = fromLines.filter((l) => !toLines.includes(l));
      for (const l of changedNew) assert.ok(added.includes(l), `${c.id}: planted line missing from the stored diff: ${l}`);
      for (const l of changedOld) assert.ok(removed.includes(l), `${c.id}: removed line missing from the stored diff: ${l}`);
      assert.notEqual(p.from, p.to, `${c.id}: plant changes nothing`);
    }
    assert.match(diff, /^diff --git a\/apps\/maestro\//);
    const primer = stored(c.id, 'primer.txt');
    assert.ok(primer.startsWith('## Changed symbols'), c.id);
    assert.ok(!/\/tmp\/|\/home\//.test(primer + diff), c.id);
    // the primer is built from the diff and the index only: it never carries the grader's text
    for (const b of c.review.bugs) assert.ok(!primer.includes(b.desc), c.id);
  }
});

// The old and new sides of a stored one-hunk diff, as the reviewer reads them (context lines on both).
const sidesOf = (diff) => {
  const old = [];
  const neu = [];
  for (const l of String(diff).split('\n').slice(4)) {
    if (l.startsWith('-')) old.push(l.slice(1));
    else if (l.startsWith('+')) neu.push(l.slice(1));
    else if (l.startsWith(' ')) { old.push(l.slice(1)); neu.push(l.slice(1)); }
  }
  return { old: old.join('\n'), neu: neu.join('\n') };
};

// The lines of `a` that no longest common subsequence with `b` keeps: the lines a plant changes (a moved
// line counts on both sides). A plant's unchanged lines may lie outside the three context lines of the hunk.
const changedLinesOf = (a, b) => {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const keep = new Set();
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { keep.add(i); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return a.filter((_, k) => !keep.has(k));
};

test('068: each stored diff is one file, and every line a plant removes is on its old side, every line it adds on its new side (moved lines included)', () => {
  for (const c of REVIEW_CASES) {
    const diff = stored(c.id, 'diff');
    assert.equal(diff.split('\n').filter((l) => l.startsWith('diff --git ')).length, 1, `${c.id}: one file per stored diff`);
    const { old, neu } = sidesOf(diff);
    const oldLines = old.split('\n');
    const newLines = neu.split('\n');
    for (const p of c.review.plant) {
      const from = p.from.split('\n');
      const to = p.to.split('\n');
      for (const l of changedLinesOf(from, to)) assert.ok(oldLines.includes(l), `${c.id}: removed line not on the old side of the stored diff: ${l}`);
      for (const l of changedLinesOf(to, from)) assert.ok(newLines.includes(l), `${c.id}: added line not on the new side of the stored diff: ${l}`);
    }
  }
});

test('068: the side check is not vacuous: the r-l3 moved-line diff does not carry the r-l2 plant', () => {
  const r3 = REVIEW_CASES.find((x) => x.id === 'r-l3-count-before-remove');
  const other = REVIEW_CASES.find((x) => x.id === 'r-l2-sweep-default-cap');
  const { old, neu } = sidesOf(stored(r3.id, 'diff'));
  const otherFrom = other.review.plant[0].from.split('\n');
  const otherTo = other.review.plant[0].to.split('\n');
  assert.ok(changedLinesOf(otherFrom, otherTo).some((l) => !old.split('\n').includes(l)), 'the other plant\'s removed line is absent from r-l3 (so the check can fail)');
  assert.ok(changedLinesOf(r3.review.plant[0].from.split('\n'), r3.review.plant[0].to.split('\n')).every((l) => old.split('\n').includes(l)));
  assert.ok(neu.includes(r3.review.plant[0].to.split('\n')[0]));
});

test('068: each cross case names consumers whose identifiers are on no changed line of its stored diff (the breakage is outside the diff)', () => {
  const consumers = {
    'r-x1-list-skips-worktree': ['liveRunIds', 'pendingLanes'],
    'r-x2-sqlite-edge': ['maestro-session'],
    'r-x3-claim-requires-name': ['maestro-task-status'],
    'r-x4-liveness-state-file': ['maestro-task-status'],
    'r-x5-queue-root': ['listTasks', 'closeTask'],
  };
  for (const c of REVIEW_CASES.filter((x) => x.kind === 'cross')) {
    assert.ok(consumers[c.id], `${c.id} needs its consumer identifiers listed here`);
    const changed = stored(c.id, 'diff').split('\n').slice(4).filter((l) => l.startsWith('+') || l.startsWith('-')).join('\n');
    for (const id of consumers[c.id]) assert.ok(!changed.includes(id), `${c.id}: ${id} is on a changed line`);
  }
});

test('graders: "none", an all-clear, prose outside FINDINGS, an absent-defect sentence or a missing defect pattern credit no bug; a repeated finding counts once', () => {
  for (const c of REVIEW_CASES.filter((x) => x.review.bugs.length)) {
    for (const text of ['FINDINGS: none', 'No issues found. LGTM.', '**FINDINGS:** None.']) assert.equal(gradeReview(c, text).found, 0, `${c.id}: ${text}`);
    for (const b of c.review.bugs) {
      const file = b.file.split('|')[0];
      assert.equal(gradeReview(c, `FINDINGS:\n- ${file}: ${b.desc}, which is fine as written.`).found, 0, `${c.id}/${b.id} absent sentence`);
    }
  }
  const l1 = REVIEW_CASES.find((x) => x.id === 'r-l1-resumable-clear');
  assert.equal(gradeReview(l1, 'The clear reason leaks its claim and the directory goes too early.\n\nFINDINGS: none').found, 0, 'prose before an empty FINDINGS header');
  const x3 = REVIEW_CASES.find((x) => x.id === 'r-x3-claim-requires-name');
  assert.equal(gradeReview(x3, 'FINDINGS:\n- apps/maestro/src/core/claims.ts: session_name is now required by readClaimFile.').found, 0, 'one of two defect patterns is not enough');
  const cap = REVIEW_CASES.find((x) => x.id === 'r-l2-sweep-default-cap');
  const twice = gradeReview(cap, `FINDINGS:\n- apps/maestro/src/core/session-sweep.ts: ${cap.review.bugs[0].desc}\n- apps/maestro/src/core/session-sweep.ts: ${cap.review.bugs[0].desc}`);
  assert.deepEqual([twice.found, twice.extra, twice.findings], [1, 0, 2]);
});

test('graders: a finding for another file that only uses a planted file word ("claims") is not credited', () => {
  const x3 = REVIEW_CASES.find((x) => x.id === 'r-x3-claim-requires-name');
  assert.equal(gradeReview(x3, 'FINDINGS:\n- apps/maestro/src/core/other.ts: session_name is required and the claims directory reads unnamed claims as absent').found, 0);
});

test('the x2 primer names the new cross-concept edge; the x1 and x4 primers list the callers of the changed symbol that the diff does not show', () => {
  assert.match(stored('r-x2-sqlite-edge', 'primer.txt'), /now imports `\.\/project-tags\.js` -> apps\/maestro\/src\/core\/project-tags\.ts \(global-stores\)/);
  const x1 = stored('r-x1-list-skips-worktree', 'primer.txt');
  assert.ok(x1.includes('`listSessionIds`') && x1.includes('liveRunIds') && x1.includes('sweepStaleSessions') && x1.includes('worktreeHasLog'));
  const x4 = stored('r-x4-liveness-state-file', 'primer.txt');
  assert.ok(x4.includes('`isSessionLive`') && x4.includes('claimTask') && x4.includes('readClaims'));
});

// ---- findings parsing ----

test('findingsOf: bullets under the last FINDINGS header, wrapped lines joined, prose after a blank line ignored', () => {
  const r = findingsOf('FINDINGS: ignored draft\n- old\n\nmore thinking\n\n**FINDINGS:**\n- a.ts: one\n  wrapped\n2. b.ts: two\n\nThanks for the review.');
  assert.deepEqual(r.items, ['a.ts: one wrapped', 'b.ts: two']);
  assert.equal(r.structured, true);
  assert.equal(r.none, false);
});

test('findingsOf: "none", an inline finding, and an unstructured review', () => {
  assert.deepEqual(findingsOf('FINDINGS: none'), { structured: true, none: true, items: [] });
  assert.deepEqual(findingsOf('**FINDINGS:** None.').items, []);
  assert.deepEqual(findingsOf('FINDINGS: a.ts: the thing breaks').items, ['a.ts: the thing breaks']);
  const u = findingsOf('No issues found. LGTM.');
  assert.deepEqual([u.structured, u.none, u.items.length], [false, true, 0]);
  assert.equal(findingsOf('- a.ts: x\n- b.ts: y').items.length, 2);
  assert.deepEqual(findingsOf(undefined).items, []);
});

// ---- spawn evidence and validity ----

const agentLine = (model) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Agent', input: { model, prompt: 'p' } }] } });
const subLine = (model) => JSON.stringify({ type: 'assistant', parent_tool_use_id: 't1', message: { model, content: [{ type: 'text', text: 'x' }] } });
const initOf = (arm, over = {}) => ({ model: REVIEW_ARMS[arm].model, tools: toolsFor(arm).split(','), ...over });

test('spawnEvidence: a Haiku subagent is shown by the call model or by a subagent message model', () => {
  assert.deepEqual(spawnEvidence('').calls, 0);
  assert.equal(spawnEvidence(agentLine('haiku')).haiku, true);
  assert.equal(spawnEvidence(agentLine('claude-haiku-5-5')).haiku, true);
  assert.equal(spawnEvidence(`${agentLine('')}\n${subLine('claude-haiku-5-5')}`).haiku, true);
  assert.equal(spawnEvidence(`${agentLine('')}\n${subLine('claude-sonnet-5-5')}`).haiku, false);
  assert.equal(spawnEvidence(agentLine('sonnet')).haiku, false);
  assert.equal(spawnEvidence(subLine('claude-haiku-5-5')).haiku, false); // a haiku message with no Agent call is no spawn
  assert.equal(spawnEvidence('not json\n').calls, 0);
});

test('reviewProblems: a spawn run is invalid unless a Haiku subagent started', () => {
  const arm = 'sonnet-spawns-haiku';
  const m = { init: initOf(arm) };
  assert.match(reviewProblems(arm, m, '').join(), /no Agent call/);
  assert.match(reviewProblems(arm, m, agentLine('sonnet')).join(), /none started a Haiku subagent/);
  assert.deepEqual(reviewProblems(arm, m, agentLine('haiku')), []);
  assert.match(reviewProblems(arm, { init: initOf(arm, { tools: REVIEW_TOOLS.split(',') }) }, agentLine('haiku')).join(), /lack Agent/);
});

test('reviewProblems: a Haiku request whose subagent ran on Sonnet is an invalid spawn run', () => {
  const arm = 'sonnet-spawns-haiku';
  const transcript = `${agentLine('haiku')}\n${subLine('claude-sonnet-5-5')}`;
  assert.match(reviewProblems(arm, { init: initOf(arm) }, transcript).join(), /none started a Haiku subagent/);
});

test('reviewProblems: other arms must have no Agent tool, no Agent call, and the arm model', () => {
  const arm = 'sonnet-diff-primer';
  assert.deepEqual(reviewProblems(arm, { init: initOf(arm) }, ''), []);
  assert.match(reviewProblems(arm, { init: initOf(arm, { tools: SPAWN_TOOLS.split(',') }) }, '').join(), /list Agent/);
  assert.match(reviewProblems(arm, { init: initOf(arm) }, agentLine('haiku')).join(), /Agent call/);
  assert.match(reviewProblems(arm, { init: initOf(arm, { model: 'claude-haiku-5-5' }) }, '').join(), /init model/);
  assert.match(reviewProblems('haiku-diff-primer', { init: initOf('haiku-diff-primer', { tools: [...REVIEW_TOOLS.split(','), 'Edit'] }) }, '').join(), /beyond the arm's set: Edit/);
  assert.deepEqual(reviewProblems(arm, { init: null }, ''), []); // a missing init is lib.validity's problem
});

// ---- primer building blocks ----

test('parseFileVertices and changedSymbols: the symbols whose lines overlap the change', () => {
  const v = parseFileVertices('# File: x.ts\nVertices: 2\n\n## `a` (function, c1) — L10-20\n — doc\n\n## `T` (type-def, c1) — L22-22\n');
  assert.deepEqual(v.map((x) => [x.name, x.type, x.concept, x.start, x.end]), [['a', 'function', 'c1', 10, 20], ['T', 'type-def', 'c1', 22, 22]]);
  assert.deepEqual(changedSymbols(v, 15, 15).map((x) => x.name), ['a']);
  assert.deepEqual(changedSymbols(v, 21, 21), []);
  assert.deepEqual(changedSymbols(v, 20, 22).map((x) => x.name), ['a', 'T']);
});

test('parseImpact: direct and indirect callers, duplicates dropped', () => {
  const r = parseImpact('# Impact\n\n## Direct callers\n\n- @a/b.ts:5 — `f`\n- @a/b.ts:5 — `f`\n- @c.ts:9 — `g`\n\n## Indirect callers (depth 2)\n\n- @d.ts:1 — `h`\n');
  assert.deepEqual(r.direct.map((x) => x.name), ['f', 'g']);
  assert.deepEqual(r.indirect.map((x) => x.name), ['h']);
  assert.deepEqual(parseImpact('nothing').direct, []);
});

test('addedImports and importCandidates: only new relative imports, resolved against the importing file', () => {
  const before = 'import { a } from "./a.js";\nimport z from "zod";\n';
  assert.deepEqual(addedImports({ before, added: ['import { b } from "./b.js";', 'import { a } from "./a.js";', 'import q from "pkg";'] }), ['./b.js']);
  assert.deepEqual(addedImports({ before, added: ['import {', '  x,', '} from "../up/x.js";'] }), ['../up/x.js']);
  assert.deepEqual(importCandidates('apps/m/src/core/h.ts', './project-tags.js'), ['apps/m/src/core/project-tags.ts', 'apps/m/src/core/project-tags.tsx', 'apps/m/src/core/project-tags/index.ts']);
  assert.equal(importCandidates('apps/m/src/core/h.ts', '../shared/ipc.js')[0], 'apps/m/src/shared/ipc.ts');
});

test('untestedCallers: a caller is tested when a test text mentions its name as a whole word', () => {
  const callers = [{ name: 'readClaims', file: 'a', line: 1 }, { name: 'claimTask', file: 'a', line: 2 }, { name: 'get', file: 'a', line: 3 }];
  assert.deepEqual(untestedCallers(callers, 'it("readClaims", ...) widget budget').map((c) => c.name), ['claimTask', 'get']);
  assert.deepEqual(untestedCallers(callers, 'readClaimsX claimTask get').map((c) => c.name), ['readClaims']);
});

test('buildPrimer: sections in fixed order, same input gives the same text, module-level and empty cases are said plainly', () => {
  const data = {
    files: [{ file: 'a.ts', concept: 'c1', symbols: [{ name: 'f', start: 1, end: 9, impact: '# Impact\n\n## Direct callers\n\n- @b.ts:2 — `g`\n' }], newEdges: [{ spec: './x.js', target: 'x.ts', targetConcept: 'c2' }, { spec: './y.js', target: 'y.ts', targetConcept: 'c1' }] },
    { file: 'k.ts', concept: '', symbols: [], newEdges: [] }],
    untested: [{ symbol: 'f', callers: [{ name: 'g', file: 'b.ts', line: 2 }] }],
    cross: [{ a: 'c1', b: 'c2', text: '# Cross\n\n- `c1::f` --calls--> `c2::h`\n' }],
  };
  const t = buildPrimer(data);
  assert.equal(t, buildPrimer(JSON.parse(JSON.stringify(data))));
  const order = ['## Changed symbols', '## Impact of each changed symbol', '## Untested callers', '## New cross-concept edges', '## Cross-concept relations'].map((h) => t.indexOf(h));
  assert.ok(order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1])), String(order));
  assert.ok(t.includes('- `g` (b.ts:2) calls `f`'));
  assert.ok(t.includes('now imports `./x.js` -> x.ts (c2)'));
  assert.ok(!t.includes('./y.js'), 'same-concept import is not a cross-concept edge');
  assert.ok(t.includes('k.ts (concept none: outside every concept): no indexed symbol overlaps'));
  assert.ok(t.includes('`c1::f` --calls--> `c2::h`') && !t.includes('\n# Cross\n'));
  const empty = buildPrimer({ files: [{ file: 'a.ts', concept: 'c', symbols: [], newEdges: [] }], untested: [], cross: [] });
  assert.ok(empty.includes('none (no indexed symbol changed)') && empty.includes('## New cross-concept edges added by the diff\n\nnone'));
});

// ---- verdicts, tallies, report ----

const g = (bugs, extra = 0) => ({ bugs, planted: bugs.length, found: bugs.filter((b) => b.found).length, findings: 0, extra, falseAlarms: 0, clean: false, structured: true });
const row = (arm, grade, over = {}) => ({ case: 'c', arm, run: 1, m: { cost: 0.5, turns: 3 }, problems: [], status: 'valid', grade, ...over });
const bug = (category, found) => ({ id: 'b', category, found });

test('verdict: helps needs a third of the missed bugs and at least 3; under 3 missed is inconclusive; hurts at 3 more missed', () => {
  const b = (found, planted = 12) => ({ found, planted });
  assert.equal(verdict(b(10), b(12)).v, 'inconclusive (baseline misses under 3)');
  assert.equal(verdict(b(6), b(9)).v, 'helps'); // missed 6 -> 3: recovers 3, half
  assert.equal(verdict(b(6), b(8)).v, 'no effect shown'); // recovers 2, under the floor of 3
  assert.equal(verdict(b(0, 12), b(3, 12)).v, 'no effect shown'); // 12 missed, recovers 3 but 3*3 < 12
  assert.equal(verdict(b(0, 12), b(4, 12)).v, 'helps'); // exactly a third and at least 3
  assert.equal(verdict(b(9), b(5)).v, 'hurts');
  assert.equal(verdict(b(9), b(7)).v, 'no effect shown');
  assert.match(verdict({ found: 3, planted: 6 }, { found: 3, planted: 9 }).v, /not comparable/);
});

test('tally: counts valid runs only, per category, with clean-diff false alarms and cost', () => {
  const clean = { ...g([]), clean: true, falseAlarms: 2, structured: true };
  const rows = [
    row('a', g([bug('local', true), bug('cross', false)], 1)),
    row('a', clean),
    row('a', g([bug('local', true)]), { status: 'invalid', problems: ['x'] }),
    row('b', g([bug('cross', true)]), { m: { cost: 0.1 } }),
  ];
  const t = tally(rows);
  assert.deepEqual(t.a.local, { found: 1, planted: 1 });
  assert.deepEqual(t.a.cross, { found: 0, planted: 1 });
  assert.deepEqual([t.a.runs, t.a.cleanRuns, t.a.falseAlarms, t.a.extra, t.a.cost], [2, 1, 2, 1, 1]);
  assert.deepEqual(t.b.overall, { found: 1, planted: 1 });
});

test('tally: a (case, run) cell counts only when every planned arm has a valid run there', () => {
  const at = (arm, cs, run, status = 'valid') => row(arm, g([bug('local', true)]), { case: cs, run, status });
  const rows = [at('a', 'c1', 1), at('b', 'c1', 1), at('a', 'c1', 2), at('b', 'c1', 2, 'invalid'), at('a', 'c2', 1)];
  const planned = [{ case: 'c1', arm: 'a', run: 1 }, { case: 'c1', arm: 'b', run: 1 }, { case: 'c1', arm: 'a', run: 2 }, { case: 'c1', arm: 'b', run: 2 }, { case: 'c2', arm: 'a', run: 1 }, { case: 'c2', arm: 'b', run: 1 }];
  assert.equal(pairedRows(rows, planned).length, 2); // only c1 run 1, both arms
  const t = tally(rows, planned);
  assert.equal(t.a.runs, 1);
  assert.equal(t.b.runs, 1);
  assert.equal(t.a.overall.planted, t.b.overall.planted);
  assert.equal(pairedRows(rows).length, 3); // without a plan, only arms with a row at the cell are required (c2 has just arm a)
});

test('reviewReport: lists invalid runs, per-arm table and a verdict row per non-baseline arm', () => {
  const rows = [
    row(BASELINE, g([bug('local', false), bug('local', false), bug('local', false), bug('cross', true)])),
    row('sonnet-diff-primer', g([bug('local', true), bug('local', true), bug('local', true), bug('cross', true)])),
    row('sonnet-spawns-haiku', g([bug('local', true)]), { case: 'c2', status: 'invalid', problems: ['invalid spawn run: no Agent call, so no Haiku subagent started'] }),
  ];
  const md = reviewReport(rows, { spent: 1.5, budget: 10 });
  assert.match(md, /INVALID OR USAGE-LIMIT RUNS \(1/);
  assert.match(md, /invalid spawn run/);
  assert.match(md, /\| sonnet-diff-primer \| helps \(missed 3 -> 0\)/);
  assert.ok(!/\| sonnet-spawns-haiku \| helps/.test(md), 'invalid runs are not counted');
  assert.match(md, /spent \$1\.500 of \$10/);
});

test('selectReviewCases: --only takes a comma-separated list, and the pilot list samples every category', () => {
  assert.equal(selectReviewCases('').length, REVIEW_CASES.length);
  assert.deepEqual(selectReviewCases('r-l1, r-x3').map((c) => c.id), ['r-l1-resumable-clear', 'r-x3-claim-requires-name']);
  assert.equal(selectReviewCases('nope').length, 0);
  const pilot = selectReviewCases(PILOT_ONLY);
  assert.equal(pilot.length, 5);
  const bugs = pilot.flatMap((c) => c.review.bugs);
  assert.equal(bugs.filter((b) => b.category === 'local').length, 2);
  assert.equal(bugs.filter((b) => b.category === 'cross').length, 2);
  assert.equal(pilot.filter((c) => !c.review.bugs.length).length, 1);
});
