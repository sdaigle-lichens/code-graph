#!/usr/bin/env node
// 066 review mode: do reviewer arms catch planted bugs in a diff on the pinned maestro checkout?
// Run from a plain terminal (a nested sandbox breaks Bash), except --dry and --init-check.
// Usage: node bench/review-run.mjs [--arms a,b] [--only <substring>] [--runs 1] [--budget 10] [--run-budget 0.4]
//                                  [--dry] [--keep-ws] [--init-check]
// Arms: sonnet-nograph, sonnet-diff-primer, haiku-diff-primer, sonnet-spawns-haiku (default), haiku-nograph (optional).
// The diff and the primer of each case are the stored files under bench/review/ (bench/review-prep.mjs).
// Output: bench/results/review-<timestamp>/ (transcripts, runs.json, report.md), gitignored.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { budgetStop, parseStream, runStatus, validity } from './lib.mjs';
import { applyReplacements } from './edit.mjs';
import { maestroFor } from './maestro-dir.mjs';
import {
  DEFAULT_REVIEW_ARMS, REVIEW_ARMS, diffForPlants, gradeReview, parseReviewArms, promptProblems, reviewArgs, reviewPrompt,
  reviewProblems, reviewReport, toolsFor,
} from './review.mjs';
import { selectReviewCases } from './review-cases.mjs';
import { reviewFile } from './review-prep.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const opts = { arms: DEFAULT_REVIEW_ARMS, only: '', runs: '1', budget: '10', 'run-budget': '0.4' };
const bool = new Set();
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i].replace(/^--/, '');
  if (k === 'dry' || k === 'keep-ws' || k === 'init-check') bool.add(k);
  else if (k in opts) opts[k] = process.argv[++i];
  else { console.error(`unknown option ${process.argv[i]}`); process.exit(2); }
}
const DRY = bool.has('dry');
const die = (msg) => { console.error(`review-run: ${msg}`); process.exit(2); };
if (!DRY && !bool.has('init-check') && (process.env.CLAUDECODE || process.env.SANDBOX_RUNTIME || process.env.CLAUDE_CODE_ENTRYPOINT)) {
  die('running inside a Claude Code session or sandbox; Bash would hit the nested-sandbox failure. Use a plain terminal.');
}

let arms;
try { arms = parseReviewArms(opts.arms); } catch (e) { die(e.message); }
const cases = selectReviewCases(opts.only);
if (!cases.length) die(`no case matches --only "${opts.only}"`);
const BUDGET = Number(opts.budget);
const work = process.env.TMPDIR || tmpdir();
const stored = (c, ext) => {
  const f = reviewFile(c.id, ext);
  if (!existsSync(f)) die(`missing ${f}; generate it with node bench/review-prep.mjs --only ${c.id}`);
  return readFileSync(f, 'utf8');
};
const setupCmd = (c) => c.setup.replaceAll('{REPO}', repo).replaceAll('{ARM}', 'nograph').replaceAll('{MAESTRO}', maestroFor(c.setup)); // every review arm runs in the no-graph workspace
const pluginless = (m, c, arm) => validity('nograph', m, c.skills, {}).filter((p) => !/^Bash failure:/.test(p)); // a reviewer may run git in a workspace that is not a repo

