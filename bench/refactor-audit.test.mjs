// Ticket 071: the fixed audit and the usefulness metric, against known-good and known-bad inputs. The grep of
// the pinned tree is injected, so nothing here needs the maestro checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { KNOWN_CONFIRMED, buildPool, mechanicalCheck, parseVerdicts, poolText, registryKey, scoreUseful, usefulReport, usefulVerdict } from './refactor-audit.mjs';
import { REFACTOR_CASES } from './refactor-cases.mjs';
import { gradeRefactor } from './refactor.mjs';

const cases = new Map(REFACTOR_CASES.map((c) => [c.id, c]));
const L1 = cases.get('f-l1-tasks-sections');
const ctx = (mentions = {}, defs = {}) => ({ mentions: (n) => mentions[n] || [], defs: (n) => defs[n] || [] });

test('the registry confirms the improvements the 070 audit found, and nothing else', () => {
  assert.equal(registryKey('plugins/maestro/scripts/a.cjs: dedupe: readGlobalHandoff is copied in three plugin scripts, share it.').key, 'readGlobalHandoff-copies');
  assert.equal(registryKey('apps/maestro/src/core/session-title.ts: dedupe: SessionTitleRef repeats SessionRef from session-sweep.ts.').key, 'session-ref-interfaces');
  assert.equal(registryKey('apps/maestro/src/core/tasks.ts: align-pattern: rename the local variable.'), null);
  assert.equal(new Set(KNOWN_CONFIRMED.map((k) => k.key)).size, KNOWN_CONFIRMED.length);
});

test('mechanical checks: an unused export mentioned only by a barrel is confirmed, one with a real importer is refuted, a function defined twice is confirmed', () => {
  const unused = 'apps/maestro/src/core/session-log.ts: remove-unused: `readSessionLog` is exported but nothing imports it.';
  assert.equal(mechanicalCheck(unused, ctx({ readSessionLog: ['apps/maestro/src/core/session-log.ts', 'apps/maestro/src/core/index.ts'] })).status, 'confirmed');
  const used = mechanicalCheck(unused, ctx({ readSessionLog: ['apps/maestro/src/core/session-log.ts', 'apps/maestro/src/main/ipc.ts'] }));
  assert.equal(used.status, 'unconfirmed');
  assert.match(used.evidence, /ipc\.ts/);
  assert.equal(mechanicalCheck(unused, ctx()), null, 'no mention at all: a hand verdict');
  const copies = 'a.ts: dedupe: `titleCase` is written twice.';
  assert.equal(mechanicalCheck(copies, ctx({}, { titleCase: ['a.ts', 'b.ts'] })).key, 'copies:titleCase');
  assert.equal(mechanicalCheck(copies, ctx({}, { titleCase: ['a.ts'] })), null);
  assert.equal(mechanicalCheck('a.ts: align-pattern: use the sibling style.', ctx()), null);
});

test('the pool: arm labels stripped, one entry per distinct (case, text), expected and tolerated left out, deterministic order', () => {
  const extra = 'apps/maestro/src/core/tasks.ts: extract-helper: `slug` is built the same way in two places, extract it.';
  const rowsA = [
    { case: L1.id, arm: 'sonnet-plain', run: 1, status: 'valid', problems: [], grade: { items: [L1.samples.good.split('\n').find((l) => l.startsWith('- ')).slice(2), extra] } },
    { case: L1.id, arm: 'haiku-metrics-primer', run: 1, status: 'valid', problems: [], grade: { items: [extra.toUpperCase().replace('SLUG', 'slug')] } },
  ];
  const pool = buildPool(rowsA, cases, ctx({}, { slug: ['a.ts', 'b.ts'] }));
  assert.equal(pool.length, 1, 'the expected item is not judged and the same text from two arms is one entry');
  assert.equal(pool[0].auto.key, 'copies:slug');
  assert.ok(!('arm' in pool[0]) && !JSON.stringify(pool).includes('sonnet-plain'));
  assert.deepEqual(buildPool(rowsA, cases, ctx()).map((p) => p.id), ['p1']);
  assert.equal(poolText(buildPool(rowsA, cases, ctx())).includes('[f-l1-tasks-sections]'), true);
  assert.equal(poolText(pool).trim(), '', 'an auto-judged item needs no hand verdict');
});

test('parseVerdicts: confirmed with an issue key, unconfirmed with a reason; other lines ignored', () => {
  const m = parseVerdicts('p1: confirmed slug-copies: grep shows two definitions\np2: unconfirmed: the helper already exists in lib.ts\nnoise line\n');
  assert.deepEqual(m.get('p1'), { status: 'confirmed', key: 'slug-copies', evidence: 'grep shows two definitions' });
  assert.equal(m.get('p2').status, 'unconfirmed');
  assert.equal(m.size, 2);
});

