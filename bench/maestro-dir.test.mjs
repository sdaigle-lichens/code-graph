import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolveMaestroDir, maestroFor } from './maestro-dir.mjs';

const home = '/h';
const docs = join(home, 'Documents', 'gits', 'maestro');
const plain = join(home, 'gits', 'maestro');
const only = (...dirs) => (p) => dirs.some((d) => p === join(d, '.git'));

test('explicit MAESTRO_DIR wins, even when missing on disk', () => {
  assert.equal(resolveMaestroDir({ env: { MAESTRO_DIR: '/x' }, home, exists: () => false }), '/x');
});

test('prefers ~/Documents/gits/maestro, then ~/gits/maestro', () => {
  assert.equal(resolveMaestroDir({ env: {}, home, exists: only(docs, plain) }), docs);
  assert.equal(resolveMaestroDir({ env: {}, home, exists: only(plain) }), plain);
});

test('no checkout: one-line error naming MAESTRO_DIR', () => {
  assert.throws(() => resolveMaestroDir({ env: {}, home, exists: () => false }), (e) => !e.message.includes('\n') && /MAESTRO_DIR/.test(e.message));
});

const dir = new URL('.', import.meta.url).pathname;
const scripts = ['run.mjs', 'edit-check.mjs', 'capture-oracle.mjs'];

test('maestroFor is lazy: empty without the placeholder, no lookup', () => {
  assert.equal(maestroFor('echo hi'), '');
});

test('the default is defined once: all three scripts use maestroFor, none hard-codes a path', () => {
  for (const s of scripts) {
    const src = readFileSync(join(dir, s), 'utf8');
    assert.match(src, /maestroFor\(c\.setup\)/, s);
    assert.doesNotMatch(src, /gits\/maestro|gits', 'maestro/, s);
  }
});

test('real scripts with an empty HOME and no MAESTRO_DIR exit 1 with one line naming MAESTRO_DIR', () => {
  const home = mkdtempSync(join(tmpdir(), 'maestro-home-'));
  try {
    for (const s of ['edit-check.mjs', 'capture-oracle.mjs']) {
      const env = { ...process.env, HOME: home };
      delete env.MAESTRO_DIR;
      const r = spawnSync(process.execPath, [join(dir, s)], { env, encoding: 'utf8' });
      assert.equal(r.status, 1, s);
      assert.equal(r.stderr.trim().split('\n').length, 1, s);
      assert.match(r.stderr, /MAESTRO_DIR/, s);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
