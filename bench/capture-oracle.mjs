#!/usr/bin/env node
// Capture the stored graph output the oracle arm puts in its prompt. $0: no model call.
// For each case with `proxy_cmd`, builds the case's graph-arm workspace (same setup as bench/run.mjs)
// and writes the code-graph output of `proxy_cmd` to bench/oracle/<case>.txt. Workspaces are shared
// between cases with the same setup and deleted at the end.
// Usage: node bench/capture-oracle.mjs [--only <substring>] [--check]
//   --check: capture to memory and exit 1 if any stored file differs (nothing is written).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { oracleFile, setupArm } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
const check = args.includes('--check');
const maestroDir = process.env.MAESTRO_DIR || join(homedir(), 'gits', 'maestro');
const cli = join(repo, 'plugin', 'scripts', 'code-graph.cjs');
const work = process.env.TMPDIR || tmpdir();

const cases = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8')).cases.filter((c) => c.proxy_cmd && (!only || c.id.includes(only)));
if (!cases.length) { console.error('capture-oracle: no case with proxy_cmd matches'); process.exit(2); }

const wsBySetup = new Map();
let bad = 0;
try {
  for (const c of cases) {
    const setup = c.setup.replaceAll('{REPO}', repo).replaceAll('{ARM}', setupArm('graph')).replaceAll('{MAESTRO}', maestroDir);
    if (!wsBySetup.has(setup)) {
      const ws = mkdtempSync(join(work, 'bench-oracle-'));
      const sc = spawnSync('bash', ['-c', setup], { cwd: ws, encoding: 'utf8', timeout: 180000 });
      if (sc.status !== 0) { console.error(`setup failed for ${c.id}: ${sc.stderr || sc.stdout}`); process.exit(2); }
      wsBySetup.set(setup, ws);
    }
    const ws = wsBySetup.get(setup);
    const r = spawnSync('node', [cli, ...c.proxy_cmd], { cwd: ws, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: ws } });
    if (r.status !== 0 || !r.stdout.trim()) {
      console.error(`${c.id}: code-graph ${c.proxy_cmd.join(' ')} exited ${r.status} with ${r.stdout.length} chars: ${r.stderr.trim().slice(0, 300)}`);
      bad++;
      continue;
    }
    const f = join(here, oracleFile(c.id));
    if (check) {
      const same = existsSync(f) && readFileSync(f, 'utf8') === r.stdout;
      console.log(`${c.id}: ${same ? 'unchanged' : 'DIFFERS'} (${r.stdout.length} chars)`);
      if (!same) bad++;
    } else {
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, r.stdout);
      console.log(`${c.id}: wrote ${oracleFile(c.id)} (${r.stdout.length} chars)`);
    }
  }
} finally {
  for (const ws of wsBySetup.values()) rmSync(ws, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
