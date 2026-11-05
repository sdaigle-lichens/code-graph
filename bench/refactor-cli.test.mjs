// 070 refactor mode, real command paths: the $0 scripts run as the README tells the user to run them.
// refactor-prep --check and the dry runs need the pinned maestro checkout and the code-graph bundle; those
// tests skip when no maestro checkout is found. Nothing here calls claude and nothing spends money.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

test('refactor-run --dry: plans 11 cases x 4 arms per run number, prints each cell, exits 0 without any cap', { skip: noMaestro }, () => {
  const r = run('refactor-run.mjs', ['--dry', '--runs', '1']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /refactor-run: 44 cells \(sonnet-plain 11, haiku-metrics-primer 11, haiku-scout-sonnet-filter 11, sonnet-spawns-haiku-scouts 11\)/);
  const printed = r.stdout.split('\n').filter((l) => /^\[f-/.test(l));
  assert.equal(printed.length, 44);
  assert.equal(printed.filter((l) => l.includes('a filter session (Sonnet)')).length, 11, 'only the pipeline arm has a second session');
});

test('refactor-run --dry: the default is 3 runs per cell (132 cells)', { skip: noMaestro }, () => {
  const r = run('refactor-run.mjs', ['--dry']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /refactor-run: 132 cells /);
});

test('refactor-run --dry: only the spawn arm gets the Agent tool; the pipeline\'s first session is Haiku', { skip: noMaestro }, () => {
  const r = run('refactor-run.mjs', ['--dry', '--runs', '1']);
  const claudeLines = r.stdout.split('\n').filter((l) => l.startsWith('claude '));
  assert.equal(claudeLines.length, 44);
  const withAgent = claudeLines.filter((l) => l.includes('"--allowedTools" "Bash,Read,Grep,Glob,Skill,Agent"') && l.includes('"--tools" "Bash,Read,Grep,Glob,Skill,Agent"'));
  assert.equal(withAgent.length, 11);
  assert.ok(withAgent.every((l) => l.includes('"--model" "claude-sonnet-5-5"')));
  const heads = r.stdout.split('\n').filter((l) => /^\[f-\S+ haiku-scout-sonnet-filter run1\]/.test(l));
  assert.equal(heads.length, 11);
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
  assert.equal(real.length, 4);
  for (const c of real) {
    const m = /^maestro ([0-9a-f]{7}) "([^"]+)"/.exec(c.refactor.source);
    assert.ok(m, `${c.id} names its source commit`);
    const r = spawnSync('git', ['-C', dir, 'log', '-1', '--format=%s', m[1]], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${c.id}: ${m[1]} is not a commit of the checkout`);
    assert.equal(r.stdout.trim(), m[2], `${c.id}: the subject of ${m[1]} is the title the case names`);
  }
});

test('refactor-prep --check: every stored scope and primer regenerates byte for byte from the pinned maestro checkout, and every plant applies', { skip: noMaestro }, () => {
  const r = run('refactor-prep.mjs', ['--check']);
  assert.equal(r.status, 0, r.stdout.slice(-600) + r.stderr.slice(-300));
  const rows = r.stdout.split('\n').filter((l) => /^f-\S+\.(scope|primer)\.txt: /.test(l));
  assert.equal(rows.length, 22);
  assert.equal(rows.filter((l) => /: unchanged /.test(l)).length, 22);
});
