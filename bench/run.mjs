#!/usr/bin/env node
// Graph vs no-graph on `claude -p`, from a plain terminal (a nested sandbox breaks Bash).
// Usage: node bench/run.mjs [--runs 1] [--budget 1] [--run-budget 0.45] [--model sonnet]
//                           [--only <substring>] [--dry] [--keep-ws]
// Output: bench/results/<timestamp>/ (transcripts per run + report.md), gitignored.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeArgs, parseStream, validity, score, report, checkVerdict } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');

const opts = { runs: '1', budget: '1', 'run-budget': '0.45', model: 'sonnet', only: '' };
const bool = new Set();
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i].replace(/^--/, '');
  if (k === 'dry' || k === 'keep-ws') bool.add(k);
  else if (k in opts) opts[k] = process.argv[++i];
  else { console.error(`unknown option ${process.argv[i]}`); process.exit(2); }
}
const RUNS = Number(opts.runs);
const BUDGET = Number(opts.budget);
const DRY = bool.has('dry');

if (!DRY && (process.env.CLAUDECODE || process.env.SANDBOX_RUNTIME || process.env.CLAUDE_CODE_ENTRYPOINT)) {
  console.error('bench: running inside a Claude Code session or sandbox; Bash would hit the nested-sandbox failure. Use a plain terminal.');
  process.exit(2);
}

const cases = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8')).cases.filter((c) => !opts.only || c.id.includes(opts.only));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(here, 'results', stamp);
const work = process.env.TMPDIR || tmpdir();
const pluginDir = join(repo, 'plugin');

const rows = [];
let spent = 0;
let stop = null;
mkdirSync(outDir, { recursive: true });

outer: for (let n = 1; n <= RUNS; n++) {
  for (const c of cases) {
    for (const arm of ['nograph', 'graph']) {
      if (spent >= BUDGET) { stop = `total budget $${BUDGET} reached (spent $${spent.toFixed(3)})`; break outer; }
      const ws = mkdtempSync(join(work, 'bench-'));
      const sc = spawnSync('bash', ['-c', c.setup.replaceAll('{REPO}', repo)], { cwd: ws, encoding: 'utf8', timeout: 180000 });
      if (sc.status !== 0) { stop = `setup failed for ${c.id}: ${sc.stderr || sc.stdout}`; break outer; }
      const args = claudeArgs(arm, c.question, { model: opts.model, runBudget: opts['run-budget'], pluginDir });
      if (DRY) {
        console.log(`[${c.id} ${arm} run${n}] cwd=${ws}\nclaude ${args.map((x) => JSON.stringify(x)).join(' ')}\n`);
        if (!bool.has('keep-ws')) rmSync(ws, { recursive: true, force: true });
        continue;
      }
      process.stdout.write(`[${c.id} ${arm} run${n}] ... `);
      const r = spawnSync('claude', args, { cwd: ws, encoding: 'utf8', maxBuffer: 1 << 29, timeout: 600000 });
      const dir = join(outDir, c.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${arm}-run${n}.jsonl`), r.stdout || '');
      if (r.stderr) writeFileSync(join(dir, `${arm}-run${n}.stderr.txt`), r.stderr);
      if (r.error) { stop = `could not run claude: ${r.error.message}`; break outer; }
      const m = parseStream(r.stdout || '');
      const problems = validity(arm, m);
      if (r.status !== 0 && m.cost == null) problems.push(`claude exited ${r.status} with no result (see stderr file)`);
      rows.push({ case: c.id, arm, run: n, m, problems, sc: score(m.answer, c.must) });
      spent += m.cost || 0;
      console.log(`exit ${r.status} cost ${m.cost ?? 'n/a'} ${problems.length ? 'INVALID' : 'valid'} total $${spent.toFixed(3)}`);
      if (!bool.has('keep-ws')) rmSync(ws, { recursive: true, force: true });
      if (m.seccomp) { stop = 'apply-seccomp seen: nested sandbox is active, aborting'; break outer; }
      if (r.status !== 0 && m.cost == null) { stop = `claude exited ${r.status} with no result`; break outer; }
    }
  }
}

if (!DRY) {
  const md = report(rows, { model: opts.model, spent, budget: BUDGET, stop });
  writeFileSync(join(outDir, 'report.md'), md);
  console.log('\n' + md);
  const v = checkVerdict(rows);
  console.log(`check: ${v.pass ? 'PASS' : 'FAIL'} (graph arm real code-graph call exit 0: ${v.realCall}, all runs valid: ${v.allValid}, both arms ran: ${v.bothArms})`);
  console.log(`results: ${outDir}`);
  if (stop || !v.pass) process.exit(3);
}