// --init-check: $0 preflight. A dead API endpoint means no model call succeeds; the init event (emitted
// before any API call) gives the model, the tool list, the skills and the plugins of each arm.
if (bool.has('init-check')) {
  const c = cases[0];
  let bad = 0;
  for (const arm of arms) {
    const ws = mkdtempSync(join(work, 'bench-review-init-'));
    console.log(`[${arm}] setting up workspace ${ws} ...`);
    const sc = spawnSync('bash', ['-c', setupCmd(c)], { cwd: ws, encoding: 'utf8', timeout: 180000 });
    if (sc.status !== 0) die(`setup failed: ${sc.stderr || sc.stdout}`);
    const args = reviewArgs(arm, 'hi', { runBudget: '0.01' });
    const stdout = await new Promise((done) => {
      const p = spawn('claude', args, { cwd: ws, env: { ...process.env, ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' }, stdio: ['ignore', 'pipe', 'ignore'] });
      let buf = '';
      const finish = () => { clearTimeout(t); p.kill(); done(buf); };
      const t = setTimeout(finish, 90000);
      p.on('error', (e) => { console.error(`could not run claude: ${e.message}`); finish(); });
      p.on('close', finish);
      p.stdout.on('data', (d) => { buf += d; if (buf.split('\n').slice(0, -1).some((l) => /"subtype"\s*:\s*"init"/.test(l))) finish(); });
    });
    const m = parseStream(stdout);
    const noise = /result event|no result|is_error/;
    const problems = [...pluginless(m, c, arm), ...reviewProblems(arm, m, '').filter((p) => !/invalid spawn run/.test(p))].filter((p) => !noise.test(p));
    const names = m.init ? [...(m.init.skills || []), ...(m.init.plugins || []).map((p) => p.name || p)] : [];
    console.log(`[${arm}] init ${m.init ? 'seen' : 'MISSING'}; model ${m.init?.model ?? '?'} (want ${REVIEW_ARMS[arm].model}); tools ${(m.init?.tools || []).join(', ') || '?'} (want ${toolsFor(arm)}); skills+plugins (${names.length}): ${names.join(', ')}`);
    console.log(problems.length ? problems.map((p) => `  PROBLEM: ${p}`).join('\n') : '  ok');
    bad += problems.length;
    rmSync(ws, { recursive: true, force: true });
  }
  process.exit(bad ? 3 : 0);
}

const plan = [];
for (let n = 1; n <= Number(opts.runs); n++) for (const c of cases) for (const arm of arms) plan.push({ case: c.id, arm, run: n });
console.log(`review-run: ${plan.length} runs (${arms.map((a) => `${a} ${plan.filter((p) => p.arm === a).length}`).join(', ')}), cap $${BUDGET}, per run $${opts['run-budget']}`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(here, 'results', `review-${stamp}`);
const rows = [];
let spent = 0;
let stop = null;
const meta = { budget: BUDGET, 'run-budget': Number(opts['run-budget']), arms };
const save = () => writeFileSync(join(outDir, 'runs.json'), JSON.stringify({ meta, planned: plan, rows, spent, stop }, null, 1));
if (!DRY) mkdirSync(outDir, { recursive: true });

for (const p of plan) {
  const c = cases.find((x) => x.id === p.case);
  const { arm, run: n } = p;
  if (!DRY && budgetStop(spent, opts['run-budget'], BUDGET)) { stop = `the next run could exceed the $${BUDGET} cap (spent $${spent.toFixed(3)}, up to $${opts['run-budget']} per run)`; break; }
  const ws = mkdtempSync(join(work, 'bench-review-'));
  const sc = spawnSync('bash', ['-c', setupCmd(c)], { cwd: ws, encoding: 'utf8', timeout: 180000 });
  if (sc.status !== 0) { stop = `setup failed for ${c.id}: ${sc.stderr || sc.stdout}`; break; }
  // The diff is computed from the workspace before the change is applied and must equal the stored one.
  const { diff } = diffForPlants((f) => readFileSync(join(ws, f), 'utf8'), c.review.plant, c.id);
  if (diff !== stored(c, 'diff')) { stop = `${c.id}: the stored diff differs from the one computed from the workspace; rerun node bench/review-prep.mjs`; break; }
  applyReplacements(ws, c.review.plant, `${c.id} plant`);
  const prompt = reviewPrompt(arm, diff, REVIEW_ARMS[arm].primer ? stored(c, 'primer.txt') : '');
  const pp = promptProblems(arm, prompt);
  if (pp.length) { stop = `${c.id} ${arm}: ${pp.join('; ')}`; break; }
  const args = reviewArgs(arm, prompt, { runBudget: opts['run-budget'] });
  if (DRY) {
    console.log(`[${c.id} ${arm} run${n}] cwd=${ws} prompt ${prompt.length} chars\nclaude ${args.map((x) => JSON.stringify(x.length > 80 ? `${x.slice(0, 80)}...` : x)).join(' ')}\n`);
    if (!bool.has('keep-ws')) rmSync(ws, { recursive: true, force: true });
    continue;
  }
  process.stdout.write(`[${c.id} ${arm} run${n}] ... `);
  const r = spawnSync('claude', args, { cwd: ws, encoding: 'utf8', maxBuffer: 1 << 29, timeout: 900000 });
  const dir = join(outDir, c.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${arm}-run${n}.jsonl`), r.stdout || '');
  if (r.stderr) writeFileSync(join(dir, `${arm}-run${n}.stderr.txt`), r.stderr);
  if (r.error) { stop = `could not run claude: ${r.error.message}`; break; }
  const m = parseStream(r.stdout || '');
  const problems = [...pluginless(m, c, arm), ...reviewProblems(arm, m, r.stdout || '')];
  if (r.status !== 0 && m.cost == null) problems.push(`claude exited ${r.status} with no result (see stderr file)`);
  const status = runStatus(m, problems);
  const grade = gradeReview(c, m.answer);
  const { init, ...mKeep } = m;
  rows.push({ case: c.id, arm, run: n, m: mKeep, problems, status, grade, answer: m.answer });
  spent += m.cost || 0;
  save();
  console.log(`exit ${r.status} cost ${m.cost ?? 'n/a'} ${status} found ${grade.found}/${grade.planted}${grade.clean ? ` false alarms ${grade.falseAlarms}` : ''} total $${spent.toFixed(3)}`);
  if (!bool.has('keep-ws')) rmSync(ws, { recursive: true, force: true });
  if (status === 'usage-limit') { stop = `account usage limit (429) on ${c.id} ${arm} run${n}; that run and the ones after it are not counted. Rerun the missing cells with --only and --arms once it resets`; break; }
  if (m.seccomp) { stop = 'apply-seccomp seen: nested sandbox is active, aborting'; break; }
  if (rows.filter((x) => x.status === 'invalid').length > 1) { stop = 'more than one run is invalid for a reason other than a usage limit: stopping, report this before spending more'; break; }
}

if (!DRY) {
  save();
  const md = reviewReport(rows, { ...meta, spent, stop, planned: plan });
  writeFileSync(join(outDir, 'report.md'), md);
  console.log('\n' + md);
  console.log(`results: ${outDir}`);
  if (stop) process.exit(3);
} else if (stop) {
  console.error(`review-run: ${stop}`);
  process.exit(3);
}
