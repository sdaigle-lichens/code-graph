// node --test bench/lib.test.mjs : validity, metrics and report logic on synthetic stream-json transcripts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStream, validity, report, checkVerdict, score, claudeArgs, isCg, selectCases, parseArms, oraclePrompt, promptFor,
  planRuns, budgetStop, runStatus, rerunPlan, setupArm, oracleFile, sums, costDelta, ORACLE_HEADER,
  isConceptSkillMd, skillNameOf, coveringLoads, proposals, SKILLS_BIAS_NOTE,
} from './lib.mjs';
import { listSkills, stripConceptSkills } from './strip-concept-skills.mjs';

const J = (...evs) => evs.map((e) => JSON.stringify(e)).join('\n') + '\n';
const init = (plugins = [], skills = []) => ({ type: 'system', subtype: 'init', plugins, skills, slash_commands: [], agents: [] });
const CG = [{ name: 'code-graph', path: '/x/plugin' }];
const bash = (id, command) => ({ type: 'assistant', message: { id: 'm' + id, usage: { input_tokens: 3, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 }, content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
const res = (id, content, is_error = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } });
const tool = (id, name) => ({ type: 'assistant', message: { id: 'm' + id, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id, name, input: {} }] } });
const done = (extra = {}) => ({ type: 'result', total_cost_usd: 0.1, num_turns: 4, is_error: false, result: 'useDragReorder and notifyOverdue', ...extra });
const CMD = 'node plugin/scripts/code-graph.cjs impact moveTask';

test('metrics: tool counts, tokens, cost, turns, graph calls', () => {
  const m = parseStream(J(init(CG), tool('a', 'Read'), tool('b', 'Grep'), tool('c', 'Glob'), tool('d', 'Skill'), bash('e', CMD), res('e', 'x'.repeat(50)), done()));
  assert.deepEqual(m.counts, { Read: 1, Grep: 1, Glob: 1, Bash: 1, Skill: 1 });
  assert.equal(m.cost, 0.1); assert.equal(m.turns, 4);
  assert.equal(m.input, 7); assert.equal(m.output, 9); assert.equal(m.cacheRead, 100); assert.equal(m.cacheCreate, 10);
  assert.deepEqual(m.graphCalls, [{ exit: 0, chars: 50 }]);
  assert.deepEqual(validity('graph', m), []);
});

test('duplicate assistant message ids are counted once for tokens', () => {
  const a = bash('e', CMD);
  const m = parseStream(J(init(CG), a, a, done()));
  assert.equal(m.input, 3);
});

test('seccomp output invalidates, and counts', () => {
  const out = 'Exit code 1\napply-seccomp: write /proc/self/setgroups: Permission denied';
  const m = parseStream(J(init(CG), bash('e', CMD), res('e', out, true), done()));
  assert.equal(m.seccomp, 1);
  assert.ok(validity('graph', m).some((p) => /apply-seccomp/.test(p)));
});

test('documented code-graph exits 0/4/6/7 are not failures', () => {
  for (const code of [0, 4, 6, 7]) {
    const m = parseStream(J(init(CG), bash('e', CMD), res('e', `Exit code ${code}\nsome output`, code !== 0), done()));
    assert.deepEqual(validity('graph', m), [], `exit ${code}`);
    assert.equal(m.graphCalls[0].exit, code);
  }
});

test('undocumented code-graph exit (1, 2, 3, 5) invalidates', () => {
  for (const code of [1, 2, 3, 5]) {
    const m = parseStream(J(init(CG), bash('e', CMD), res('e', `Exit code ${code}\nboom`, true), done()));
    assert.ok(validity('graph', m).some((p) => /Bash failure/.test(p)), `exit ${code}`);
  }
});

test('non-code-graph Bash failure invalidates, in both arms', () => {
  for (const arm of ['graph', 'nograph']) {
    const m = parseStream(J(init(arm === 'graph' ? CG : []), bash('e', 'ls /nope'), res('e', 'Exit code 2\nls: cannot access', true), done()));
    assert.ok(validity(arm, m).some((p) => /Bash failure/.test(p)), arm);
  }
});

test('non-code-graph Bash success is fine', () => {
  const m = parseStream(J(init([]), bash('e', 'ls'), res('e', 'a\nb'), done()));
  assert.deepEqual(validity('nograph', m), []);
});

test('init: nograph arm with code-graph in plugins, skills or slash_commands is invalid', () => {
  assert.ok(validity('nograph', parseStream(J(init(CG), done()))).some((p) => /config leak/.test(p)));
  assert.ok(validity('nograph', parseStream(J(init([], ['code-graph:graph']), done()))).some((p) => /config leak/.test(p)));
  const ev = { ...init(), slash_commands: ['code-graph:graph'] };
  assert.ok(validity('nograph', parseStream(J(ev, done()))).some((p) => /config leak/.test(p)));
  assert.deepEqual(validity('nograph', parseStream(J(init(['other']), done()))), []);
});

test('init: graph arm without code-graph is invalid; plugin given as plain string works', () => {
  assert.ok(validity('graph', parseStream(J(init([]), done()))).some((p) => /graph arm/.test(p)));
  assert.deepEqual(validity('graph', parseStream(J(init(['code-graph@local']), done()))), []);
});

test('missing init, error result, and missing result are all invalid', () => {
  assert.ok(validity('graph', parseStream(J(done()))).some((p) => /no init/.test(p)));
  assert.ok(validity('graph', parseStream(J(init(CG), done({ is_error: true })))).some((p) => /is_error/.test(p)));
  assert.ok(validity('graph', parseStream(J(init(CG)))).some((p) => /no result/.test(p)));
});

test('garbage and blank lines are skipped', () => {
  const m = parseStream('not json\n\n' + J(init(CG), done()));
  assert.equal(m.cost, 0.1);
});

test('answer falls back to last assistant text when result has none', () => {
  const t = { type: 'assistant', message: { id: 'z', content: [{ type: 'text', text: 'final words' }] } };
  const m = parseStream(J(init(CG), t, done({ result: undefined })));
  assert.equal(m.answer, 'final words');
});

test('score is case-insensitive regex hits', () => {
  assert.deepEqual(score('USEDRAGREORDER only', ['useDragReorder', 'notifyOverdue']), { hits: 1, of: 2 });
});

test('claudeArgs: graph arm has --plugin-dir, nograph does not; isolation flags on both', () => {
  const o = { model: 'sonnet', runBudget: 0.4, pluginDir: '/p' };
  const g = claudeArgs('graph', 'q', o); const n = claudeArgs('nograph', 'q', o);
  assert.ok(g.includes('--plugin-dir') && !n.includes('--plugin-dir'));
  for (const a of [g, n]) for (const f of ['--setting-sources', '--strict-mcp-config', '--no-session-persistence', '--max-budget-usd', '--allowedTools']) assert.ok(a.includes(f), f);
  assert.match(g[g.indexOf('--allowedTools') + 1], /Bash/);
  for (const a of [g, n]) assert.equal(a[a.indexOf('--setting-sources') + 1], 'project,local');
});

