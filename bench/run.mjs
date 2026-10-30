#!/usr/bin/env node
// Graph vs no-graph (and the oracle ceiling) on `claude -p`, from a plain terminal (a nested sandbox breaks Bash).
// Usage: node bench/run.mjs [--runs 1] [--budget 1] [--run-budget 0.75] [--model claude-opus-5-5] [--group <substring>]
//                           [--only <substring>] [--set <name>] [--arms nograph,graph] [--graph-cases <id,id>]
//                           [--dry] [--keep-ws] [--init-check]
// Model arms (044: haiku-nograph, haiku-graph, sonnet-nograph) pin their own model; --model sets the
// others. Edit cases (an `edit` field, 044) run as the case's maestro agent and are graded on the files
// they leave (bench/edit.mjs).
//        node bench/run.mjs --rerun bench/results/<timestamp>   (only the runs that hit the usage limit or never ran)
// Output: bench/results/<timestamp>/ (transcripts per run, runs.json, report.md), gitignored.
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  claudeArgs, selectCases, parseStream, validity, score, report, checkVerdict, parseArms, planRuns, promptFor,
  oracleFile, setupArm, budgetStop, runStatus, statusOf, rerunPlan, proposals, DEFAULT_ARMS, SKILL_ARMS,
  isEditCase, isGraphArm, modelFor, baseArm, isOracleArm, promptProblems,
} from './lib.mjs';
import { prepareEdit, gradeEdit, systemPromptFor, saveArtifacts } from './edit.mjs';
import { maestroFor } from './maestro-dir.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');

const opts = { runs: '1', budget: '1', 'run-budget': '0.75', model: 'claude-opus-5-5', only: '', group: '', set: '', arms: DEFAULT_ARMS, 'graph-cases': '', rerun: '' };
const given = new Set();
const bool = new Set();
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i].replace(/^--/, '');
  if (k === 'dry' || k === 'keep-ws' || k === 'init-check') bool.add(k);
  else if (k in opts) { opts[k] = process.argv[++i]; given.add(k); }
  else { console.error(`unknown option ${process.argv[i]}`); process.exit(2); }
}
const DRY = bool.has('dry');
const die = (msg) => { console.error(`bench: ${msg}`); process.exit(2); };

if (!DRY && !bool.has('init-check') && (process.env.CLAUDECODE || process.env.SANDBOX_RUNTIME || process.env.CLAUDE_CODE_ENTRYPOINT)) {
  die('running inside a Claude Code session or sandbox; Bash would hit the nested-sandbox failure. Use a plain terminal.');
}

const allCases = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8')).cases;
const byId = new Map(allCases.map((c) => [c.id, c]));

// --rerun <dir>: same model, cap and plan as that invocation; only its planned runs with no valid or
// invalid row are run, and the cap counts what it already spent.
let prev = null;
let plan;
if (opts.rerun) {
  const f = join(resolve(opts.rerun), 'runs.json');
  if (!existsSync(f)) die(`no runs.json in ${opts.rerun}`);
  prev = JSON.parse(readFileSync(f, 'utf8'));
  const prevInvalid = prev.rows.filter((r) => statusOf(r) === 'invalid').length;
  if (prevInvalid > 1) die(`${opts.rerun} has ${prevInvalid} invalid runs (not usage limits): report them instead of rerunning`);
  for (const k of ['model', 'run-budget', 'budget']) if (!given.has(k)) opts[k] = String(prev.meta[k]);
  if (opts.model !== prev.meta.model) die(`--model ${opts.model} differs from the rerun's ${prev.meta.model}`);
  plan = rerunPlan(prev);
  if (!plan.length) { console.log(`bench: nothing to rerun in ${opts.rerun}`); process.exit(0); }
} else {
  let arms;
  try { arms = parseArms(opts.arms); } catch (e) { die(e.message); }
  const cases = selectCases(allCases, opts);
  if (!cases.length) die(`no case matches --only "${opts.only}" --group "${opts.group}" --set "${opts.set}"`);
  const graphCases = opts['graph-cases'].split(',').map((s) => s.trim()).filter(Boolean);
  plan = planRuns(cases, { arms, graphCases, runs: Number(opts.runs) });
  if (!plan.length) die('the plan is empty');
}
const BUDGET = Number(opts.budget);
const planCases = [...new Set(plan.map((p) => p.case))].map((id) => byId.get(id) || die(`case ${id} is not in cases.json`));
const planArms = [...new Set(plan.map((p) => p.arm))];
// The skill arms compare concept skills against none: a case with no `skills` list has nothing the
// init check could confirm was present in one arm and stripped in the other.
const noSkillList = [...new Set(plan.filter((p) => SKILL_ARMS.has(baseArm(p.arm)) && !(byId.get(p.case)?.skills || []).length).map((p) => p.case))];
if (noSkillList.length) die(`the skills/noskills arms need cases with a \`skills\` list; these have none: ${noSkillList.join(', ')}`);

