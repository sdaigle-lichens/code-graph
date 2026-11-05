#!/usr/bin/env node
// 070 refactor mode: does a cheap Haiku refactor scout, filtered by a Sonnet reviewer, find code-structure
// improvements as well as a Sonnet refactor pass, at lower cost? Reuses the 066 review runner's shape.
// Run from a plain terminal (a nested sandbox breaks Bash), except --dry and --init-check.
// Usage: node bench/refactor-run.mjs --budget <usd> --run-budget <usd> [--arms a,b] [--only <substrings>]
//                                    [--runs 3] [--dry] [--keep-ws] [--init-check]
// --budget (total cap) and --run-budget (cap of one claude session) have NO default: they are the user's to
// set (docs/evals.md, Ticket 070); a paid run without both is refused. --dry and --init-check need neither.
// Arms (default, all four): sonnet-plain, haiku-metrics-primer, haiku-scout-sonnet-filter, sonnet-spawns-haiku-scouts.
// The scope and the metrics primer of each case are the stored files under bench/refactor/
// (bench/refactor-prep.mjs). The pipeline arm runs two sessions per cell (Haiku scout, then Sonnet filter);
// its run-budget applies to each session and its cost is the sum of both.
// Output: bench/results/refactor-<timestamp>/ (transcripts, runs.json, report.md), gitignored.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { budgetStop, parseStream, runStatus, validity } from './lib.mjs';
import { applyReplacements } from './edit.mjs';
import { maestroFor } from './maestro-dir.mjs';
import {
  DEFAULT_REFACTOR_ARMS, DEFAULT_REFACTOR_RUNS, REFACTOR_ARMS, filterPrompt, gradePipeline, gradeRefactor, parseRefactorArms, promptProblems,
  refactorArgs, refactorPrompt, refactorReport, stageProblems, stageSpec, stagesOf, storedProblems,
} from './refactor.mjs';
import { selectRefactorCases } from './refactor-cases.mjs';
import { refactorFile } from './refactor-prep.mjs';
import { findingsOf } from './review.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const opts = { arms: DEFAULT_REFACTOR_ARMS, only: '', runs: DEFAULT_REFACTOR_RUNS, budget: '', 'run-budget': '' };
const bool = new Set();
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i].replace(/^--/, '');
  if (k === 'dry' || k === 'keep-ws' || k === 'init-check') bool.add(k);
  else if (k in opts) opts[k] = process.argv[++i];
  else { console.error(`unknown option ${process.argv[i]}`); process.exit(2); }
}
const DRY = bool.has('dry');
const die = (msg) => { console.error(`refactor-run: ${msg}`); process.exit(2); };
if (!DRY && !bool.has('init-check') && (process.env.CLAUDECODE || process.env.SANDBOX_RUNTIME || process.env.CLAUDE_CODE_ENTRYPOINT)) {
  die('running inside a Claude Code session or sandbox; Bash would hit the nested-sandbox failure. Use a plain terminal.');
}
const positive = (v) => Number.isFinite(Number(v)) && Number(v) > 0;
if (!DRY && !bool.has('init-check') && !(positive(opts.budget) && positive(opts['run-budget']))) {
  die('a paid run needs both --budget <usd> (total cap) and --run-budget <usd> (cap of one session): the caps are the user\'s to set (docs/evals.md, Ticket 070)');
}

let arms;
try { arms = parseRefactorArms(opts.arms); } catch (e) { die(e.message); }
const cases = selectRefactorCases(opts.only);
if (!cases.length) die(`no case matches --only "${opts.only}"`);
const BUDGET = Number(opts.budget || 0);
const work = process.env.TMPDIR || tmpdir();
const stored = (c, ext) => {
  const f = refactorFile(c.id, ext);
  if (!existsSync(f)) die(`missing ${f}; generate it with node bench/refactor-prep.mjs --only ${c.id}`);
  return readFileSync(f, 'utf8');
};
const setupCmd = (c) => c.setup.replaceAll('{REPO}', repo).replaceAll('{ARM}', 'nograph').replaceAll('{MAESTRO}', maestroFor(c.setup)); // every refactor arm runs in the no-graph workspace
const pluginless = (m, c) => validity('nograph', m, c.skills, {}).filter((p) => !/^Bash failure:/.test(p)); // the agent may run git in a workspace that is not a repo
for (const c of cases) {
  const sp = storedProblems(c, stored(c, 'scope.txt'), stored(c, 'primer.txt'));
  if (sp.length) die(`${c.id}: ${sp.join('; ')}; rerun node bench/refactor-prep.mjs`);
}

