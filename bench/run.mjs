#!/usr/bin/env node
// Graph vs no-graph on `claude -p`, from a plain terminal (a nested sandbox breaks Bash).
// Usage: node bench/run.mjs [--runs 1] [--budget 1] [--run-budget 0.75] [--model claude-opus-5-5] [--group <substring>]
//                           [--only <substring>] [--dry] [--keep-ws]
// Output: bench/results/<timestamp>/ (transcripts per run + report.md), gitignored.
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeArgs, selectCases, parseStream, validity, score, report, checkVerdict } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');

const opts = { runs: '1', budget: '1', 'run-budget': '0.75', model: 'claude-opus-5-5', only: '', group: '' };
const bool = new Set();
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i].replace(/^--/, '');
  if (k === 'dry' || k === 'keep-ws' || k === 'init-check') bool.add(k);
  else if (k in opts) opts[k] = process.argv[++i];
  else { console.error(`unknown option ${process.argv[i]}`); process.exit(2); }
}
const RUNS = Number(opts.runs);
const BUDGET = Number(opts.budget);
const DRY = bool.has('dry');

if (!DRY && !bool.has('init-check') && (process.env.CLAUDECODE || process.env.SANDBOX_RUNTIME || process.env.CLAUDE_CODE_ENTRYPOINT)) {
  console.error('bench: running inside a Claude Code session or sandbox; Bash would hit the nested-sandbox failure. Use a plain terminal.');
  process.exit(2);
}

const allCases = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8')).cases;
const cases = selectCases(allCases, opts);
if (!cases.length) { console.error(`bench: no case matches --only "${opts.only}" --group "${opts.group}"`); process.exit(2); }
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(here, 'results', stamp);
const work = process.env.TMPDIR || tmpdir();
const pluginDir = join(repo, 'plugin');
const maestroDir = process.env.MAESTRO_DIR || join(homedir(), 'gits', 'maestro'); // read-only: only `git archive` touches it

// --init-check: $0 preflight. Points claude at a dead API endpoint so no model call can succeed, then
// reads the init event of each arm of the first selected case (init is emitted before any API call).
if (bool.has('init-check')) {
  const c = cases.find((x) => x.skills) || cases[0];
  let bad = 0;
  for (const arm of ['nograph', 'graph']) {
    const ws = mkdtempSync(join(work, 'bench-init-'));
    console.log(`[${arm}] setting up workspace ${ws} ...`);
    const sc = spawnSync('bash', ['-c', c.setup.replaceAll('{REPO}', repo).replaceAll('{ARM}', arm).replaceAll('{MAESTRO}', maestroDir)], { cwd: ws, encoding: 'utf8', timeout: 180000 });
    if (sc.status !== 0) { console.error(`setup failed: ${sc.stderr || sc.stdout}`); process.exit(2); }
    console.log(`[${arm}] running claude against a dead endpoint, waiting for the init event (max 90s) ...`);
    const args = claudeArgs(arm, 'hi', { model: opts.model, runBudget: '0.01', pluginDir });
    // Stream stdout and stop as soon as the init event arrives (it comes before any API call).
    const stdout = await new Promise((done) => {
      const p = spawn('claude', args, { cwd: ws, env: { ...process.env, ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' }, stdio: ['ignore', 'pipe', 'ignore'] });
      let buf = '';
      const finish = () => { clearTimeout(t); p.kill(); done(buf); };
      const t = setTimeout(finish, 90000);
      p.on('error', (e) => { console.error(`could not run claude: ${e.message}`); buf += ''; finish(); });
      p.on('close', finish);
      p.stdout.on('data', (d) => { buf += d; if (buf.split('\n').slice(0, -1).some((l) => /"subtype"\s*:\s*"init"/.test(l))) finish(); });
    });
    const m = parseStream(stdout);
    const problems = validity(arm, m, c.skills || []).filter((p) => !/result event|no result|is_error/.test(p));
    const names = m.init ? [...(m.init.skills || []), ...(m.init.plugins || []).map((p) => p.name || p)] : [];
    console.log(`[${arm}] init ${m.init ? 'seen' : 'MISSING'}; skills+plugins (${names.length}): ${names.join(', ')}`);
    console.log(problems.length ? problems.map((p) => `  PROBLEM: ${p}`).join('\n') : '  ok');
    bad += problems.length;
    rmSync(ws, { recursive: true, force: true });
  }
  process.exit(bad ? 3 : 0);
}

const rows = [];
let spent = 0;
let stop = null;
mkdirSync(outDir, { recursive: true });

outer: for (let n = 1; n <= RUNS; n++) {
  for (const c of cases) {
    for (const arm of ['nograph', 'graph']) {
      if (spent >= BUDGET) { stop = `total budget $${BUDGET} reached (spent $${spent.toFixed(3)})`; break outer; }
      const ws = mkdtempSync(join(work, 'bench-'));
      const sc = spawnSync('bash', ['-c', c.setup.replaceAll('{REPO}', repo).replaceAll('{ARM}', arm).replaceAll('{MAESTRO}', maestroDir)], { cwd: ws, encoding: 'utf8', timeout: 180000 });
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
      const problems = validity(arm, m, c.skills || []);
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
  const md = report(rows, { model: opts.model, spent, budget: BUDGET, stop, biasNote: rows.some((r) => cases.find((c) => c.id === r.case)?.group) });
  writeFileSync(join(outDir, 'report.md'), md);
  console.log('\n' + md);
  const v = checkVerdict(rows);
  console.log(`check: ${v.pass ? 'PASS' : 'FAIL'} (graph arm real code-graph call exit 0: ${v.realCall}, all runs valid: ${v.allValid}, both arms ran: ${v.bothArms})`);
  console.log(`results: ${outDir}`);
  if (stop || !v.pass) process.exit(3);
}