test('validity: code-graph only in the graph arm, concept skills in both', () => {
  const skills = ['task-queue'];
  const ng = parseStream(J(init([], ['task-queue']), done()));
  const g = parseStream(J(init(CG, ['task-queue']), done()));
  assert.deepEqual(validity('nograph', ng, skills), []);
  assert.deepEqual(validity('graph', g, skills), []);
  assert.ok(validity('nograph', g, skills).some((p) => /config leak/.test(p)));
  assert.ok(validity('graph', parseStream(J(init(CG, []), done())), skills).some((p) => /task-queue/.test(p)));
  assert.ok(validity('graph', parseStream(J(init([], ['task-queue']), done())), skills).some((p) => /graph arm/.test(p)));
});

test('report carries the selection-bias note when asked', () => {
  const r = [row('graph', 1, good('graph'))];
  assert.match(report(r, { model: 'm', spent: 0, budget: 1, biasNote: true }), /selection bias/);
  assert.doesNotMatch(report(r, { model: 'm', spent: 0, budget: 1 }), /selection bias/);
});

test('maestro-setup.sh drops settings.json in both arms and scribe-output in the no-graph arm', async () => {
  const { readFileSync } = await import('node:fs');
  const s = readFileSync(new URL('./maestro-setup.sh', import.meta.url), 'utf8');
  assert.match(s, /rm -f \.claude\/settings\.json/);
  assert.match(s, /rm -rf scribe-output/);
});

