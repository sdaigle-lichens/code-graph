// 070 refactor mode, real command paths: the $0 scripts run as the README tells the user to run them.
// refactor-prep --check and the dry runs need the pinned maestro checkout and the code-graph bundle; those
// tests skip when no maestro checkout is found. Nothing here calls claude and nothing spends money.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMaestroDir } from './maestro-dir.mjs';
import { REFACTOR_CASES } from './refactor-cases.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const run = (script, args, env = process.env, timeout = 600000) =>
  spawnSync('node', [join(here, script), ...args], { encoding: 'utf8', timeout, env });
// A session marker would make a paid run refuse before the cap check; the cap tests need it absent.
const { CLAUDECODE, SANDBOX_RUNTIME, CLAUDE_CODE_ENTRYPOINT, ...plainEnv } = process.env;

let haveMaestro = true;
try { resolveMaestroDir(); } catch { haveMaestro = false; }
const noMaestro = haveMaestro ? false : 'no maestro checkout on this machine (set MAESTRO_DIR)';

test('refactor-run --dry: plans the 6 cases of set 071 x the 4 default arms plus the control review, prints each (case, arm), exits 0 without any cap', { skip: noMaestro }, () => {
  const r = run('refactor-run.mjs', ['--dry', '--runs', '1']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /refactor-run: set 071, 6 cases, 30 cells \(sonnet-plain 6, haiku-metrics-primer 6, haiku-batched-filter 6, haiku-reviewer-inline 6, sonnet-review-plain 6\)/);
  assert.ok(!r.stdout.includes('sonnet-spawns-haiku-scouts') && !r.stdout.includes('haiku-scout-sonnet-filter'), 'the 070 arms are off by default');
  const printed = r.stdout.split('\n').filter((l) => /^\[f-/.test(l));
  assert.equal(printed.length, 30);
  assert.equal(printed.filter((l) => l.includes('one Sonnet batch filter per batch')).length, 6, 'only the batched arm shares a filter session');
  assert.equal(printed.filter((l) => l.includes('review prompt')).length, 12, 'the inline arm and the control review the same change');
  assert.match(r.stdout, /batch 1: f-r5-plugin-scripts-05d5b76, f-c2-session-ipc, f-l1-tasks-sections \| batch 2: f-s5-titlecase-copies, f-l2-session-sweep, f-l3-atomic-json-writes/);
});

test('refactor-run --dry: the default is 2 runs per cell (60 cells)', { skip: noMaestro }, () => {
  const r = run('refactor-run.mjs', ['--dry']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /refactor-run: set 071, 6 cases, 60 cells /);
});

test('refactor-run --dry: no cell has the Agent tool; the 070 arms are refused by this runner; the inline arm pulls in the control review', { skip: noMaestro }, () => {
  const def = run('refactor-run.mjs', ['--dry', '--runs', '1']);
  const defLines = def.stdout.split('\n').filter((l) => l.startsWith('  claude '));
  assert.equal(defLines.length, 30);
  assert.equal(defLines.filter((l) => l.includes(',Agent"')).length, 0);
  const spawn = run('refactor-run.mjs', ['--dry', '--arms', 'sonnet-spawns-haiku-scouts']);
  assert.equal(spawn.status, 2);
  assert.match(spawn.stderr, /does not orchestrate them/);
  const inl = run('refactor-run.mjs', ['--dry', '--runs', '1', '--arms', 'haiku-reviewer-inline']);
  assert.equal(inl.status, 0, inl.stderr);
  assert.match(inl.stdout, /12 cells \(haiku-reviewer-inline 6, sonnet-review-plain 6\)/);
});

test('refactor-run --dry: the 070 set is still selectable with --set 070', { skip: noMaestro }, () => {
  const r = run('refactor-run.mjs', ['--dry', '--runs', '1', '--set', '070', '--arms', 'sonnet-plain']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /refactor-run: set 070, /);
});

test('refactor-run: a paid run without both caps is refused with exit 2 and no session starts', () => {
  for (const args of [[], ['--budget', '5'], ['--run-budget', '1'], ['--budget', 'x', '--run-budget', '1'], ['--budget', '5', '--run-budget', '0']]) {
    const r = run('refactor-run.mjs', args, plainEnv);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /needs both --budget/);
    assert.equal(r.stdout.includes('refactor-run:'), false);
  }
});