// The oracle arm's prompt carries the case's stored graph output (bench/capture-oracle.mjs).
const oracleText = {};
for (const id of new Set(plan.filter((p) => isOracleArm(p.arm)).map((p) => p.case))) {
  const f = join(here, oracleFile(id));
  if (!existsSync(f)) die(`oracle arm needs ${oracleFile(id)} under bench/; capture it with node bench/capture-oracle.mjs --only ${id}`);
  oracleText[id] = readFileSync(f, 'utf8');
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(here, 'results', stamp);
const work = process.env.TMPDIR || tmpdir();
const pluginDir = join(repo, 'plugin');
const setupCmd = (c, arm) => c.setup.replaceAll('{REPO}', repo).replaceAll('{ARM}', setupArm(arm)).replaceAll('{MAESTRO}', maestroFor(c.setup)); // maestro is read-only: only `git archive` touches it
// Edit cases: Edit/Write allowed and the maestro agent's body appended to the system prompt.
const editArgs = (ws, c) => (isEditCase(c) ? { edit: true, systemPrompt: systemPromptFor(ws, c) } : {});
const models = (arms) => Object.fromEntries(arms.map((a) => [a, modelFor(a, opts.model)]));

// --init-check: $0 preflight. Points claude at a dead API endpoint so no model call can succeed, then
// reads the init event of each planned arm of the first selected case (init is emitted before any API call).
if (bool.has('init-check')) {
  const c = planCases.find((x) => x.skills) || planCases[0];
  let bad = 0;
  for (const arm of planArms) {
    const ws = mkdtempSync(join(work, 'bench-init-'));
    console.log(`[${arm}] setting up workspace ${ws} ...`);
    const sc = spawnSync('bash', ['-c', setupCmd(c, arm)], { cwd: ws, encoding: 'utf8', timeout: 180000 });
    if (sc.status !== 0) die(`setup failed: ${sc.stderr || sc.stdout}`);
    console.log(`[${arm}] running claude against a dead endpoint, waiting for the init event (max 90s) ...`);
    const args = claudeArgs(arm, 'hi', { model: opts.model, runBudget: '0.01', pluginDir, ...editArgs(ws, c) });
    // Stream stdout and stop as soon as the init event arrives (it comes before any API call).
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
    const problems = validity(arm, m, c.skills || [], { keepSkills: c.keep_skills || [], edit: isEditCase(c) }).filter((p) => !/result event|no result|is_error/.test(p));
    const names = m.init ? [...(m.init.skills || []), ...(m.init.plugins || []).map((p) => p.name || p)] : [];
    console.log(`[${arm}] init ${m.init ? 'seen' : 'MISSING'}; skills+plugins (${names.length}): ${names.join(', ')}`);
    // The model and tools the init event reports, to compare by eye with the arm's (044 model arms,
    // Edit/Write for edit cases). A missing init after --append-system-prompt means the flag is wrong.
    if (m.init) console.log(`[${arm}] model ${m.init.model ?? '?'} (want ${modelFor(arm, opts.model)}); tools ${(m.init.tools || []).join(', ') || '?'}`);
    console.log(problems.length ? problems.map((p) => `  PROBLEM: ${p}`).join('\n') : '  ok');
    bad += problems.length;
    rmSync(ws, { recursive: true, force: true });
  }
  process.exit(bad ? 3 : 0);
}

// A case with a `proposal` field is not approved yet: nothing is spent on it (--dry and --init-check
// are $0 and still allowed). The user approves the set, then the field is removed from cases.json.
const pending = proposals(planCases);
if (!DRY && pending.length) die(`case(s) awaiting approval (\`proposal\` field in cases.json): ${pending.map((c) => c.id).join(', ')}. Remove the field once the user approves them.`);

const perArm = planArms.map((a) => `${a} ${plan.filter((p) => p.arm === a).length}`).join(', ');
const modelNote = planArms.some((a) => modelFor(a, opts.model) !== opts.model) ? `models ${Object.entries(models(planArms)).map(([a, m]) => `${a}=${m}`).join(' ')}` : `model ${opts.model}`;
console.log(`bench: ${plan.length} runs (${perArm}), ${modelNote}, cap $${BUDGET}, per run $${opts['run-budget']}${prev ? `, rerun of ${opts.rerun} (already spent $${prev.spent.toFixed(3)})` : ''}`);

// Rows of the rerun's source invocation that count (valid or invalid) are carried into this report.
const rows = prev ? prev.rows.filter((r) => statusOf(r) !== 'usage-limit') : [];
const fullPlan = prev ? prev.planned : plan;
let spent = prev ? prev.spent : 0;
let stop = null;
const meta = { model: opts.model, models: models([...new Set(fullPlan.map((p) => p.arm))]), budget: BUDGET, 'run-budget': Number(opts['run-budget']), arms: planArms, rerunOf: prev ? resolve(opts.rerun) : undefined };
const save = () => writeFileSync(join(outDir, 'runs.json'), JSON.stringify({ meta, planned: fullPlan, rows: rows.map(({ m: { init, ...m }, ...r }) => ({ ...r, m })), spent, stop }, null, 1));
if (!DRY) mkdirSync(outDir, { recursive: true });

for (const p of plan) {
  const c = byId.get(p.case);
  const { arm, run: n } = p;
  if (!DRY && budgetStop(spent, opts['run-budget'], BUDGET)) { stop = `the next run could exceed the $${BUDGET} cap (spent $${spent.toFixed(3)}, up to $${opts['run-budget']} per run)`; break; }
  const ws = mkdtempSync(join(work, 'bench-'));
  const sc = spawnSync('bash', ['-c', setupCmd(c, arm)], { cwd: ws, encoding: 'utf8', timeout: 180000 });
  if (sc.status !== 0) { stop = `setup failed for ${c.id}: ${sc.stderr || sc.stdout}`; break; }
  // Edit cases: plants, removals and the protected-file snapshot, before the model sees the workspace.
  let pristine = null;
  if (isEditCase(c)) {
    try { pristine = prepareEdit(ws, c); } catch (e) { stop = `edit preparation failed for ${c.id}: ${e.message}`; break; }
  }
  const prompt = promptFor(arm, c, oracleText[c.id]);
  const ctxProblems = promptProblems(arm, prompt); // 051: oracle context only in the oracle arm
  if (ctxProblems.length) { stop = `${c.id} ${arm}: ${ctxProblems.join('; ')}`; break; }
  const args = claudeArgs(arm, prompt, { model: opts.model, runBudget: opts['run-budget'], pluginDir, ...editArgs(ws, c) });
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
  if (r.error) { stop = `could not run claude: ${r.error.message}`; break; }
  const m = parseStream(r.stdout || '');
  const problems = validity(arm, m, c.skills || [], { keepSkills: c.keep_skills || [], edit: isEditCase(c) });
  if (r.status !== 0 && m.cost == null) problems.push(`claude exited ${r.status} with no result (see stderr file)`);
  const status = runStatus(m, problems);
  // Edit cases are graded on the workspace the run left (before it is removed), not on the answer.
  let grade = null;
  if (pristine) {
    try { grade = gradeEdit(ws, c, pristine); saveArtifacts(ws, c, dir, `${arm}-run${n}`, grade); } catch (e) { stop = `grading failed for ${c.id} ${arm} run${n}: ${e.message}`; break; }
  }
  const points = grade ? { hits: grade.hits, of: grade.of } : score(m.answer, c.must);
  rows.push({ case: c.id, arm, run: n, m, problems, status, sc: points, ...(grade ? { edit: { detail: grade.detail, restored: grade.restored } } : {}) });
  spent += m.cost || 0;
  save();
  console.log(`exit ${r.status} cost ${m.cost ?? 'n/a'} ${status} total $${spent.toFixed(3)}`);
  if (!bool.has('keep-ws')) rmSync(ws, { recursive: true, force: true });
  if (status === 'usage-limit') { stop = `account usage limit (429) on ${c.id} ${arm} run${n}; that run and the ones after it are not counted. When the limit resets, run: node bench/run.mjs --rerun ${outDir}`; break; }
  if (m.seccomp) { stop = 'apply-seccomp seen: nested sandbox is active, aborting'; break; }
  if (rows.filter((x) => statusOf(x) === 'invalid').length > 1) { stop = 'more than one run is invalid for a reason other than a usage limit: stopping, report this before spending more'; break; }
  if (r.status !== 0 && m.cost == null) { stop = `claude exited ${r.status} with no result`; break; }
}

if (!DRY) {
  save();
  const reportCases = [...new Set(fullPlan.map((p) => p.case))].map((id) => byId.get(id)).filter(Boolean);
  const kinds = Object.fromEntries(reportCases.filter((c) => c.kind).map((c) => [c.id, c.kind]));
  const missing = rerunPlan({ planned: fullPlan, rows });
  const covering = Object.fromEntries(reportCases.filter((c) => c.covering_skills).map((c) => [c.id, c.covering_skills]));
  const fullArms = new Set(fullPlan.map((p) => p.arm));
  const graphishPlan = [...fullArms].some((a) => !SKILL_ARMS.has(a));
  const md = report(rows, {
    ...meta, spent, stop, kinds, missing, covering,
    biasNote: graphishPlan && reportCases.some((c) => c.group && !isEditCase(c)), // the proxy filter never chose the 044 edit cases
    skillsBiasNote: [...fullArms].some((a) => SKILL_ARMS.has(a)),
  });
  writeFileSync(join(outDir, 'report.md'), md);
  console.log('\n' + md);
  const oraclePlan = [...fullArms].some(isOracleArm);
  const needGraphCall = [...fullArms].some(isGraphArm) && !oraclePlan;
  const v = checkVerdict(rows, { planned: fullPlan, needGraphCall });
  console.log(`check: ${v.pass ? 'PASS' : 'FAIL'} (all planned runs counted: ${v.complete}, all counted runs valid: ${v.allValid}, every arm ran: ${v.bothArms}, graph arm real code-graph call exit 0: ${v.realCall}${needGraphCall ? '' : ' (not required: oracle arm or no graph arm)'})`);
  console.log(`results: ${outDir}`);
  if (stop || !v.pass) process.exit(3);
}
