#!/usr/bin/env node
// 070/071 refactor mode: does a cheap Haiku refactor scout, with a Sonnet filter, find code-structure
// improvements as well as a Sonnet refactor pass, at lower cost? Reuses the 066 review runner's shape.
// Run from a plain terminal (a nested sandbox breaks Bash), except --dry and --init-check.
// Usage: node bench/refactor-run.mjs --budget <usd> --run-budget <usd> [--arms a,b] [--only <substrings>]
//                                    [--set 071] [--runs 2] [--dry] [--keep-ws] [--init-check]
// --budget (total cap) and --run-budget (cap of one claude session) have NO default: they are the user's to
// set (docs/evals.md, Tickets 070 and 071); a paid run without both is refused. --dry and --init-check need
// neither.
// Arms (default, 071): sonnet-plain, haiku-metrics-primer, haiku-batched-filter, haiku-reviewer-inline; the
// control review `sonnet-review-plain` is added with the inline arm. The 070 spawn arm and per-case pipeline
// stay defined (graders, prompts) but this runner refuses them. Default runs: 2. --set picks the case set
// (default 071; `070` reruns the retired set with the 071 arms).
// The scope and the metrics primer of each case are the stored files under bench/refactor/
// (bench/refactor-prep.mjs). One Haiku scout session per (case, run) is SHARED by every scout arm: its cost
// counts in each of them, the spend once. The batch filter is one Sonnet session per batch of cases; its
// cost is split over the batch's cases by proposals. The inline review's cost is the extra over the control
// review of the same change. Every session is capped by --run-budget.
// 073: `--set 073 --arms haiku-metrics-primer,haiku-decided-against` pairs the plain scout with the scout that is
// also told the decided-against entries of the case's neighbourhood (bench/refactor/decided-against.json, built
// by bench/refactor-decided-prep.mjs). The decided-against scout is its own session; both are scored on the same cells.
// Output: bench/results/refactor-<timestamp>/ (transcripts, runs.json, report.md), gitignored.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { budgetStop, parseStream, runStatus, validity } from './lib.mjs';
import { applyReplacements } from './edit.mjs';
import { maestroFor } from './maestro-dir.mjs';
import { diffForPlants } from './review.mjs';
import {
  DEFAULT_REFACTOR_ARMS, DEFAULT_REFACTOR_RUNS, REFACTOR_ARMS, REVIEW_CONTROL, answerProblems, batchFilterPrompt, batchesOf, gradeFiltered, gradeInline,
  gradeRefactor, gradeReviewControl, inlineReviewPrompt, isScoutArm, parseRefactorArms, promptProblems, proposalsOf, refactorArgs, refactorPrompt,
  refactorReport, reviewChangeOf, reviewControlPrompt, reviewPromptProblems, sliceVerdicts, splitCost, stageProblems, stageSpec, stagesOf, storedProblems,
  verdictsOf, withSupportArms,
} from './refactor.mjs';
import { selectRefactorCases } from './refactor-cases.mjs';
import { DECIDED_ARM, decidedBlock, decidedFor, decidedReport, loadDecided } from './refactor-decided.mjs';
import { refactorFile } from './refactor-prep.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const opts = { arms: DEFAULT_REFACTOR_ARMS, only: '', set: '071', runs: DEFAULT_REFACTOR_RUNS, budget: '', 'run-budget': '' };
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
  die('a paid run needs both --budget <usd> (total cap) and --run-budget <usd> (cap of one session): the caps are the user\'s to set (docs/evals.md, Ticket 071)');
}

let arms;
try { arms = withSupportArms(parseRefactorArms(opts.arms)); } catch (e) { die(e.message); }
const unsupported = arms.filter((a) => REFACTOR_ARMS[a].filter || REFACTOR_ARMS[a].spawn);
if (unsupported.length) die(`${unsupported.join(', ')}: the 070 arms are defined and tested but this runner (071) does not orchestrate them; use the 070 runner from git history (docs/evals.md, Ticket 070)`);
const cases = selectRefactorCases(opts.only, opts.set);
if (!cases.length) die(`no case matches --only "${opts.only}" in set ${opts.set}`);
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