// The guard runs before anything else, so every case passes a nonexistent maestro dir: even past the
// guard, `git archive` fails at once and nothing is extracted. Each case runs in a fresh mkdtemp dir
// under $TMPDIR, never in the repo.
test('maestro-setup.sh guard: refuses a non-empty cwd or one inside a git work tree; passes an empty non-git dir', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { spawnSync } = await import('node:child_process');
  const script = fileURLToPath(new URL('./maestro-setup.sh', import.meta.url));
  const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'bench-guard-'));
  const env = { ...process.env };
  delete env.GIT_DIR; delete env.GIT_WORK_TREE;
  const run = (cwd) => spawnSync('bash', [script, '/nonexistent-repo', join(root, 'no-maestro'), '3814a30', 'nograph'], { cwd, env, encoding: 'utf8' });
  try {
    const full = join(root, 'full');
    mkdirSync(full);
    writeFileSync(join(full, 'keep.txt'), 'x');
    let r = run(full);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^maestro-setup: refusing, cwd is not empty/);
    assert.equal(r.stderr.trim().split('\n').length, 1);
    assert.deepEqual(readdirSync(full), ['keep.txt']);

    const repoDir = join(root, 'repo');
    mkdirSync(repoDir);
    assert.equal(spawnSync('git', ['init', '-q', repoDir], { env }).status, 0);
    const sub = join(repoDir, 'sub');
    mkdirSync(sub);
    r = run(sub);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^maestro-setup: refusing, cwd is inside a git work tree/);
    assert.equal(r.stderr.trim().split('\n').length, 1);
    assert.deepEqual(readdirSync(sub), []);

    const empty = join(root, 'empty');
    mkdirSync(empty);
    assert.notEqual(spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: empty, env }).status, 0, '$TMPDIR must not be inside a git work tree for this test');
    r = run(empty);
    // Past the guard: it fails later, in `git archive` on the nonexistent maestro dir (tar then exits
    // 2 on empty input, so the status cannot tell guard from archive; stderr can).
    assert.doesNotMatch(r.stderr, /maestro-setup: refusing/);
    assert.match(r.stderr, /no-maestro|not a git repository|cannot change to/i);
    assert.deepEqual(readdirSync(empty), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('run.mjs runs setup in a fresh mkdtemp workspace, which satisfies the maestro-setup.sh guard', async () => {
  const { readFileSync } = await import('node:fs');
  const s = readFileSync(new URL('./run.mjs', import.meta.url), 'utf8');
  // the init check (a log line sits between the two) and the paid runs
  const calls = [...s.matchAll(/const ws = mkdtempSync\(join\(work, [^\n]*\n(?:\s*console\.log\([^\n]*\n)?\s*const sc = spawnSync\('bash', \['-c', setupCmd\(c, arm\)\], \{ cwd: ws/g)];
  assert.equal(calls.length, 2);
  assert.equal((s.match(/setupCmd\(c, arm\)/g) || []).length, 2); // no other setup call that could skip mkdtemp
  const cap = readFileSync(new URL('./capture-oracle.mjs', import.meta.url), 'utf8');
  assert.match(cap, /const ws = mkdtempSync\([^\n]*\n\s*const sc = spawnSync\('bash', \['-c', setup\], \{ cwd: ws/);
});

test('selectCases: --group by substring on the group field, composes with --only', async () => {
  const { readFileSync } = await import('node:fs');
  const all = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8')).cases;
  const ids = (o) => selectCases(all, o).map((c) => c.id);
  assert.equal(ids({}).length, all.length);
  const g = ids({ group: 'maestro' });
  assert.deepEqual(g.map((i) => i.split('-')[0]), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 's1', 's2', 's3']);
  assert.ok(!g.includes('02-impact-movetask'));
  assert.deepEqual(ids({ group: 'maestro', only: 'm4' }), ['m4-cross-install-config']);
  assert.deepEqual(ids({ group: 'maestro', only: 'movetask' }), []);
  assert.deepEqual(ids({ group: 'nomatch' }), []);
});

test('run-budget default is 0.75', async () => {
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(new URL('./run.mjs', import.meta.url), 'utf8'), /'run-budget': '0\.75'/);
});

test('isCg: real CLI invocations only', () => {
  for (const c of [
    'node plugin/scripts/code-graph.cjs impact moveTask',
    'node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" query cross a b',
    'code-graph query impact x',
    'cd src && node ./code-graph.cjs search "q"',
    'CLAUDE_PROJECT_DIR=/w node /p/scripts/code-graph.cjs status',
    'node --no-warnings /p/code-graph.cjs status 2>&1 | head',
  ]) assert.equal(isCg(c), true, c);
  for (const c of [
    'grep -rn code-graph .',
    'grep "code-graph.cjs" docs/usage.md',
    'echo code-graph',
    'cat plugin/scripts/code-graph.cjs',
    'ls ~/.claude/plugins/code-graph',
    'node build.js code-graph',
    'git log -- code-graph.cjs',
  ]) assert.equal(isCg(c), false, c);
});

test('isCg: empty input, lookalike names, later segments', () => {
  for (const c of ['', undefined, null, '   ', 'my-code-graph query x', 'node code-graph.cjs.bak', 'node -e "1" other.js', 'FOO=1']) {
    assert.equal(isCg(c), false, String(c));
  }
  for (const c of ['echo hi | code-graph status', 'true || node /p/code-graph.cjs status', 'echo a\ncode-graph status', "node '/p/scripts/code-graph.cjs' status"]) {
    assert.equal(isCg(c), true, c);
  }
});

test('a grep mentioning code-graph is not graded as a CLI call', () => {
  const m = parseStream(J(init(CG), bash('e', 'grep -rn code-graph .'), res('e', 'Exit code 1\n', true), done()));
  assert.deepEqual(m.graphCalls, []);
  assert.ok(validity('graph', m).some((p) => /Bash failure/.test(p)));
});

test('validity: expected project skills must load in both arms', () => {
  const m = parseStream(J(init([], ['task-queue', 'global-stores']), done()));
  assert.deepEqual(validity('nograph', m, ['task-queue', 'global-stores']), []);
  assert.ok(validity('nograph', m, ['task-queue', 'log-view']).some((p) => /log-view/.test(p)));
  const g = parseStream(J(init(CG, ['maestro:task-queue']), done()));
  assert.deepEqual(validity('graph', g, ['task-queue']), []);
});

test('runner defaults to Opus 5.5 explicitly', async () => {
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(new URL('./run.mjs', import.meta.url), 'utf8'), /model: 'claude-opus-5-5'/);
});

const row = (arm, run, m, problems = []) => ({ case: 'c', arm, run, m, problems, sc: { hits: 1, of: 2 } });
const good = (arm) => parseStream(J(init(arm === 'graph' ? CG : []), bash('e', arm === 'graph' ? CMD : 'ls'), res('e', 'out'), done()));

test('report lists invalid runs before the table; budget stop is shown', () => {
  const bad = parseStream(J(init(CG), bash('e', CMD), res('e', 'apply-seccomp x', true), done()));
  const md = report([row('nograph', 1, good('nograph')), row('graph', 1, bad, validity('graph', bad))], { model: 'sonnet', spent: 1.01, budget: 1, stop: 'total budget $1 reached' });
  assert.ok(md.indexOf('INVALID RUNS') < md.indexOf('## Per case and arm'));
  assert.match(md, /STOPPED: total budget/);
  assert.match(md, /\| graph \| 1 \| INVALID/);
});

test('checkVerdict: pass, no real call, invalid run, missing arm', () => {
  const ok = [row('nograph', 1, good('nograph')), row('graph', 1, good('graph'))];
  assert.equal(checkVerdict(ok).pass, true);
  const empty = parseStream(J(init(CG), bash('e', CMD), res('e', ''), done()));
  assert.equal(checkVerdict([ok[0], row('graph', 1, empty)]).pass, false);
  const exit4 = parseStream(J(init(CG), bash('e', CMD), res('e', 'Exit code 4\nno match', true), done()));
  assert.equal(checkVerdict([ok[0], row('graph', 1, exit4)]).realCall, false);
  assert.equal(checkVerdict([ok[0], row('graph', 1, good('graph'), ['x'])]).pass, false);
  assert.equal(checkVerdict([ok[1]]).pass, false);
  assert.equal(checkVerdict([]).pass, false);
});

// --- 041: oracle arm, arm plan, usage-limit reruns ---

const limitResult = (cost = 0) => ({ type: 'result', total_cost_usd: cost, num_turns: 1, is_error: true, subtype: 'success', api_error_status: 429, api_error: 'usage_limit_reached', result: "You've hit your session limit" });
const crow = (c, arm, run, m, status) => ({ case: c, arm, run, m, problems: status === 'invalid' ? ['x'] : [], status, sc: { hits: 1, of: 1 } });

test('parseArms: known arms in ARMS order, deduped; unknown or empty throws', () => {
  assert.deepEqual(parseArms('graph,nograph,oracle,graph'), ['nograph', 'oracle', 'graph']);
  assert.deepEqual(parseArms(' oracle , nograph '), ['nograph', 'oracle']);
  assert.throws(() => parseArms('nograph,grpah'), /unknown arm.*grpah/);
  assert.throws(() => parseArms(''), /no arm/);
});

test('oraclePrompt: question first, then the stored output framed as code-index context', () => {
  const p = oraclePrompt('Who calls x?', '\n# Impact\n- @a.ts:1 — `y`\n');
  assert.ok(p.startsWith('Who calls x?\n\n'));
  assert.ok(p.includes(ORACLE_HEADER));
  assert.ok(p.indexOf(ORACLE_HEADER) < p.indexOf('- @a.ts:1'));
  assert.match(p, /<code-index>\n# Impact\n- @a\.ts:1 — `y`\n<\/code-index>$/);
  assert.doesNotMatch(ORACLE_HEADER, /code-graph/); // never names the CLI the arm does not have
  assert.throws(() => oraclePrompt('q', ''), /stored index output/);
  assert.throws(() => oraclePrompt('q', '  \n'), /stored index output/);
  assert.throws(() => oraclePrompt('q', undefined), /stored index output/);
});

test('promptFor: only the oracle arm gets the stored output', () => {
  const c = { question: 'Q?' };
  assert.equal(promptFor('nograph', c, 'OUT'), 'Q?');
  assert.equal(promptFor('graph', c, 'OUT'), 'Q?');
  assert.ok(promptFor('oracle', c, 'OUT').startsWith('Q?') && promptFor('oracle', c, 'OUT').includes('OUT'));
  assert.throws(() => promptFor('oracle', c, undefined), /stored index output/);
});

test('oracle arm: nograph workspace and flags (no --plugin-dir), its prompt passed as -p', () => {
  const o = { model: 'm', runBudget: 0.5, pluginDir: '/p' };
  const a = claudeArgs('oracle', 'PROMPT', o);
  assert.ok(!a.includes('--plugin-dir'));
  assert.equal(a[a.indexOf('-p') + 1], 'PROMPT');
  assert.deepEqual(a.slice(2), claudeArgs('nograph', 'PROMPT', o).slice(2));
  assert.equal(setupArm('oracle'), 'nograph');
  assert.equal(setupArm('nograph'), 'nograph');
  assert.equal(setupArm('graph'), 'graph');
});

test('validity: oracle init must show no code-graph plugin; concept skills still required', () => {
  const skills = ['task-queue'];
  assert.deepEqual(validity('oracle', parseStream(J(init([], ['task-queue']), done())), skills), []);
  assert.ok(validity('oracle', parseStream(J(init(CG, ['task-queue']), done())), skills).some((p) => /oracle arm \(config leak\)/.test(p)));
  assert.ok(validity('oracle', parseStream(J(init([], ['code-graph:code-graph-retrieval', 'task-queue']), done())), skills).some((p) => /config leak/.test(p)));
  assert.ok(validity('oracle', parseStream(J(init([], []), done())), skills).some((p) => /task-queue/.test(p)));
  const bad = parseStream(J(init([]), bash('e', 'ls /nope'), res('e', 'Exit code 2\nno', true), done()));
  assert.ok(validity('oracle', bad).some((p) => /Bash failure/.test(p)));
});

test('planRuns: run, then case, then arm; --graph-cases limits only the graph arm', () => {
  const cs = [{ id: 'm1-a' }, { id: 'm6-deep' }, { id: 'm7-deep' }];
  const plan = planRuns(cs, { arms: ['nograph', 'oracle', 'graph'], graphCases: ['m6', 'm7'], runs: 2 });
  const key = (p) => `${p.run}:${p.case}:${p.arm}`;
  assert.deepEqual(plan.slice(0, 8).map(key), [
    '1:m1-a:nograph', '1:m1-a:oracle', '1:m6-deep:nograph', '1:m6-deep:oracle', '1:m6-deep:graph',
    '1:m7-deep:nograph', '1:m7-deep:oracle', '1:m7-deep:graph',
  ]);
  assert.equal(plan.length, 16);
  assert.equal(plan.filter((p) => p.arm === 'graph').length, 4);
  assert.ok(!plan.some((p) => p.arm === 'graph' && p.case === 'm1-a'));
  assert.equal(planRuns(cs, { arms: ['nograph', 'graph'], runs: 1 }).filter((p) => p.arm === 'graph').length, 3);
  assert.deepEqual(planRuns(cs, { arms: ['graph'], graphCases: ['nomatch'], runs: 1 }), []);
});

test('usage limit: 429 result marks the run, status usage-limit (not invalid)', () => {
  const m = parseStream(J(init([]), limitResult(0.22)));
  assert.equal(m.usageLimit, true);
  assert.equal(m.cost, 0.22);
  const problems = validity('nograph', m);
  assert.ok(problems.some((p) => /is_error/.test(p)));
  assert.equal(runStatus(m, problems), 'usage-limit');
  const only = parseStream(J(init([]), { ...limitResult(), api_error_status: undefined }));
  assert.equal(only.usageLimit, true, 'api_error alone is enough');
  const ok = parseStream(J(init([]), done()));
  assert.equal(ok.usageLimit, false);
  assert.equal(runStatus(ok, []), 'valid');
  assert.equal(runStatus(ok, ['Bash failure: x']), 'invalid');
  assert.equal(runStatus(parseStream(J(init([]), done({ is_error: true, api_error_status: 500 }))), ['e']), 'invalid');
});

test('rerunPlan: usage-limit and never-run entries only, in plan order', () => {
  const planned = [
    { case: 'a', arm: 'nograph', run: 1 }, { case: 'a', arm: 'oracle', run: 1 },
    { case: 'b', arm: 'nograph', run: 1 }, { case: 'b', arm: 'oracle', run: 1 },
  ];
  const m = good('nograph');
  const rows = [crow('a', 'nograph', 1, m, 'valid'), crow('a', 'oracle', 1, m, 'invalid'), crow('b', 'nograph', 1, m, 'usage-limit')];
  assert.deepEqual(rerunPlan({ planned, rows }), [planned[2], planned[3]]);
  // rows from before 041 carry no status: derived from problems, never treated as usage-limit
  const legacy = [{ case: 'a', arm: 'nograph', run: 1, m, problems: [] }];
  assert.deepEqual(rerunPlan({ planned: planned.slice(0, 1), rows: legacy }), []);
  assert.deepEqual(rerunPlan({ planned, rows: [...rows, crow('b', 'nograph', 1, m, 'valid'), crow('b', 'oracle', 1, m, 'valid')] }), []);
});

test('budgetStop: never start a run that could exceed the cap', () => {
  assert.equal(budgetStop(0, 0.75, 7), false);
  assert.equal(budgetStop(6.25, 0.75, 7), false);
  assert.equal(budgetStop(6.26, 0.75, 7), true);
  assert.equal(budgetStop(6.5, '0.6', '7'), true);
  assert.equal(budgetStop(1, 0.75, 1), true);
});

test('checkVerdict with a plan: complete + valid; usage-limit rows not counted; graph call optional', () => {
  const planned = [{ case: 'c', arm: 'nograph', run: 1 }, { case: 'c', arm: 'oracle', run: 1 }, { case: 'c', arm: 'graph', run: 1 }];
  const noCall = parseStream(J(init(CG), bash('e', 'ls'), res('e', 'out'), done()));
  const rows = [crow('c', 'nograph', 1, good('nograph'), 'valid'), crow('c', 'oracle', 1, good('nograph'), 'valid'), crow('c', 'graph', 1, noCall, 'valid')];
  assert.equal(checkVerdict(rows, { planned, needGraphCall: false }).pass, true);
  assert.equal(checkVerdict(rows, { planned }).pass, false, 'graph call required by default');
  const limited = [rows[0], crow('c', 'oracle', 1, parseStream(J(init([]), limitResult())), 'usage-limit'), rows[2]];
  const v = checkVerdict(limited, { planned, needGraphCall: false });
  assert.equal(v.allValid, true, 'a usage-limit row is not an invalid row');
  assert.equal(v.complete, false);
  assert.equal(v.pass, false);
  assert.equal(checkVerdict([rows[0], rows[2]], { planned, needGraphCall: false }).bothArms, false);
  assert.equal(checkVerdict([...rows.slice(0, 2), crow('c', 'graph', 1, noCall, 'invalid')], { planned, needGraphCall: false }).pass, false);
});

test('report: usage-limit section, not-run list, per-group sums and oracle vs nograph delta', () => {
  const at = (cost, arm = 'nograph') => parseStream(J(init(arm === 'graph' ? CG : []), done({ total_cost_usd: cost })));
  const rows = [
    crow('m1', 'nograph', 1, at(0.4), 'valid'), crow('m1', 'oracle', 1, at(0.2), 'valid'),
    crow('m6', 'nograph', 1, at(0.5), 'valid'), crow('m6', 'oracle', 1, at(0.25), 'valid'), crow('m6', 'graph', 1, at(0.3, 'graph'), 'valid'),
    crow('m6', 'nograph', 2, parseStream(J(init([]), limitResult(0.1))), 'usage-limit'),
  ];
  const md = report(rows, { model: 'm', spent: 1.75, budget: 7, kinds: { m1: 'impact', m6: 'deep' }, missing: [{ case: 'm6', arm: 'nograph', run: 2 }] });
  assert.match(md, /## USAGE-LIMIT RUNS \(1, not counted/);
  assert.match(md, /- m6 nograph run2: account usage limit \(429\)/);
  assert.match(md, /## NOT RUN \(1 planned/);
  assert.match(md, /\| m6 \| nograph \| 2 \| USAGE-LIMIT \|/);
  assert.match(md, /\| impact \| -50% \| n\/a \|/);
  assert.match(md, /\| deep \| -50% \| \+20% \|/);
  assert.match(md, /\| deep \| nograph \| 1 \| 0\.500 \|/, 'usage-limit run left out of the sums');
  assert.ok(md.indexOf('USAGE-LIMIT RUNS') < md.indexOf('## Per case and arm'));
});

test('sums and costDelta skip invalid and usage-limit rows', () => {
  const m = parseStream(J(init([]), done({ total_cost_usd: 1 })));
  const s = sums([crow('a', 'nograph', 1, m, 'valid'), crow('a', 'nograph', 2, m, 'invalid'), crow('a', 'nograph', 3, m, 'usage-limit')], (r) => r.case);
  assert.equal(s.get('a').n, 1);
  assert.equal(s.get('a').cost, 1);
  assert.equal(costDelta({ cost: 0.8 }, { cost: 1 }).toFixed(2), '-0.20');
  assert.equal(costDelta(undefined, { cost: 1 }), null);
  assert.equal(costDelta({ cost: 1 }, { cost: 0 }), null);
});

test('cases: every proxy_cmd case has a stored oracle output that covers its must regexes (offline proxy)', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const all = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8')).cases;
  const withProxy = all.filter((c) => c.proxy_cmd);
  assert.deepEqual(withProxy.map((c) => c.id.split('-')[0]), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']);
  for (const c of withProxy) {
    const f = new URL(`./${oracleFile(c.id)}`, import.meta.url);
    assert.ok(existsSync(f), `${c.id}: ${oracleFile(c.id)} missing`);
    const text = readFileSync(f, 'utf8');
    const miss = c.must.filter((re) => !new RegExp(re, 'i').test(text));
    assert.deepEqual(miss, [], `${c.id}: stored output misses ${miss.join(', ')}`);
  }
  for (const c of all.filter((x) => x.kind === 'deep')) {
    for (const k of ['expected', 'why_grep_expensive', 'proxy', 'proxy_cmd', 'must', 'skills']) assert.ok(c[k] && c[k].length, `${c.id}: ${k}`);
  }
});

// Real run.mjs invocations, $0: every one passes --dry and exits before any workspace setup or claude
// call (option/plan errors and --rerun refusals are checked first). runs.json fixtures live in a
// fresh mkdtemp dir under $TMPDIR.
test('run.mjs (real, --dry, exits before setup): rerun refusals, empty plans, oracle file check', async () => {
  const { mkdtempSync, writeFileSync, rmSync, readdirSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { spawnSync } = await import('node:child_process');
  const runMjs = fileURLToPath(new URL('./run.mjs', import.meta.url));
  const resultsDir = fileURLToPath(new URL('./results', import.meta.url));
  const before = existsSync(resultsDir) ? readdirSync(resultsDir).length : 0;
  const run = (...a) => spawnSync('node', [runMjs, '--dry', ...a], { encoding: 'utf8', timeout: 30000 });
  const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'bench-rerun-'));
  const prevDir = (rows, meta = {}) => {
    const d = mkdtempSync(join(root, 'r-'));
    const planned = [{ case: 'm1-impact-readallprojecttags', arm: 'nograph', run: 1 }, { case: 'm1-impact-readallprojecttags', arm: 'oracle', run: 1 }];
    writeFileSync(join(d, 'runs.json'), JSON.stringify({ meta: { model: 'claude-opus-5-5', budget: 7, 'run-budget': 0.75, ...meta }, planned, rows, spent: 1, stop: null }));
    return d;
  };
  const m = { cost: 0.2, counts: {}, graphCalls: [] };
  const r0 = (arm, status, problems = []) => ({ case: 'm1-impact-readallprojecttags', arm, run: 1, m, problems, status, sc: { hits: 1, of: 1 } });
  try {
    let r = run('--rerun', prevDir([r0('nograph', 'invalid', ['a']), r0('oracle', 'invalid', ['b'])]));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /has 2 invalid runs \(not usage limits\)/);

    r = run('--rerun', prevDir([r0('nograph', 'valid'), r0('oracle', 'valid')]));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /nothing to rerun/);

    // one invalid + one valid: nothing left to rerun (an invalid run is a result, not rerun)
    r = run('--rerun', prevDir([r0('nograph', 'invalid', ['a']), r0('oracle', 'valid')]));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /nothing to rerun/);

    r = run('--rerun', prevDir([r0('nograph', 'usage-limit')]), '--model', 'claude-sonnet-x');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--model claude-sonnet-x differs/);

    r = run('--rerun', join(root, 'nope'));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no runs\.json/);

    r = run('--arms', 'nograph,grpah');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown arm\(s\): grpah/);

    r = run('--group', 'maestro', '--arms', 'graph', '--graph-cases', 'nomatch');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /the plan is empty/);

    // the fixture case has no proxy_cmd, so no stored oracle output: refused before any setup
    r = run('--only', 'movetask', '--arms', 'oracle');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /oracle arm needs oracle\/02-impact-movetask\.txt/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.equal(existsSync(resultsDir) ? readdirSync(resultsDir).length : 0, before, 'dry runs write no results dir');
});

test('run.mjs: rerun, arms and graph-cases options; stop rules for usage limit and >1 invalid', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./run.mjs', import.meta.url), 'utf8');
  for (const o of ["arms: DEFAULT_ARMS", "'graph-cases': ''", "rerun: ''"]) assert.ok(src.includes(o), o);
  assert.match(src, /status === 'usage-limit'\) \{ stop =/);
  assert.match(src, /statusOf\(x\) === 'invalid'\)\.length > 1\) \{ stop =/);
  assert.match(src, /budgetStop\(spent, opts\['run-budget'\], BUDGET\)/);
});

