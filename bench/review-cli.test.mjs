// 066 review mode, real command paths: the $0 scripts run as the README tells the user to run them.
// review-prep --check needs the pinned maestro checkout and the code-graph bundle; those tests skip when
// no maestro checkout is found. Nothing here calls claude.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMaestroDir } from './maestro-dir.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const run = (script, args, env = process.env, timeout = 300000) =>
  spawnSync('node', [join(here, script), ...args], { encoding: 'utf8', timeout, env });

let haveMaestro = true;
try { resolveMaestroDir(); } catch { haveMaestro = false; }
const noMaestro = haveMaestro ? false : 'no maestro checkout on this machine (set MAESTRO_DIR)';

test('review-run --dry: plans 15 cases x 3 planned arms per run number, prints each run, exits 0', { skip: noMaestro }, () => {
  const r = run('review-run.mjs', ['--dry', '--runs', '1']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /review-run: 45 runs \(sonnet-nograph 15, haiku-diff-primer 15, haiku-nograph 15\)/);
  const printed = r.stdout.split('\n').filter((l) => /^\[r-/.test(l));
  assert.equal(printed.length, 45);
  assert.equal(printed.filter((l) => l.includes('sonnet-spawns-haiku')).length, 0, 'the spawn arm is not planned');
  assert.equal(printed.filter((l) => l.includes('sonnet-diff-primer')).length, 0, 'the Sonnet primer arm is not planned');
});

test('review-run --dry: the default is 3 runs per cell (135 runs)', { skip: noMaestro }, () => {
  const r = run('review-run.mjs', ['--dry']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /review-run: 135 runs /);
});

test('review-run --dry: only the spawn arm gets the Agent tool, and every run is named with its arm', { skip: noMaestro }, () => {
  const r = run('review-run.mjs', ['--dry', '--runs', '1', '--arms', 'sonnet-nograph,sonnet-diff-primer,haiku-diff-primer,sonnet-spawns-haiku']);
  const lines = r.stdout.split('\n');
  const claudeLines = lines.filter((l) => l.startsWith('claude '));
  assert.equal(claudeLines.length, 60);
  const spawnHeaders = lines.filter((l) => /^\[r-\S+ sonnet-spawns-haiku run1\]/.test(l));
  assert.equal(spawnHeaders.length, 15);
  // each claude line carries --allowedTools and --tools; only the 15 spawn runs carry Agent in both
  const withAgent = claudeLines.filter((l) => l.includes('"--allowedTools" "Bash,Read,Grep,Glob,Skill,Agent"') && l.includes('"--tools" "Bash,Read,Grep,Glob,Skill,Agent"'));
  assert.equal(withAgent.length, 15, 'spawn arm: --allowedTools and --tools both list Agent');
  assert.ok(claudeLines.every((l) => (l.includes('"--model" "claude-haiku-5-5"') ? !l.includes('Skill,Agent') : true)), 'no Haiku run has Agent');
});

test('review-run: an unknown arm or option exits 2 before any run starts', () => {
  const arm = run('review-run.mjs', ['--dry', '--arms', 'sonnet-nograph,opus']);
  assert.equal(arm.status, 2);
  assert.match(arm.stderr, /unknown review arm/);
  const opt = run('review-run.mjs', ['--dry', '--bogus']);
  assert.equal(opt.status, 2);
  assert.match(opt.stderr, /unknown option/);
  assert.equal(arm.stdout.includes('[r-'), false);
});

test('review-run --dry: a case filter that matches nothing exits 2', () => {
  const r = run('review-run.mjs', ['--dry', '--only', 'no-such-case']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no case matches/);
});

test('review-run --dry with a broken maestro checkout exits non-zero', { skip: noMaestro }, () => {
  const r = run('review-run.mjs', ['--dry'], { ...process.env, MAESTRO_DIR: '/nonexistent/maestro-066' });
  assert.notEqual(r.status, 0, r.stdout.slice(0, 200));
});

test('review-prep: an unknown case filter exits 2', () => {
  const r = run('review-prep.mjs', ['--only', 'no-such-case']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no case matches/);
});

test('review-prep --check: every stored diff and primer regenerates byte for byte from the pinned maestro checkout', { skip: noMaestro }, () => {
  const r = run('review-prep.mjs', ['--check']);
  assert.equal(r.status, 0, r.stdout.slice(-600) + r.stderr.slice(-300));
  const rows = r.stdout.split('\n').filter((l) => /^r-\S+\.(diff|primer\.txt): /.test(l));
  assert.equal(rows.length, 30);
  assert.equal(rows.filter((l) => /: unchanged /.test(l)).length, 30);
});