// The decided-against list: the planned arms read it; the plain scout's rows record which entries it would have got.
let decided = null;
try { if (arms.includes(DECIDED_ARM)) decided = loadDecided(); } catch (e) { die(e.message); }
const readIn = (ws) => (f) => (existsSync(join(ws, f)) ? readFileSync(join(ws, f), 'utf8') : null);
const decidedOf = (scope, ws) => decidedFor(decided.entries, scope, readIn(ws));
const listedMeta = (d) => ({ listed: d.inject.map((e) => e.id), injected: d.inject.map((e) => e.id), expired: d.expired.map((e) => e.id) });

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
console.log(`refactor-run: set ${opts.set}, ${cases.length} cases, ${plan.length} cells (${arms.map((a) => `${a} ${plan.filter((p) => p.arm === a).length}`).join(', ')}), cap ${DRY ? '(dry)' : `$${BUDGET}`}, per session ${DRY ? '(dry)' : `$${opts['run-budget']}`}`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(here, 'results', `refactor-${stamp}`);
const rows = [];
let spent = 0; // every session once, however many arms share it
let stop = null;
const meta = { budget: BUDGET, 'run-budget': Number(opts['run-budget'] || 0), arms, set: opts.set, ...(arms.includes(DECIDED_ARM) ? { decidedEntries: decided.entries } : {}) };
const save = () => writeFileSync(join(outDir, 'runs.json'), JSON.stringify({ meta, planned: plan, rows, spent, stop }, null, 1));
if (!DRY) mkdirSync(outDir, { recursive: true });

// A fresh pinned workspace with `change` ([{ file, from, to }]) applied; the diff of the change against the
// pristine tree. The change must apply to the pinned tree, or the case does not run.
function workspace(c, change, label) {
  const ws = mkdtempSync(join(work, 'bench-refactor-'));
  const sc = spawnSync('bash', ['-c', setupCmd(c)], { cwd: ws, encoding: 'utf8', timeout: 180000 });
  if (sc.status !== 0) throw new Error(`setup failed for ${c.id}: ${sc.stderr || sc.stdout}`);
  let diff = '';
  if (change.length) {
    diff = diffForPlants((f) => readFileSync(join(ws, f), 'utf8'), change, `${c.id} ${label}`).diff;
    applyReplacements(ws, change, `${c.id} ${label}`);
  }
  return { ws, diff };
}
const drop = (ws) => { if (!bool.has('keep-ws')) rmSync(ws, { recursive: true, force: true }); };
const cantAfford = (what) => {
  if (DRY || !budgetStop(spent, opts['run-budget'], BUDGET)) return false;
  stop = `the next session (${what}) could exceed the $${BUDGET} cap (spent $${spent.toFixed(3)}, up to $${opts['run-budget']} per session)`;
  return true;
};

// One claude session; returns { m, problems, answer } or null after setting `stop`.
function session(c, arm, stage, n, ws, prompt, label = `${arm}-${stage}`) {
  const args = refactorArgs(arm, stage, prompt, { runBudget: opts['run-budget'] || '0.01' });
  process.stdout.write(`[${c.id} ${label} run${n}] ... `);
  const r = spawnSync('claude', args, { cwd: ws, encoding: 'utf8', maxBuffer: 1 << 29, timeout: 900000 });
  const dir = join(outDir, c.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${label}-run${n}.jsonl`), r.stdout || '');
  if (r.stderr) writeFileSync(join(dir, `${label}-run${n}.stderr.txt`), r.stderr);
  if (r.error) { stop = `could not run claude: ${r.error.message}`; return null; }
  const m = parseStream(r.stdout || '');
  const problems = [...pluginless(m, c), ...stageProblems(arm, stage, m, r.stdout || '')];
  if (r.status !== 0 && m.cost == null) problems.push(`claude exited ${r.status} with no result (see stderr file)`);
  spent += m.cost || 0;
  console.log(`exit ${r.status} cost ${m.cost ?? 'n/a'} total $${spent.toFixed(3)}`);
  return { m, problems };
}

const strip = (m) => { const { init, ...rest } = m || {}; void init; return rest; };
// Record a row and apply the stop rules; true when the run must stop.
function record(c, arm, n, first, second, grade, extraProblems = [], m2override = null) {
  const problems = [...first.problems, ...(second ? second.problems : []), ...extraProblems, ...(first.m.cost != null ? answerProblems(arm, grade) : [])];
  const status = runStatus(second && runStatus(first.m, []) === 'valid' ? second.m : first.m, problems); // a usage limit in either session
  rows.push({ case: c.id, arm, run: n, m: strip(first.m), m2: m2override || (second ? strip(second.m) : undefined), problems, status, grade, answer: first.m.answer, answer2: second?.m.answer });
  save();
  console.log(`  [${c.id} ${arm} run${n}] -> ${status} kept ${grade.found}/${grade.planted} false findings ${grade.falseFindings}${grade.anchor ? ` anchoring ${grade.anchor.kept}/${grade.anchor.scout}` : ''}${grade.review ? ` review findings ${grade.review.findings}` : ''}`);
  if (status === 'usage-limit') { stop = `account usage limit (429) on ${c.id} ${arm} run${n}; that cell and the ones after it are not counted. Rerun the missing cells with --only and --arms once it resets`; return true; }
  if (first.m.seccomp || second?.m.seccomp) { stop = 'apply-seccomp seen: nested sandbox is active, aborting'; return true; }
  if (rows.filter((x) => x.status === 'invalid').length > 1) { stop = 'more than one run is invalid for a reason other than a usage limit: stopping, report this before spending more'; return true; }
  return false;
}

const scoutArms = arms.filter(isScoutArm).filter((a) => !REFACTOR_ARMS[a].filter);
const wants = (a) => arms.includes(a);

// ---- dry run: build everything, spend nothing -----------------------------------------------------------
if (DRY) {
  for (const c of cases) {
    const scope = stored(c, 'scope.txt');
    for (const arm of arms) {
      const a = REFACTOR_ARMS[arm];
      const note = [];
      if (a.decided) {
        // the arm's prompt is built in the case's workspace: the contentHash of each entry is read from the planted tree
        const w = workspace(c, c.refactor.plant || [], 'plant');
        const d = decidedOf(scope, w.ws);
        drop(w.ws);
        if (!d.inject.length) die(`${c.id} ${arm}: no decided-against entry for the neighbourhood (the case does not belong in the 073 set)`);
        if (d.expired.length) die(`${c.id} ${arm}: expired entries at the measured tree: ${d.expired.map((e) => e.id).join(', ')}; rerun node bench/refactor-decided-prep.mjs --check`);
        const prompt = refactorPrompt(arm, scope, stored(c, 'primer.txt'), decidedBlock(d.inject));
        const pp = promptProblems(arm, prompt);
        if (pp.length) die(`${c.id} ${arm}: ${pp.join('; ')}`);
        note.push(`scope prompt ${prompt.length} chars with ${d.inject.length} decided-against entries (${d.outside.length} of the list are outside the neighbourhood, ${d.expired.length} expired)`);
      } else if (!a.review) {
        const prompt = refactorPrompt(arm, scope, a.primer ? stored(c, 'primer.txt') : '');
        const pp = promptProblems(arm, prompt);
        if (pp.length) die(`${c.id} ${arm}: ${pp.join('; ')}`);
        note.push(`scope prompt ${prompt.length} chars`);
      }
      if (a.review || a.inline) {
        const w = workspace(c, reviewChangeOf(c), 'review change');
        drop(w.ws);
        if (!w.diff.trim()) die(`${c.id}: no change for the review arms (add refactor.reviewChange)`);
        const prompt = a.inline ? inlineReviewPrompt(w.diff, ['x.ts: dedupe: example']) : reviewControlPrompt(w.diff);
        const rp = reviewPromptProblems(arm, prompt);
        if (rp.length) die(`${c.id} ${arm}: ${rp.join('; ')}`);
        note.push(`review prompt ${prompt.length} chars, diff ${w.diff.length} chars`);
      } else if (!a.decided) {
        const w = workspace(c, c.refactor.plant || [], 'plant');
        drop(w.ws);
      }
      if (a.batch) note.push(`+ one Sonnet batch filter per batch (batch ${c.batch})`);
      if (a.filter) note.push('+ a filter session (Sonnet) over the scout\'s proposals');
      const stage = stagesOf(arm)[0];
      const args = refactorArgs(arm, stage, 'PROMPT', { runBudget: opts['run-budget'] || '(user cap)' });
      console.log(`[${c.id} ${arm}] ${note.join('; ')}\n  claude ${args.map((x) => JSON.stringify(x.length > 80 ? `${x.slice(0, 80)}...` : x)).join(' ')}`);
    }
  }
  const sizes = batchesOf(cases).map((b) => `batch ${b[0].batch ?? b[0].id}: ${b.map((x) => x.id).join(', ')}`);
  console.log(`\nbatches: ${sizes.join(' | ')}`);
  console.log(`dry run ok: ${cases.length} cases, ${arms.length} arms, no session started.`);
  process.exit(0);
}

// ---- the paid run -----------------------------------------------------------------------------------------
const runBatches = batchesOf(cases);
outer:
for (let n = 1; n <= Number(opts.runs); n++) {
  const scouts = new Map(); // case id -> { first, items, scope }
  for (const c of cases) {
    const scope = stored(c, 'scope.txt');
    const primer = stored(c, 'primer.txt');
    // baseline: one Sonnet pass over the planted tree
    if (wants('sonnet-plain')) {
      if (cantAfford('sonnet-plain')) break outer;
      let w;
      try { w = workspace(c, c.refactor.plant || [], 'plant'); } catch (e) { stop = e.message; break outer; }
      const prompt = refactorPrompt('sonnet-plain', scope, '');
      const pp = promptProblems('sonnet-plain', prompt);
      if (pp.length) { stop = `${c.id} sonnet-plain: ${pp.join('; ')}`; break outer; }
      const s = session(c, 'sonnet-plain', 'main', n, w.ws, prompt);
      drop(w.ws);
      if (!s) break outer;
      if (record(c, 'sonnet-plain', n, s, null, gradeRefactor(c, s.m.answer))) break outer;
    }
    // the shared Haiku scout: one session, cost counted in every scout arm
    if (scoutArms.length) {
      if (cantAfford('haiku scout')) break outer;
      let w;
      try { w = workspace(c, c.refactor.plant || [], 'plant'); } catch (e) { stop = e.message; break outer; }
      const prompt = refactorPrompt('haiku-metrics-primer', scope, primer);
      const listed = decided && wants(DECIDED_ARM) ? listedMeta(decidedOf(scope, w.ws)) : null; // the entries the decided-against arm gets in this cell
      const s = session(c, 'haiku-metrics-primer', 'main', n, w.ws, prompt, 'haiku-scout');
      drop(w.ws);
      if (!s) break outer;
      const items = s.m.cost != null ? proposalsOf(s.m.answer).items : [];
      scouts.set(c.id, { first: s, items, scope });
      if (wants('haiku-metrics-primer') && record(c, 'haiku-metrics-primer', n, s, null, { ...gradeRefactor(c, s.m.answer), ...(listed ? { decided: listed } : {}) })) break outer;
    }
    // 073: the same scout with the decided-against entries of this neighbourhood, its own session
    if (wants(DECIDED_ARM)) {
      if (cantAfford('haiku decided-against scout')) break outer;
      let w;
      try { w = workspace(c, c.refactor.plant || [], 'plant'); } catch (e) { stop = e.message; break outer; }
      const d = decidedOf(scope, w.ws);
      if (!d.inject.length || d.expired.length) { drop(w.ws); stop = `${c.id} ${DECIDED_ARM}: ${d.inject.length ? `expired entries ${d.expired.map((e) => e.id).join(', ')}` : 'no decided-against entry for the neighbourhood'}`; break outer; }
      const prompt = refactorPrompt(DECIDED_ARM, scope, primer, decidedBlock(d.inject));
      const pp = promptProblems(DECIDED_ARM, prompt);
      if (pp.length) { drop(w.ws); stop = `${c.id} ${DECIDED_ARM}: ${pp.join('; ')}`; break outer; }
      const s = session(c, DECIDED_ARM, 'main', n, w.ws, prompt, 'haiku-decided');
      drop(w.ws);
      if (!s) break outer;
      if (record(c, DECIDED_ARM, n, s, null, { ...gradeRefactor(c, s.m.answer), decided: listedMeta(d) })) break outer;
    }
    // the control review, then the inline review of the same change
    let control = null;
    if (wants(REVIEW_CONTROL)) {
      if (cantAfford('control review')) break outer;
      let w;
      try { w = workspace(c, reviewChangeOf(c), 'review change'); } catch (e) { stop = e.message; break outer; }
      const prompt = reviewControlPrompt(w.diff);
      const rp = reviewPromptProblems(REVIEW_CONTROL, prompt);
      if (rp.length) { stop = `${c.id} ${REVIEW_CONTROL}: ${rp.join('; ')}`; break outer; }
      const s = session(c, REVIEW_CONTROL, 'review', n, w.ws, prompt);
      drop(w.ws);
      if (!s) break outer;
      control = s;
      if (record(c, REVIEW_CONTROL, n, s, null, gradeReviewControl(s.m.answer))) break outer;
    }
    if (wants('haiku-reviewer-inline')) {
      const sc = scouts.get(c.id);
      let second = null;
      let w = null;
      if (sc.items.length) {
        if (cantAfford('inline review')) break outer;
        try { w = workspace(c, reviewChangeOf(c), 'review change'); } catch (e) { stop = e.message; break outer; }
        const prompt = inlineReviewPrompt(w.diff, sc.items);
        const rp = reviewPromptProblems('haiku-reviewer-inline', prompt);
        if (rp.length) { stop = `${c.id} haiku-reviewer-inline: ${rp.join('; ')}`; break outer; }
        second = session(c, 'haiku-reviewer-inline', 'inline', n, w.ws, prompt);
        drop(w.ws);
        if (!second) break outer;
      }
      const grade = gradeInline(c, sc.first.m.answer, second ? second.m.answer : null);
      const extraProblems = [];
      let m2 = null;
      if (second) {
        const ctlCost = control && control.problems.length === 0 ? control.m.cost : null;
        if (ctlCost == null || second.m.cost == null) extraProblems.push('inline: the control review is missing or invalid, so the extra cost of the list is unknown');
        else m2 = { ...strip(second.m), rawCost: second.m.cost, controlCost: ctlCost, cost: second.m.cost - ctlCost };
      }
      if (record(c, 'haiku-reviewer-inline', n, sc.first, second, grade, extraProblems, m2)) break outer;
    }
  }
  // the batch filter: one Sonnet session per batch over the combined backlog of its cases
  if (wants('haiku-batched-filter')) {
    for (const group of runBatches) {
      const members = group.map((c) => ({ c, sc: scouts.get(c.id) })).filter((x) => x.sc);
      const live = members.filter((x) => x.sc.items.length);
      let bs = null;
      let v = null;
      if (live.length) {
        if (cantAfford('batch filter')) break outer;
        let w;
        try {
          w = workspace(live[0].c, live[0].c.refactor.plant || [], 'plant');
          for (const x of live.slice(1)) applyReplacements(w.ws, x.c.refactor.plant || [], `${x.c.id} plant`);
        } catch (e) { stop = e.message; break outer; }
        const prompt = batchFilterPrompt(live.map((x) => ({ id: x.c.id, scope: x.sc.scope, items: x.sc.items })));
        bs = session(live[0].c, 'haiku-batched-filter', 'batch', n, w.ws, prompt, `batch-${live.map((x) => x.c.id).join('+')}`);
        drop(w.ws);
        if (!bs) break outer;
        v = verdictsOf(bs.m.answer, live.reduce((a, x) => a + x.sc.items.length, 0));
      }
      const shares = bs && bs.m.cost != null ? splitCost(bs.m.cost, live.map((x) => x.sc.items.length)) : [];
      let off = 0;
      for (const x of members) {
        const k = x.sc.items.length;
        const grade = gradeFiltered(x.c, x.sc.first.m.answer, (cnt) => (v ? sliceVerdicts(v, off, cnt) : null));
        const share = k && shares.length ? shares[live.indexOf(x)] : 0;
        const m2 = bs && k ? { ...strip(bs.m), rawCost: bs.m.cost, cost: share } : null;
        off += k;
        if (record(x.c, 'haiku-batched-filter', n, x.sc.first, k ? bs : null, grade, [], m2)) break outer;
      }
    }
  }
}

save();
let md = refactorReport(rows, { ...meta, spent, stop, planned: plan });
if (wants(DECIDED_ARM) && wants('haiku-metrics-primer')) md += decidedReport(rows, plan, new Map(cases.map((c) => [c.id, c])), decided.entries);
writeFileSync(join(outDir, 'report.md'), md);
console.log('\n' + md);
console.log(`results: ${outDir}`);
console.log(`next: node bench/refactor-audit.mjs ${outDir} --pool, then write audit-verdicts.txt for the pool's hand list and run --score`);
if (stop) process.exit(3);