// --- 042: skills and noskills arms ---

const SKILL_MD = (meta, body = '# x\n') => `---\nname: demo\ndescription: "d"\n${meta}---\n\n${body}`;
const ROOT_CONCEPTS = ['task-queue', 'installing-maestro'];

test('isConceptSkillMd: the metadata.type marker in the frontmatter only', () => {
  assert.equal(isConceptSkillMd(SKILL_MD('metadata:\n  type: concept-skill\n  version: "2.4"\n')), true);
  assert.equal(isConceptSkillMd(SKILL_MD('metadata:\n  version: "1"\n  type: "concept-skill"\n')), true);
  assert.equal(isConceptSkillMd(SKILL_MD("metadata:\n\n    type: 'concept-skill' # marker\n")), true);
  assert.equal(isConceptSkillMd(SKILL_MD('metadata: { version: 1, type: concept-skill }\n')), true);
  assert.equal(isConceptSkillMd('﻿' + SKILL_MD('metadata:\n  type: concept-skill\n')), true, 'BOM');
  assert.equal(isConceptSkillMd(SKILL_MD('metadata:\n  type: concept-skill\n').replace(/\n/g, '\r\n')), true, 'CRLF');
  // not the marker
  assert.equal(isConceptSkillMd(SKILL_MD('')), false, 'no metadata');
  assert.equal(isConceptSkillMd(SKILL_MD('allowed-tools: Bash(node x.cjs)\n')), false);
  assert.equal(isConceptSkillMd(SKILL_MD('metadata:\n  type: workflow-skill\n')), false);
  assert.equal(isConceptSkillMd(SKILL_MD('metadata:\n  type: concept-skill-draft\n')), false);
  assert.equal(isConceptSkillMd(SKILL_MD('type: concept-skill\n')), false, 'top-level type is not metadata.type');
  assert.equal(isConceptSkillMd(SKILL_MD('metadata:\n  version: "1"\ntype: concept-skill\n')), false, 'metadata block ended before it');
  assert.equal(isConceptSkillMd(SKILL_MD('', 'metadata:\n  type: concept-skill\n')), false, 'in the body, not the frontmatter');
  assert.equal(isConceptSkillMd('metadata:\n  type: concept-skill\n'), false, 'no frontmatter');
  for (const x of ['', undefined, null, '---\n']) assert.equal(isConceptSkillMd(x), false, String(x));
});