// --init-check: $0 preflight. A dead API endpoint means no model call succeeds; the init event (emitted
// before any API call) gives the model, the tool list, the skills and the plugins of each session.
if (bool.has('init-check')) {
  const c = cases[0];
  let bad = 0;
  for (const arm of arms) for (const stage of stagesOf(arm)) {
    const ws = mkdtempSync(join(work, 'bench-refactor-init-'));
    console.log(`[${arm} ${stage}] setting up workspace ${ws} ...`);
    const sc = spawnSync('bash', ['-c', setupCmd(c)], { cwd: ws, encoding: 'utf8', timeout: 180000 });
    if (sc.status !== 0) die(`setup failed: ${sc.stderr || sc.stdout}`);
    const args = refactorArgs(arm, stage, 'hi', { runBudget: '0.01' });
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
    const problems = [...pluginless(m, c), ...stageProblems(arm, stage, m, '').filter((p) => !/invalid spawn run/.test(p))].filter((p) => !noise.test(p));
    const names = m.init ? [...(m.init.skills || []), ...(m.init.plugins || []).map((p) => p.name || p)] : [];
    const s = stageSpec(arm, stage);
    console.log(`[${arm} ${stage}] init ${m.init ? 'seen' : 'MISSING'}; model ${m.init?.model ?? '?'} (want ${s.model}); tools ${(m.init?.tools || []).join(', ') || '?'} (want ${s.tools}${s.spawn ? ', Agent' : ''}); skills+plugins (${names.length}): ${names.join(', ')}`);
    console.log(problems.length ? problems.map((p) => `  PROBLEM: ${p}`).join('\n') : '  ok');
    bad += problems.length;
    rmSync(ws, { recursive: true, force: true });
  }
  process.exit(bad ? 3 : 0);
}