test('refactor-run: an unknown arm or option exits 2 before any cell starts', () => {
  const arm = run('refactor-run.mjs', ['--dry', '--arms', 'sonnet-plain,opus']);
  assert.equal(arm.status, 2);
  assert.match(arm.stderr, /unknown refactor arm/);
  const opt = run('refactor-run.mjs', ['--dry', '--bogus']);
  assert.equal(opt.status, 2);
  assert.match(opt.stderr, /unknown option/);
});

test('refactor-run --dry: a case filter that matches nothing exits 2', () => {
  const r = run('refactor-run.mjs', ['--dry', '--only', 'no-such-case']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no case matches/);
});

test('refactor-run --dry with a broken maestro checkout exits non-zero', { skip: noMaestro }, () => {
  const r = run('refactor-run.mjs', ['--dry'], { ...process.env, MAESTRO_DIR: '/nonexistent/maestro-070' });
  assert.notEqual(r.status, 0, r.stdout.slice(0, 200));
});

test('refactor-prep: an unknown case filter exits 2', () => {
  const r = run('refactor-prep.mjs', ['--only', 'no-such-case']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no case matches/);
});

test('the real cases name a source commit that exists in the maestro checkout, with its subject as the quoted title; the pin exists', { skip: noMaestro }, () => {
  const dir = resolveMaestroDir();
  const pin = spawnSync('git', ['-C', dir, 'cat-file', '-e', '3814a30^{commit}'], { encoding: 'utf8' });
  assert.equal(pin.status, 0, 'the pinned commit 3814a30 is in the checkout');
  const real = REFACTOR_CASES.filter((c) => c.kind === 'real');
  assert.equal(real.length, 1);
  for (const c of real) {
    const m = /^maestro ([0-9a-f]{7}) "([^"]+)"/.exec(c.refactor.source);
    assert.ok(m, `${c.id} names its source commit`);
    const r = spawnSync('git', ['-C', dir, 'log', '-1', '--format=%s', m[1]], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${c.id}: ${m[1]} is not a commit of the checkout`);
    assert.equal(r.stdout.trim(), m[2], `${c.id}: the subject of ${m[1]} is the title the case names`);
  }
});

// The runner's own session path (setup, validity, grading, status, report) with `claude` replaced by a stub on
// PATH that prints an init event and one result event carrying `answer`. No model is called, nothing is spent.
function runWithStubClaude(answer, caseId = 'f-c1-canvas-layout') {
  const bin = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'refactor-cli-claude-'));
  const skills = REFACTOR_CASES.find((c) => c.id === caseId).skills;
  const stub = join(bin, 'claude');
  writeFileSync(stub, `#!/usr/bin/env node
const init = { type: 'system', subtype: 'init', model: 'claude-sonnet-5-5', tools: ['Bash', 'Read', 'Grep', 'Glob', 'Skill'], skills: ${JSON.stringify(skills)}, plugins: [], slash_commands: [], agents: [] };
const result = { type: 'result', subtype: 'success', is_error: false, result: ${JSON.stringify(answer)}, total_cost_usd: 0.05, num_turns: 2 };
process.stdout.write(JSON.stringify(init) + '\\n' + JSON.stringify(result) + '\\n');
`);
  chmodSync(stub, 0o755);
  const r = spawnSync('node', [join(here, 'refactor-run.mjs'), '--budget', '1', '--run-budget', '0.5', '--set', '070', '--only', caseId, '--arms', 'sonnet-plain', '--runs', '1'], {
    encoding: 'utf8', timeout: 300000, env: { ...plainEnv, PATH: `${bin}:${process.env.PATH}` },
  });
  const dir = /^results: (.+)$/m.exec(r.stdout)?.[1];
  try {
    return {
      r,
      runs: dir ? JSON.parse(readFileSync(join(dir, 'runs.json'), 'utf8')) : null,
      report: dir ? readFileSync(join(dir, 'report.md'), 'utf8') : '',
    };
  } finally {
    rmSync(bin, { recursive: true, force: true });
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

test('refactor-run, real runner: an unstructured clean-case answer is an invalid run, listed with the reason and a "no (unstructured)" column, and not counted', { skip: noMaestro }, () => {
  const { r, runs, report } = runWithStubClaude('The neighbourhood is fine as it is; nothing to propose.');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(runs.rows.length, 1);
  assert.equal(runs.rows[0].status, 'invalid');
  assert.equal(runs.rows[0].grade.structured, false);
  assert.match(runs.rows[0].problems.join('\n'), /sonnet-plain: the answer has no PROPOSALS section \(unstructured\); the run is not counted/);
  assert.match(report, /## INVALID OR USAGE-LIMIT RUNS \(1, not counted\)/);
  assert.match(report, /- f-c1-canvas-layout sonnet-plain run1: sonnet-plain: the answer has no PROPOSALS section/);
  assert.match(report, /\| f-c1-canvas-layout \| sonnet-plain \| 1 \| NO \|[^\n]*\| no \(unstructured\) \|/);
  assert.match(report, /Counted: 0 of 0 valid runs\./);
});

test('refactor-run, real runner: "PROPOSALS: none" after a prose sentence on a clean case is a valid run with nothing counted as a false finding', { skip: noMaestro }, () => {
  const { r, runs, report } = runWithStubClaude('The neighbourhood is fine as it is.\n\nPROPOSALS: none');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(runs.rows[0].status, 'valid');
  assert.equal(runs.rows[0].grade.structured, true);
  assert.equal(runs.rows[0].grade.falseFindings, 0);
  assert.match(report, /No invalid run\./);
  assert.match(report, /\| f-c1-canvas-layout \| sonnet-plain \| 1 \| yes \| 0\/0 \| 0 \| 0 \(clean case\) \| 0 \| yes \|/);
});

test('refactor-run, real runner: all-clear bullets on a clean case are an all-clear count, not false findings; the run is valid', { skip: noMaestro }, () => {
  const { r, runs, report } = runWithStubClaude('PROPOSALS:\n- nothing to change here\n- the module is fine as written.');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(runs.rows[0].status, 'valid');
  assert.equal(runs.rows[0].grade.structured, true);
  assert.equal(runs.rows[0].grade.proposals, 0);
  assert.equal(runs.rows[0].grade.falseFindings, 0);
  assert.equal(runs.rows[0].grade.allClear, 2);
  assert.match(report, /\| f-c1-canvas-layout \| sonnet-plain \| 1 \| yes \| 0\/0 \| 0 \| 0 \(clean case\) \| 2 \| yes \|/);
  assert.match(report, /\| sonnet-plain \| 1 \| 0\/0 \| 0\/0 \| 0\/0 \| 0\/0 \| 0\/0 \| 0\/0 \| 0 \| 2 \|/, 'the per-arm all-clear column');
});

test('refactor-run, real runner: a real proposal beside an all-clear bullet on the planted case is found and counted; the bullet is its own count', { skip: noMaestro }, () => {
  const c = REFACTOR_CASES.find((x) => x.id === 'f-s5-titlecase-copies');
  const { r, runs, report } = runWithStubClaude(`${c.samples.good}\n- nothing to change here`, c.id);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(runs.rows[0].status, 'valid');
  assert.equal(runs.rows[0].grade.found, 1);
  assert.equal(runs.rows[0].grade.proposals, 1, 'the real proposal is counted, the bullet is not');
  assert.equal(runs.rows[0].grade.falseFindings, 0);
  assert.equal(runs.rows[0].grade.allClear, 1);
  assert.match(report, /\| f-s5-titlecase-copies \| sonnet-plain \| 1 \| yes \| 1\/1 \| 1 \| 0 \| 1 \| yes \|/);
});

test('refactor-prep --check: every stored scope and primer regenerates byte for byte from the pinned maestro checkout, and every plant applies', { skip: noMaestro }, () => {
  const r = run('refactor-prep.mjs', ['--check']);
  assert.equal(r.status, 0, r.stdout.slice(-600) + r.stderr.slice(-300));
  const rows = r.stdout.split('\n').filter((l) => /^f-\S+\.(scope|primer)\.txt: /.test(l));
  assert.equal(rows.length, REFACTOR_CASES.length * 2);
  assert.equal(rows.filter((l) => /: unchanged /.test(l)).length, REFACTOR_CASES.length * 2);
});