test('skillNameOf: frontmatter name, else the fallback', () => {
  assert.equal(skillNameOf(SKILL_MD('')), 'demo');
  assert.equal(skillNameOf('---\nname: "test-maestro-desktop"\n---\n', 'test-maestro'), 'test-maestro-desktop');
  assert.equal(skillNameOf('---\ndescription: x\n---\n', 'dir-name'), 'dir-name');
  assert.equal(skillNameOf('no frontmatter', 'dir-name'), 'dir-name');
});

test('skill arms: setup, flags and arm order', () => {
  assert.equal(setupArm('skills'), 'nograph', 'skills = the nograph workspace as is');
  assert.equal(setupArm('noskills'), 'noskills');
  assert.deepEqual(parseArms('noskills,skills'), ['skills', 'noskills']);
  assert.deepEqual(parseArms('graph,noskills,nograph'), ['nograph', 'graph', 'noskills']);
  const o = { model: 'm', runBudget: 0.5, pluginDir: '/p' };
  for (const arm of ['skills', 'noskills']) assert.deepEqual(claudeArgs(arm, 'Q', o), claudeArgs('nograph', 'Q', o), `${arm}: nograph flags, no --plugin-dir`);
  assert.equal(promptFor('skills', { question: 'Q?' }, 'OUT'), 'Q?');
  assert.equal(promptFor('noskills', { question: 'Q?' }, 'OUT'), 'Q?');
});