const mkRow = (arm, text, cost, run = 1) => {
  const g = gradeRefactor(L1, text);
  return { case: L1.id, arm, run, status: 'valid', problems: [], m: { cost }, grade: g };
};

test('scoreUseful: expected found + confirmed once per key, unconfirmed and unjudged are noise, tolerated neutral, per dollar from the paired cost', () => {
  const dup = 'apps/maestro/src/core/tasks.ts: extract-helper: `slug` is built the same way in two places, extract it.';
  const bad = 'apps/maestro/src/core/tasks.ts: align-pattern: invented problem nobody has.';
  const tol = 'apps/maestro/src/core/tasks.ts: dedupe: taskHeading and parseTitle are a pair.';
  const good = L1.samples.good;
  const rows = [
    mkRow('sonnet-plain', `${good}\n- ${bad}`, 0.2),
    mkRow('haiku-metrics-primer', `${good}\n- ${dup}\n- ${dup}\n- ${tol}\n- ${bad}`, 0.05),
  ];
  const pool = buildPool(rows, cases, ctx({}, { slug: ['a.ts', 'b.ts'] }));
  const planned = [{ case: L1.id, arm: 'sonnet-plain', run: 1 }, { case: L1.id, arm: 'haiku-metrics-primer', run: 1 }];
  const res = scoreUseful(rows, planned, cases, pool);
  assert.equal(res['sonnet-plain'].expected, 2);
  assert.equal(res['sonnet-plain'].useful, 2);
  assert.equal(res['sonnet-plain'].noise, 1, 'the unjudged invented problem is noise');
  assert.equal(res['sonnet-plain'].unjudged, 1);
  assert.equal(res['haiku-metrics-primer'].useful, 3, 'two expected + one confirmed copy, the repeat counted once');
  assert.equal(res['haiku-metrics-primer'].audited, 1);
  assert.ok(res['haiku-metrics-primer'].neutral >= 2, 'the repeat and the tolerated pair are neutral');
  assert.ok(Math.abs(res['haiku-metrics-primer'].perDollar - 60) < 1e-6);
  assert.ok(Math.abs(res['sonnet-plain'].perDollar - 10) < 1e-6);
  const manual = parseVerdicts(`${pool.find((p) => p.item === bad).id}: unconfirmed: nothing there\n`);
  const judged = scoreUseful(rows, planned, cases, pool, manual);
  assert.equal(judged['sonnet-plain'].unjudged, 0);
  assert.equal(judged['sonnet-plain'].noise, 1);
});

test('usefulVerdict: better per dollar needs 1.5x the useful per dollar, 70% of the useful, a noise share within 10 points and no category losing 3; a category overrides the overall', () => {
  const B = { runs: 6, cost: 1, useful: 10, noise: 2, perDollar: 10, noiseShare: 2 / 12, byCat: { dedupe: 5, extract: 4, align: 1, cycle: 0, unused: 0 } };
  const X = (o) => ({ runs: 6, cost: 0.3, useful: 8, noise: 2, perDollar: 26.7, noiseShare: 0.2, byCat: { dedupe: 4, extract: 3, align: 1, cycle: 0, unused: 0 }, ...o });
  assert.equal(usefulVerdict(B, X({})).v, 'better per dollar');
  assert.match(usefulVerdict(B, X({ byCat: { dedupe: 1, extract: 3, align: 1, cycle: 0, unused: 0 } })).v, /blocked: loses dedupe/, 'a losing category blocks a winning overall');
  assert.equal(usefulVerdict(B, X({ useful: 5, perDollar: 16 })).v, 'no gain shown', 'cheaper per useful finding but under 70% of the useful');
  assert.match(usefulVerdict(B, X({ noiseShare: 0.5 })).v, /noisier/);
  assert.equal(usefulVerdict(B, X({ perDollar: 8 })).v, 'worse per dollar');
  assert.match(usefulVerdict(B, X({ runs: 5 })).v, /not comparable/);
  assert.match(usefulVerdict({ ...B, perDollar: null }, X({})).v, /inconclusive/);
});

test('usefulReport: the table, the verdicts and the 070 figures beside it', () => {
  const t = (useful, cost) => ({ runs: 2, cost, useful, noise: 1, unjudged: 0, expected: useful, audited: 0, perDollar: useful / cost, noiseShare: 1 / (useful + 1), byCat: { dedupe: useful, extract: 0, align: 0, cycle: 0, unused: 0 } });
  const md = usefulReport({ 'sonnet-plain': t(4, 0.4), 'haiku-metrics-primer': t(3, 0.04) }, { 'sonnet-plain': { found: 4, planted: 6, falseFindings: 2 } });
  assert.match(md, /## Useful findings per dollar/);
  assert.match(md, /haiku-metrics-primer: better per dollar/);
  assert.match(md, /sonnet-plain: kept 4\/6, false findings 2/);
});