const plan = [];
for (let n = 1; n <= Number(opts.runs); n++) for (const c of cases) for (const arm of arms) plan.push({ case: c.id, arm, run: n });
console.log(`refactor-run: ${plan.length} cells (${arms.map((a) => `${a} ${plan.filter((p) => p.arm === a).length}`).join(', ')}), cap ${DRY ? '(dry)' : `$${BUDGET}`}, per session ${DRY ? '(dry)' : `$${opts['run-budget']}`}`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(here, 'results', `refactor-${stamp}`);
const rows = [];
let spent = 0;
let stop = null;
const meta = { budget: BUDGET, 'run-budget': Number(opts['run-budget'] || 0), arms };
const save = () => writeFileSync(join(outDir, 'runs.json'), JSON.stringify({ meta, planned: plan, rows, spent, stop }, null, 1));
if (!DRY) mkdirSync(outDir, { recursive: true });

// One claude session of a cell; returns { m, problems, r } or null after setting `stop`.
function session(c, arm, stage, n, ws, prompt) {
  const args = refactorArgs(arm, stage, prompt, { runBudget: opts['run-budget'] || '0.01' });
  process.stdout.write(`[${c.id} ${arm} ${stage} run${n}] ... `);
  const r = spawnSync('claude', args, { cwd: ws, encoding: 'utf8', maxBuffer: 1 << 29, timeout: 900000 });
  const dir = join(outDir, c.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${arm}-${stage}-run${n}.jsonl`), r.stdout || '');
  if (r.stderr) writeFileSync(join(dir, `${arm}-${stage}-run${n}.stderr.txt`), r.stderr);
  if (r.error) { stop = `could not run claude: ${r.error.message}`; return null; }
  const m = parseStream(r.stdout || '');
  const problems = [...pluginless(m, c), ...stageProblems(arm, stage, m, r.stdout || '')];
  if (r.status !== 0 && m.cost == null) problems.push(`claude exited ${r.status} with no result (see stderr file)`);
  spent += m.cost || 0;
  console.log(`exit ${r.status} cost ${m.cost ?? 'n/a'} total $${spent.toFixed(3)}`);
  return { m, problems };
}

for (const p of plan) {
  const c = cases.find((x) => x.id === p.case);
  const { arm, run: n } = p;
  // The pipeline needs two sessions: leave room for both under the cap.
  const sessions = stagesOf(arm).length;
  if (!DRY && budgetStop(spent, String(Number(opts['run-budget']) * sessions), BUDGET)) { stop = `the next cell could exceed the $${BUDGET} cap (spent $${spent.toFixed(3)}, up to $${opts['run-budget']} per session, ${sessions} session(s))`; break; }
  const ws = mkdtempSync(join(work, 'bench-refactor-'));
  const sc = spawnSync('bash', ['-c', setupCmd(c)], { cwd: ws, encoding: 'utf8', timeout: 180000 });
  if (sc.status !== 0) { stop = `setup failed for ${c.id}: ${sc.stderr || sc.stdout}`; break; }
  // The planted change must apply to the pinned tree, or the case does not run.
  try { applyReplacements(ws, c.refactor.plant || [], `${c.id} plant`); } catch (e) { stop = `${c.id}: ${e.message}`; break; }
  const scope = stored(c, 'scope.txt');
  const prompt = refactorPrompt(arm, scope, REFACTOR_ARMS[arm].primer ? stored(c, 'primer.txt') : '');
  const pp = promptProblems(arm, prompt);
  if (pp.length) { stop = `${c.id} ${arm}: ${pp.join('; ')}`; break; }
  if (DRY) {
    const first = stagesOf(arm)[0];
    const args = refactorArgs(arm, first, prompt, { runBudget: opts['run-budget'] || '(user cap)' });
    console.log(`[${c.id} ${arm} run${n}] cwd=${ws} prompt ${prompt.length} chars${REFACTOR_ARMS[arm].filter ? ' + a filter session (Sonnet) over the scout\'s proposals' : ''}\nclaude ${args.map((x) => JSON.stringify(x.length > 80 ? `${x.slice(0, 80)}...` : x)).join(' ')}\n`);
    if (!bool.has('keep-ws')) rmSync(ws, { recursive: true, force: true });
    continue;
  }
  const first = session(c, arm, stagesOf(arm)[0], n, ws, prompt);
  if (!first) break;
  let second = null;
  let grade;
  if (REFACTOR_ARMS[arm].filter) {
    const items = findingsOf(first.m.answer, 'PROPOSALS').items;
    if (items.length && first.m.cost != null) {
      second = session(c, arm, 'filter', n, ws, filterPrompt(scope, items));
      if (!second) break;
    }
    grade = gradePipeline(c, first.m.answer, second ? second.m.answer : null);
  } else grade = gradeRefactor(c, first.m.answer);
  const problems = [...first.problems, ...(second ? second.problems : [])];
  const status = runStatus(second && runStatus(first.m, []) === 'valid' ? second.m : first.m, problems); // a usage limit in either session
  const { init, ...mKeep } = first.m;
  const { init: init2, ...m2Keep } = second ? second.m : {};
  rows.push({ case: c.id, arm, run: n, m: mKeep, m2: second ? m2Keep : undefined, problems, status, grade, answer: first.m.answer, answer2: second?.m.answer });
  save();
  console.log(`  -> ${status} kept ${grade.found}/${grade.planted}${grade.clean ? ` false findings ${grade.falseFindings}` : ''}${grade.anchor ? ` anchoring ${grade.anchor.kept}/${grade.anchor.scout}` : ''}`);
  if (!bool.has('keep-ws')) rmSync(ws, { recursive: true, force: true });
  if (status === 'usage-limit') { stop = `account usage limit (429) on ${c.id} ${arm} run${n}; that cell and the ones after it are not counted. Rerun the missing cells with --only and --arms once it resets`; break; }
  if (first.m.seccomp || second?.m.seccomp) { stop = 'apply-seccomp seen: nested sandbox is active, aborting'; break; }
  if (rows.filter((x) => x.status === 'invalid').length > 1) { stop = 'more than one run is invalid for a reason other than a usage limit: stopping, report this before spending more'; break; }
}

if (!DRY) {
  save();
  const md = refactorReport(rows, { ...meta, spent, stop, planned: plan });
  writeFileSync(join(outDir, 'report.md'), md);
  console.log('\n' + md);
  console.log(`results: ${outDir}`);
  if (stop) process.exit(3);
} else if (stop) {
  console.error(`refactor-run: ${stop}`);
  process.exit(3);
}