// Builds a fake workspace under $TMPDIR (never in the repo), outside any git work tree.
async function fakeWorkspace() {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'bench-strip-'));
  const skill = (dir, md) => { mkdirSync(join(root, dir), { recursive: true }); writeFileSync(join(root, dir, 'SKILL.md'), md); };
  const concept = (name) => `---\nname: ${name}\ndescription: "x"\nmetadata:\n  type: concept-skill\n  version: "1"\n---\n# ${name}\n`;
  skill('.claude/skills/task-queue', concept('task-queue'));
  mkdirSync(join(root, '.claude/skills/task-queue/sub-concepts'));
  writeFileSync(join(root, '.claude/skills/task-queue/sub-concepts/a.md'), 'x');
  skill('.claude/skills/maestro', '---\nname: maestro\ndescription: "orchestrator"\nallowed-tools: Bash(node x)\n---\n# M\n');
  skill('apps/app/.claude/skills/global-stores', concept('global-stores'));
  skill('apps/app/.claude/skills/test-maestro', '---\nname: test-maestro-desktop\ndescription: "y"\n---\n');
  skill('node_modules/pkg/.claude/skills/vendored', concept('vendored'));
  skill('plugins/p/skills/published', concept('published')); // not under .claude: not a project skill dir
  mkdirSync(join(root, '.claude/skills/no-skill-md'), { recursive: true });
  return root;
}

test('stripConceptSkills: removes concept skills in every .claude/skills, keeps the rest', async () => {
  const { existsSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = await fakeWorkspace();
  try {
    assert.deepEqual(listSkills(root).map((s) => `${s.name}:${s.concept}`), ['maestro:false', 'task-queue:true', 'global-stores:true', 'test-maestro-desktop:false']);
    const r = stripConceptSkills(root);
    assert.deepEqual(r.removed, [{ rel: '.claude/skills/task-queue', name: 'task-queue' }, { rel: 'apps/app/.claude/skills/global-stores', name: 'global-stores' }]);
    assert.deepEqual(r.kept.map((s) => s.name), ['maestro', 'test-maestro-desktop']);
    assert.equal(existsSync(join(root, '.claude/skills/task-queue')), false, 'whole dir, sub-concepts included');
    assert.equal(existsSync(join(root, 'apps/app/.claude/skills/global-stores')), false);
    for (const kept of ['.claude/skills/maestro/SKILL.md', 'apps/app/.claude/skills/test-maestro/SKILL.md', 'node_modules/pkg/.claude/skills/vendored/SKILL.md', 'plugins/p/skills/published/SKILL.md', '.claude/skills/no-skill-md']) {
      assert.ok(existsSync(join(root, kept)), kept);
    }
    assert.deepEqual(stripConceptSkills(root).removed, [], 'idempotent');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('strip-concept-skills.mjs CLI: JSON on success, exit 1 with nothing to strip, exit 2 on a git work tree or no dir', async () => {
  const { mkdtempSync, rmSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { spawnSync } = await import('node:child_process');
  const cli = fileURLToPath(new URL('./strip-concept-skills.mjs', import.meta.url));
  const env = { ...process.env };
  delete env.GIT_DIR; delete env.GIT_WORK_TREE;
  const run = (dir) => spawnSync('node', [cli, ...(dir ? [dir] : [])], { env, encoding: 'utf8' });
  const root = await fakeWorkspace();
  const other = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'bench-strip-git-'));
  try {
    let r = run(root);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).removed.map((s) => s.name), ['task-queue', 'global-stores']);
    r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no concept skill found/);

    assert.equal(spawnSync('git', ['init', '-q', other], { env }).status, 0);
    r = run(other);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /inside a git work tree/);

    r = run(join(root, 'nope'));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not a directory/);
    assert.equal(run().status, 2);
    assert.ok(existsSync(join(root, '.claude/skills/maestro/SKILL.md')));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test('maestro-setup.sh: noskills strips concept skills from the nograph workspace; other arms do not', async () => {
  const { readFileSync } = await import('node:fs');
  const s = readFileSync(new URL('./maestro-setup.sh', import.meta.url), 'utf8');
  const elseBranch = s.slice(s.indexOf('\nelse\n'));
  assert.ok(elseBranch.indexOf('rm -rf scribe-output') < elseBranch.indexOf('strip-concept-skills.mjs'), 'noskills = nograph workspace, then strip');
  assert.match(elseBranch, /if \[ "\$arm" = noskills \]; then\n\s*node "\$repo\/bench\/strip-concept-skills\.mjs" \./);
  assert.equal((s.match(/strip-concept-skills\.mjs/g) || []).length, 2, 'one call, plus the header comment');
});

test('parseStream: Skill calls are recorded by name', () => {
  const sk = (id, input) => ({ type: 'assistant', message: { id: 'm' + id, content: [{ type: 'tool_use', id, name: 'Skill', input }] } });
  const m = parseStream(J(init([]), sk('a', { skill: 'installing-maestro' }), sk('b', { skill: '/task-queue', args: 'x' }), sk('c', {}), tool('d', 'Skill'), done()));
  assert.deepEqual(m.skillCalls, ['installing-maestro', 'task-queue']);
  assert.equal(m.counts.Skill, 4);
});

test('validity: concept skills only in the skills arm, none in noskills, code-graph in neither', () => {
  const keep = { keepSkills: ['maestro'] };
  const withSkills = parseStream(J(init([], ['maestro', ...ROOT_CONCEPTS, 'update-config']), done()));
  const stripped = parseStream(J(init([], ['maestro', 'update-config']), done()));
  assert.deepEqual(validity('skills', withSkills, ROOT_CONCEPTS, keep), []);
  assert.deepEqual(validity('noskills', stripped, ROOT_CONCEPTS, keep), []);
  // concept skills in the wrong arm
  assert.ok(validity('noskills', withSkills, ROOT_CONCEPTS, keep).some((p) => /concept skill\(s\) in the noskills arm: task-queue, installing-maestro/.test(p)));
  assert.ok(validity('skills', stripped, ROOT_CONCEPTS, keep).some((p) => /init does not load project skill\(s\): task-queue, installing-maestro/.test(p)));
  const partial = parseStream(J(init([], ['maestro', 'plugin:task-queue']), done()));
  assert.ok(validity('noskills', partial, ROOT_CONCEPTS, keep).some((p) => /noskills arm: task-queue \(not stripped\)/.test(p)), 'namespaced name counts');
  // .claude/skills dropped wholesale: the kept non-concept skill is gone too
  const empty = parseStream(J(init([], []), done()));
  assert.ok(validity('noskills', empty, ROOT_CONCEPTS, keep).some((p) => /non-concept project skill\(s\) in the noskills arm: maestro/.test(p)));
  assert.ok(validity('skills', parseStream(J(init([], ROOT_CONCEPTS), done())), ROOT_CONCEPTS, keep).some((p) => /skills arm: maestro/.test(p)));
  assert.deepEqual(validity('nograph', parseStream(J(init([], ROOT_CONCEPTS), done())), ROOT_CONCEPTS, keep), [], 'keepSkills is a skill-arm check only');
  // code-graph in neither arm
  for (const arm of ['skills', 'noskills']) {
    const cgPlugin = parseStream(J(init(CG, arm === 'skills' ? ['maestro', ...ROOT_CONCEPTS] : ['maestro']), done()));
    assert.ok(validity(arm, cgPlugin, ROOT_CONCEPTS, keep).some((p) => p === `init shows code-graph in the ${arm} arm (config leak)`), arm);
    const cgSkill = parseStream(J(init([], ['maestro', 'code-graph:graph', ...(arm === 'skills' ? ROOT_CONCEPTS : [])]), done()));
    assert.ok(validity(arm, cgSkill, ROOT_CONCEPTS, keep).some((p) => /config leak/.test(p)), `${arm}: code-graph skill`);
  }
  // a Skill call to a concept skill: invalid in noskills only
  const sk = (input) => ({ type: 'assistant', message: { id: 'ms', content: [{ type: 'tool_use', id: 's', name: 'Skill', input }] } });
  const calledIn = (list) => parseStream(J(init([], list), sk({ skill: 'task-queue' }), done()));
  assert.ok(validity('noskills', calledIn(['maestro']), ROOT_CONCEPTS, keep).some((p) => /Skill call to concept skill\(s\) in the noskills arm: task-queue/.test(p)));
  assert.deepEqual(validity('skills', calledIn(['maestro', ...ROOT_CONCEPTS]), ROOT_CONCEPTS, keep), []);
  assert.deepEqual(validity('noskills', parseStream(J(init([], ['maestro']), sk({ skill: 'maestro' }), done())), ROOT_CONCEPTS, keep), [], 'a non-concept Skill call is fine');
});

test('coveringLoads and the skills-vs-noskills report section', () => {
  const at = (cost, skillCalls = []) => ({ ...parseStream(J(init([]), done({ total_cost_usd: cost }))), skillCalls });
  const rows = [
    crow('s1', 'skills', 1, at(0.2, ['maestro-architecture']), 'valid'), crow('s1', 'noskills', 1, at(0.4), 'valid'),
    crow('s1', 'skills', 2, at(0.2, ['task-queue']), 'valid'), crow('s1', 'noskills', 2, at(0.4), 'valid'),
    crow('s1', 'skills', 3, at(9, ['maestro-architecture']), 'invalid'),
    crow('m4', 'skills', 1, at(0.3, ['plugin:installing-maestro']), 'valid'), crow('m4', 'noskills', 1, at(0.3), 'usage-limit'),
  ];
  const covering = { s1: ['maestro-architecture'], m4: ['installing-maestro'] };
  const l = coveringLoads(rows, covering);
  assert.deepEqual(l.get('s1'), { runs: 2, loaded: 1, skills: ['maestro-architecture'] }, 'invalid run not counted');
  assert.deepEqual(l.get('m4'), { runs: 1, loaded: 1, skills: ['installing-maestro'] });
  assert.equal(coveringLoads(rows, {}).size, 0);
  const md = report(rows, { model: 'm', spent: 2, budget: 7, kinds: { s1: 'concept', m4: 'cross' }, covering, skillsBiasNote: true });
  assert.match(md, /## skills vs noskills per case/);
  assert.match(md, /\| s1 \| 0\.400 \(2\) \| 0\.800 \(2\) \| -50% \| 2\/2 \| 2\/2 \| 1\/2 \(maestro-architecture\) \|/);
  assert.match(md, /\| m4 \| 0\.300 \(1\) \| n\/a \| n\/a \| 1\/1 \| n\/a \| 1\/1 \(installing-maestro\) \|/);
  assert.match(md, /\| concept \| n\/a \| n\/a \| -50% \|/, 'group delta column');
  assert.match(md, /\| s1 \| skills \| 1 \| yes \|[^\n]*\| maestro-architecture \| 1\/1 \|/, 'per-run skills loaded column');
  assert.ok(md.includes(SKILLS_BIAS_NOTE));
  assert.doesNotMatch(md, /favour the graph/);
  assert.doesNotMatch(report([crow('a', 'nograph', 1, at(0.1), 'valid')], { model: 'm', spent: 0, budget: 1 }), /skills vs noskills per case/);
});

test('checkVerdict: a skills/noskills plan needs no graph call', () => {
  const planned = [{ case: 's1', arm: 'skills', run: 1 }, { case: 's1', arm: 'noskills', run: 1 }];
  const ok = parseStream(J(init([]), done()));
  const rows = [crow('s1', 'skills', 1, ok, 'valid'), crow('s1', 'noskills', 1, ok, 'valid')];
  assert.equal(checkVerdict(rows, { planned, needGraphCall: false }).pass, true);
  assert.equal(checkVerdict(rows.slice(0, 1), { planned, needGraphCall: false }).pass, false);
});

test('selectCases --set and proposals', () => {
  const cs = [{ id: 'm2', sets: ['042'] }, { id: 'm3' }, { id: 's1', sets: ['042', 'x'], proposal: 'p' }];
  assert.deepEqual(selectCases(cs, { set: '042' }).map((c) => c.id), ['m2', 's1']);
  assert.deepEqual(selectCases(cs, { set: '04' }).map((c) => c.id), [], 'exact set name, not a substring');
  assert.deepEqual(selectCases(cs, { set: '042', only: 's' }).map((c) => c.id), ['s1']);
  assert.deepEqual(proposals(cs).map((c) => c.id), ['s1']);
});

test('cases: the 042 set is 5 or 6 maestro questions, m4 included, each grounded and self-consistent', async () => {
  const { readFileSync } = await import('node:fs');
  const all = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8')).cases;
  const set = selectCases(all, { set: '042' });
  assert.ok(set.length >= 5 && set.length <= 6, `${set.length} cases`);
  const old = set.filter((c) => /^m[1-5]-/.test(c.id));
  const fresh = set.filter((c) => !/^m\d-/.test(c.id));
  assert.ok(old.length >= 2 && old.length <= 3, 'two or three from m1 to m5');
  assert.ok(old.some((c) => c.id.startsWith('m4-')), 'm4 included');
  assert.equal(fresh.length, 3);
  for (const c of set) {
    assert.equal(c.group, 'maestro@3814a30', c.id);
    assert.match(c.setup, /maestro-setup\.sh .* 3814a30 \{ARM\}$/, c.id);
    for (const k of ['skills', 'keep_skills', 'covering_skills', 'must', 'expected', 'skill_note']) assert.ok(c[k] && c[k].length, `${c.id}: ${k}`);
    assert.ok(!c.skills.some((s) => c.keep_skills.includes(s)), `${c.id}: a kept skill cannot be a concept skill`);
    for (const re of c.must) assert.doesNotThrow(() => new RegExp(re, 'i'), `${c.id}: ${re}`);
    const miss = c.must.filter((re) => !new RegExp(re, 'i').test(c.expected));
    assert.deepEqual(miss, [], `${c.id}: the expected answer misses its own must regexes`);
    assert.ok(c.covering_skills.some((s) => c.skill_note.includes(s)), `${c.id}: the note names the covering skill`);
  }
  // The user approved the 042 set (m2, m4, s1, s2, s3): no case anywhere is still a proposal,
  // so run.mjs will not refuse it. A new proposal must fail here until it is approved too.
  assert.deepEqual(set.map((c) => c.id.split('-')[0]), ['m2', 'm4', 's1', 's2', 's3'], 'the approved set');
  assert.deepEqual(proposals(all).map((c) => c.id), [], 'approved: no proposal field left');
});

test('cases: s3 generation regex accepts correct paraphrases from either arm, rejects answers without the fact', async () => {
  const { readFileSync } = await import('node:fs');
  const s3 = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8')).cases.find((c) => c.id === 's3-concept-task-cascade');
  const re = new RegExp(s3.must[4], 'i');
  const pass = [
    // task-queue skill wording (skills arm)
    'maestro-tasks.cjs is the one plugin lib that is NOT generated from plugin-entries',
    'maestro-tasks.cjs is hand-maintained', 'it is hand written', 'edit both by hand', 'update it manually',
    'maestro-tasks.cjs is **not** generated', 'maestro-tasks.cjs is not **generated**', "it isn't generated", 'it isn’t auto-generated',
    'maestro-tasks.cjs is not auto-generated', 'it is never auto generated',
    'it has no source in plugin-entries', 'there is no plugin-entries source for it',
    // plugin-publishing.md wording (reaches both arms, the noskills arm's source)
    '`plugins/maestro/scripts/lib/*.cjs` (except `maestro-tasks.cjs`) are **generated** from apps/maestro/src/core/plugin-entries',
    'All plugin libs except maestro-tasks.cjs are generated',
    'it is the one exception to the generated libs',
    'maestro-tasks.cjs is excluded from the lib build',
    'the libs come from build:plugin-libs, with maestro-tasks.cjs excepted',
    'maestro-tasks.cjs is exempt from generation',
    'the plugin libs are generated from apps/maestro/src/core/plugin-entries/*.ts, the exception being maestro-tasks.cjs',
  ];
  const fail = [
    'Change buildStatusMap in tasks.ts and plugins/maestro/scripts/lib/maestro-tasks.cjs, then run build:plugin-libs.',
    'maestro-tasks.cjs is generated from tasks.ts by build:plugin-libs.',
    'plugins/maestro/scripts/lib/maestro-tasks.cjs has the same buildStatusMap rule, except it runs in the orchestrator.',
    'The plugin libs are generated. A task is ready except when a blocker is still open.',
    'A task is ready once every blocker is done, except blockers whose file was deleted.',
    'status.json is regenerated on every sync; keep tasks.ts and maestro-tasks.cjs in sync.',
  ];
  for (const s of pass) assert.ok(re.test(s), `should pass: ${s}`);
  for (const s of fail) assert.ok(!re.test(s), `should fail: ${s}`);
  assert.ok(re.test(s3.expected), 'expected answer still matches');
});

test('run.mjs: skill arms need cases with a skills list; proposals are refused before any spend', async () => {
  const { readFileSync, existsSync, readdirSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { spawnSync } = await import('node:child_process');
  const runMjs = fileURLToPath(new URL('./run.mjs', import.meta.url));
  const resultsDir = fileURLToPath(new URL('./results', import.meta.url));
  const before = existsSync(resultsDir) ? readdirSync(resultsDir).length : 0;
  // --dry, refused before any workspace setup: the fixture case has no `skills`
  const r = spawnSync('node', [runMjs, '--dry', '--only', 'movetask', '--arms', 'skills,noskills'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /skills\/noskills arms need cases with a `skills` list; these have none: 02-impact-movetask/);
  const s = spawnSync('node', [runMjs, '--dry', '--set', 'nope'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(s.status, 2);
  assert.match(s.stderr, /--set "nope"/);
  assert.equal(existsSync(resultsDir) ? readdirSync(resultsDir).length : 0, before);
  // Static: the proposal refusal sits after the $0 init check and before the first paid run.
  const src = readFileSync(runMjs, 'utf8');
  const guard = src.indexOf('if (!DRY && pending.length) die(');
  assert.ok(guard > src.indexOf("if (bool.has('init-check'))"), 'after the init check');
  assert.ok(guard < src.indexOf('for (const p of plan)'), 'before the run loop');
  assert.ok(guard < src.indexOf('if (!DRY) mkdirSync(outDir'), 'before the results dir');
  assert.match(src, /validity\(arm, m, c\.skills \|\| \[\], \{ keepSkills: c\.keep_skills \|\| \[\] \}\)/);
  assert.equal((src.match(/keepSkills: c\.keep_skills/g) || []).length, 2, 'init check and paid runs');
});
