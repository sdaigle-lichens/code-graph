// node --test bench/lib.test.mjs : validity, metrics and report logic on synthetic stream-json transcripts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStream, validity, report, checkVerdict, score, claudeArgs, isCg, selectCases, parseArms, oraclePrompt, promptFor,
  planRuns, budgetStop, runStatus, rerunPlan, setupArm, oracleFile, sums, costDelta, ORACLE_HEADER,
  isConceptSkillMd, skillNameOf, coveringLoads, proposals, SKILLS_BIAS_NOTE, isReadOnly,
  MODEL_ARMS, ARMS, baseArm, modelFor, isGraphArm, isOracleArm, promptProblems, isEditCase, agentBody, replaceOnce, nodeTestSummary, isGreen,
  gradeTestRun, gradeDocs, editCaseProblems, editSection, FLAGS, editErrorHead, EDIT_TOOLS,
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
    const m = parseStream(J(init(arm === 'graph' ? CG : []), bash('e', 'pnpm build'), res('e', 'Exit code 2\nbuild failed', true), done()));
    assert.ok(validity(arm, m).some((p) => /Bash failure/.test(p)), arm);
  }
});

test('043: failing read-only grep/sed/rg/cat/head/tail/ls/find is recorded, not invalidating, alone or chained', () => {
  const cmds = [
    ['grep -rn foo src', 1], ['rg foo', 1], ['sed -n "5,9p" a.ts', 1], ['cat nope.ts', 1], ['head -5 nope', 1],
    ['tail -5 nope', 1], ['ls /nope', 2], ['find . -name x.ts -type f', 1],
    ['grep -n a f && sed -n "1p" f | head -3', 1], ['ls src; grep x src 2>/dev/null', 1], ['grep a f 2>&1 | tail -5', 1],
    ['/usr/bin/grep "a && b" f', 1], ["grep 'a;b' f || cat f", 1],
  ];
  for (const [cmd, code] of cmds) {
    for (const arm of ['graph', 'nograph']) {
      const m = parseStream(J(init(arm === 'graph' ? CG : []), bash('e', cmd), res('e', `Exit code ${code}\nout`, true), done()));
      assert.deepEqual(validity(arm, m), [], cmd);
      assert.equal(m.readOnlyFailures.length, 1, cmd);
      assert.equal(m.bashFailures.length, 0, cmd);
    }
  }
});

test('043: seccomp, other commands, writes, and code-graph exits outside 0/4/6/7 still invalidate', () => {
  const bad = [
    ['grep a f', 'Exit code 1\napply-seccomp: boom'],
    ['pnpm build', 'Exit code 1\nx'],
    ['grep a f && pnpm build', 'Exit code 1\nx'],
    ['grep a f || echo none', 'Exit code 1\nx'],
    ['cd src && grep a f', 'Exit code 1\nx'],
    ['grep a f > out.txt', 'Exit code 1\nx'],
    ['sed -i s/a/b/ f', 'Exit code 1\nx'],
    ['find . -delete', 'Exit code 1\nx'],
    ['cat $(echo f)', 'Exit code 1\nx'],
    [`grep a f | ${CMD}`, 'Exit code 1\nx'],
    [`${CMD} | head -3`, 'Exit code 1\nx'],
    [CMD, 'Exit code 2\nx'],
  ];
  for (const [cmd, out] of bad) {
    const m = parseStream(J(init(CG), bash('e', cmd), res('e', out, true), done()));
    assert.ok(validity('graph', m).length > 0, cmd);
    assert.equal(m.readOnlyFailures.length, 0, cmd);
  }
});

test('043: isReadOnly edge cases: quoted separators, redirects, sed -i variants, find actions, env prefix', () => {
  const yes = [
    "grep 'a;b' f", 'grep "a|b" f', 'grep a f 2>&1', 'grep a f 2>/dev/null', 'sed -n 1p f', 'find . -name x',
    '/usr/bin/grep a f', 'grep a f && ls', 'grep a f 2>&1 | head',
  ];
  const no = [
    'grep a f >> out', 'cat f | tee x', 'sed -ni p f', 'sed -E -i p f', 'sed -n p -i f', 'sed -ibak p f',
    'sed --in-place p f', 'find . -exec rm {} ;', 'find . -execdir rm {} +', 'find . -fprint o', 'cat <f',
    'grep "$(x)" f', 'grep a f; rm x', 'FOO=1 grep a f', 'ls | xargs rm', '',
  ];
  for (const c of yes) assert.equal(isReadOnly(c), true, c);
  for (const c of no) assert.equal(isReadOnly(c), false, c);
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
  assert.deepEqual(g.map((i) => i.split('-')[0]), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 's1', 's2', 's3', 't1', 't2', 'd1', 'd2', 't3', 't4', 'd3', 'd4']);
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
  assert.equal(m.readOnlyFailures.length, 1); // a read-only grep miss (043): recorded, not invalidating
  const m2 = parseStream(J(init(CG), bash('e', 'echo code-graph'), res('e', 'Exit code 1\n', true), done()));
  assert.deepEqual(m2.graphCalls, []);
  assert.ok(validity('graph', m2).some((p) => /Bash failure/.test(p)));
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
  const bad = parseStream(J(init([]), bash('e', 'pnpm build'), res('e', 'Exit code 2\nno', true), done()));
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
  const withProxy = all.filter((c) => c.proxy_cmd && !isEditCase(c));
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
  // The user approved the 042 set (m2, m4, s1, s2, s3) and the 044 set (t1, t2, d1, d2): none of them is
  // a proposal, so run.mjs will not refuse them. Any new proposal must be added to this test explicitly.
  assert.deepEqual(set.map((c) => c.id.split('-')[0]), ['m2', 'm4', 's1', 's2', 's3'], 'the approved set');
  assert.deepEqual(proposals(set), [], '042: no proposal field');
  assert.deepEqual(proposals(all).map((c) => c.id), [], 'no case awaits approval');
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
  assert.match(src, /validity\(arm, m, c\.skills \|\| \[\], \{ keepSkills: c\.keep_skills \|\| \[\], edit: isEditCase\(c\) \}\)/);
  assert.equal((src.match(/keepSkills: c\.keep_skills/g) || []).length, 2, 'init check and paid runs');
});

// --- 044: model arms and edit cases ---

test('model arms: base arm, own model, setup and arm order', () => {
  assert.deepEqual(Object.keys(MODEL_ARMS), ['haiku-nograph', 'haiku-graph', 'sonnet-nograph', 'haiku-noskills', 'haiku-oracle']);
  assert.deepEqual(ARMS.slice(-5), ['haiku-nograph', 'haiku-graph', 'sonnet-nograph', 'haiku-noskills', 'haiku-oracle']);
  assert.deepEqual(parseArms('sonnet-nograph,haiku-graph,haiku-nograph,nograph'), ['nograph', 'haiku-nograph', 'haiku-graph', 'sonnet-nograph']);
  assert.equal(baseArm('haiku-graph'), 'graph');
  assert.equal(baseArm('sonnet-nograph'), 'nograph');
  assert.equal(baseArm('oracle'), 'oracle');
  assert.equal(modelFor('haiku-nograph', 'claude-opus-5-5'), 'claude-haiku-5-5');
  assert.equal(modelFor('sonnet-nograph', 'claude-opus-5-5'), 'claude-sonnet-5-5');
  assert.equal(modelFor('graph', 'claude-opus-5-5'), 'claude-opus-5-5', '--model still sets the other arms');
  assert.deepEqual(['graph', 'haiku-graph', 'nograph', 'haiku-nograph', 'sonnet-nograph', 'oracle'].map(isGraphArm), [true, true, false, false, false, false]);
  assert.deepEqual(['haiku-graph', 'haiku-nograph', 'sonnet-nograph', 'noskills', 'skills'].map(setupArm), ['graph', 'nograph', 'nograph', 'noskills', 'nograph']);
});

test('claudeArgs: per-arm model, --plugin-dir only on graph-based arms, edit tools and system prompt only when asked', () => {
  const val = (a, flag) => a[a.indexOf(flag) + 1];
  const o = { model: 'claude-opus-5-5', runBudget: '0.75', pluginDir: '/p' };
  const hg = claudeArgs('haiku-graph', 'q', o);
  assert.equal(val(hg, FLAGS.model), 'claude-haiku-5-5');
  assert.equal(val(hg, FLAGS.pluginDir), '/p');
  const hn = claudeArgs('haiku-nograph', 'q', o);
  assert.equal(val(hn, FLAGS.model), 'claude-haiku-5-5');
  assert.ok(!hn.includes(FLAGS.pluginDir));
  assert.equal(val(claudeArgs('sonnet-nograph', 'q', o), FLAGS.model), 'claude-sonnet-5-5');
  assert.equal(val(claudeArgs('nograph', 'q', o), FLAGS.model), 'claude-opus-5-5');
  assert.equal(val(hn, FLAGS.allowedTools), 'Bash,Read,Grep,Glob,Skill');
  assert.ok(!hn.includes(FLAGS.appendSystemPrompt));
  const e = claudeArgs('haiku-nograph', 'q', { ...o, edit: true, systemPrompt: '# Test Agent\nbody' });
  assert.equal(val(e, FLAGS.allowedTools), 'Bash,Read,Grep,Glob,Skill,Edit,Write');
  assert.equal(val(e, FLAGS.permissionMode), 'bypassPermissions', 'edit cases: dontAsk refuses protected .claude/ paths');
  assert.equal(val(e, FLAGS.tools), 'Bash,Read,Grep,Glob,Skill,Edit,Write', 'edit cases: --tools limits what bypass allows');
  assert.equal(val(hn, FLAGS.permissionMode), 'dontAsk', 'read-only cases keep dontAsk');
  assert.ok(!hn.includes(FLAGS.tools), 'read-only cases pass no --tools');
  assert.equal(val(e, FLAGS.appendSystemPrompt), '# Test Agent\nbody');
  assert.equal(val(e, FLAGS.print), 'q', 'the prompt is still the -p value');
});

test('validity: model arms are checked as their base arm', () => {
  const g = parseStream(J(init(CG), bash('e', CMD), res('e', 'out'), done()));
  const n = parseStream(J(init([]), done()));
  assert.deepEqual(validity('haiku-graph', g), []);
  assert.ok(validity('haiku-graph', n).some((p) => /does not show the code-graph plugin/.test(p)));
  assert.deepEqual(validity('haiku-nograph', n), []);
  assert.ok(validity('sonnet-nograph', g).some((p) => /code-graph in the no-graph arm/.test(p)));
});

const editUse = (id, name, file_path) => ({ type: 'assistant', message: { id: 'm' + id, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id, name, input: { file_path } }] } });

test('parseStream: Edit/Write counts, every non-zero Bash exit, refused edits', () => {
  const m = parseStream(J(init(), editUse('w', 'Write', '/ws/a.test.ts'), res('w', 'ok'), editUse('e', 'Edit', '/ws/a.test.ts'), res('e', 'ok'),
    bash('b', 'node --test a.test.ts'), res('b', 'Exit code 1\n# fail 2', true), bash('g', 'grep -rn x .'), res('g', 'Exit code 1\n', true), done()));
  assert.deepEqual(m.editCounts, { Edit: 1, Write: 1 });
  assert.deepEqual(m.counts, { Read: 0, Grep: 0, Glob: 0, Bash: 2, Skill: 0 }, 'tool counts unchanged');
  assert.deepEqual(m.bashExits, ['1:node --test a.test.ts', '1:grep -rn x .']);
  assert.deepEqual(m.editDenials, []);
  const d = parseStream(J(init(), editUse('e', 'Edit', '/ws/.claude/skills/x/SKILL.md'), res('e', "Claude requested permissions to edit /ws/.claude/skills/x/SKILL.md, but you haven't granted it yet.", true),
    editUse('f', 'Edit', '/ws/b.md'), res('f', 'String to replace not found in file.', true), done()));
  assert.equal(d.editDenials.length, 1, 'a failed match is the model\'s miss, a permission refusal is the harness\'s');
  assert.match(d.editDenials[0], /^Edit .*SKILL\.md -> Claude requested permissions/);
});

test('validity with edit: Bash failures do not invalidate, seccomp and refused edits do', () => {
  const m = parseStream(J(init([], ['task-queue']), bash('b', 'node --test a.test.ts'), res('b', 'Exit code 1\n', true), done()));
  assert.ok(validity('haiku-nograph', m, ['task-queue']).some((p) => /Bash failure/.test(p)), 'question cases: still invalid');
  assert.deepEqual(validity('haiku-nograph', m, ['task-queue'], { edit: true }), []);
  const s = parseStream(J(init(), bash('b', 'ls'), res('b', 'apply-seccomp: x'), done()));
  assert.ok(validity('nograph', s, [], { edit: true }).some((p) => /apply-seccomp/.test(p)));
  const d = parseStream(J(init(), editUse('e', 'Write', '/ws/x'), res('e', 'Permission to use Write has been denied.', true), done()));
  assert.ok(validity('nograph', d, [], { edit: true }).some((p) => /edit refused by the permission layer/.test(p)));
  // bypassPermissions: the session must list only the allowed tools (else --tools was ignored)
  const withTools = (tools) => parseStream(J({ ...init(), tools }, done()));
  const ok = withTools(['Bash', 'Read', 'Grep', 'Glob', 'Skill', 'Edit', 'Write']);
  assert.deepEqual(validity('haiku-nograph', ok, [], { edit: true }), []);
  const wide = withTools(['Task', 'Bash', 'Read', 'Edit', 'WebFetch']);
  assert.ok(validity('haiku-nograph', wide, [], { edit: true }).some((p) => /beyond the allowed set.*Task, WebFetch/.test(p)));
  assert.deepEqual(validity('nograph', wide, [], {}), [], 'question cases run under dontAsk: extra listed tools are fine');
});

test('planRuns and checkVerdict treat haiku-graph as a graph arm', () => {
  const cs = [{ id: 'a1' }, { id: 'b2' }];
  assert.deepEqual(planRuns(cs, { arms: ['haiku-nograph', 'haiku-graph'], graphCases: ['b2'] }).map((p) => `${p.case} ${p.arm}`), ['a1 haiku-nograph', 'b2 haiku-nograph', 'b2 haiku-graph']);
  const planned = [{ case: 'c', arm: 'haiku-nograph', run: 1 }, { case: 'c', arm: 'haiku-graph', run: 1 }];
  const noCall = parseStream(J(init(CG), done()));
  const rows = [row('haiku-nograph', 1, good('nograph')), row('haiku-graph', 1, noCall)];
  assert.equal(checkVerdict(rows, { planned, needGraphCall: true }).realCall, false);
  assert.equal(checkVerdict([rows[0], row('haiku-graph', 1, good('graph'))], { planned, needGraphCall: true }).pass, true);
});

test('agentBody: frontmatter removed, body kept; an empty body throws', () => {
  assert.equal(agentBody('---\nname: test\nmodel: x\n---\n\n# Test Agent\n\nYou are QA.\n'), '# Test Agent\n\nYou are QA.');
  assert.equal(agentBody('# No frontmatter\n'), '# No frontmatter');
  assert.throws(() => agentBody('---\nname: x\n---\n\n'), /no body/);
});

test('replaceOnce: exactly one occurrence, else it throws', () => {
  assert.equal(replaceOnce('a = 5;\nb = 6;', 'a = 5;', 'a = 3;'), 'a = 3;\nb = 6;');
  assert.equal(replaceOnce('x$&y', '$&', '$1'), 'x$1y', 'no replacement patterns');
  assert.throws(() => replaceOnce('a a', 'a', 'b', 'mutant M1'), /mutant M1: expected exactly one .* found several/);
  assert.throws(() => replaceOnce('abc', 'z', 'b'), /found none/);
  assert.throws(() => replaceOnce('abc', '', 'b'), /found none/);
});

test('nodeTestSummary and isGreen', () => {
  const out = 'TAP version 13\n# tests 5\n# suites 0\n# pass 4\n# fail 1\n# cancelled 0\n';
  assert.deepEqual(nodeTestSummary(out), { pass: 4, fail: 1 });
  const spec = '✔ a (1ms)\n✖ b (1ms)\nℹ tests 2\nℹ suites 0\nℹ pass 1\nℹ fail 1\nℹ cancelled 0\n';
  assert.deepEqual(nodeTestSummary(spec), { pass: 1, fail: 1 }, 'spec reporter summary');
  assert.deepEqual(nodeTestSummary('garbage'), { pass: null, fail: null });
  assert.equal(isGreen({ status: 0, pass: 3, fail: 0 }), true);
  assert.equal(isGreen({ status: 0, pass: 0, fail: 0 }), false, 'no test ran');
  assert.equal(isGreen({ status: 1, pass: 3, fail: 1 }), false);
  assert.equal(isGreen({ status: null, timedOut: true, pass: null, fail: null }), false);
});

test('gradeTestRun: green original plus killed mutants; nothing counts without a green original', () => {
  const green = { status: 0, pass: 5, fail: 0 };
  const red = { status: 1, pass: 4, fail: 1 };
  assert.deepEqual(gradeTestRun({ exists: false, mutants: [{ id: 'M1' }, { id: 'M2' }] }), { hits: 0, of: 3, detail: 'no test file' });
  assert.match(gradeTestRun({ exists: true, original: red, mutants: [{ id: 'M1', ...red }] }).detail, /not green on the original \(exit 1, pass 4, fail 1\)/);
  assert.equal(gradeTestRun({ exists: true, original: red, mutants: [{ id: 'M1', ...red }] }).hits, 0);
  assert.match(gradeTestRun({ exists: true, original: { status: null, timedOut: true }, mutants: [] }).detail, /timed out/);
  const g = gradeTestRun({ exists: true, original: green, mutants: [{ id: 'M1', ...red }, { id: 'M2', ...green }, { id: 'M3', status: null, timedOut: true }] });
  assert.deepEqual([g.hits, g.of], [3, 4]);
  assert.equal(g.detail, 'green (5 pass); killed M1,M3; survived M2');
});

test('gradeDocs: must hits plus must_not misses per file; a missing file scores nothing', () => {
  const spec = { 'a.md': { must: ['30 min'], must_not: ['15 min'] }, 'b.md': { must: ['x', 'y'], must_not: ['old'] } };
  assert.deepEqual(gradeDocs(spec, { 'a.md': 'cap 30 min', 'b.md': 'x y' }), { hits: 5, of: 5, detail: 'all facts right, nothing stale' });
  const g = gradeDocs(spec, { 'a.md': 'cap 30 min (was 15 min)', 'b.md': null });
  assert.deepEqual([g.hits, g.of], [1, 5]);
  assert.equal(g.detail, 'a.md: stale 1/1; b.md: missing');
  assert.equal(gradeDocs(spec, { 'a.md': '15 MIN', 'b.md': '  ' }).hits, 0, 'case-insensitive; blank = missing');
});

test('editCaseProblems: well-formed cases pass, broken ones are named', () => {
  const t = { kind: 'test', agent: 'test', question: 'write t/x.node.test.ts', graph_contribution: 'g', edit: { test: 't/x.node.test.ts', mutants: [{ id: 'M1', file: 'f', from: 'a', to: 'b' }] } };
  assert.deepEqual(editCaseProblems(t), []);
  const s = { kind: 'scribe', agent: 'scribe', question: 'q', graph_contribution: 'g', edit: { plant: [{ file: 'f', from: 'a', to: 'b' }], docs: { 'd.md': { must: ['x'], must_not: ['y'] } } } };
  assert.deepEqual(editCaseProblems(s), []);
  const p = editCaseProblems({ kind: 'test', agent: 'scribe', question: 'q', edit: { test: 'x.test.ts', mutants: [{ id: 'M1', file: 'f', from: 'a', to: 'a' }] } });
  for (const re of [/agent must name/, /graph_contribution/, /\.node\.test\.ts/, /bad mutant/, /name the test file/]) assert.ok(p.some((x) => re.test(x)), String(re));
  const q = editCaseProblems({ kind: 'scribe', agent: 'scribe', question: 'q', graph_contribution: 'g', edit: { docs: { 'd.md': { must: ['x'] } } } });
  assert.ok(q.some((x) => /planted code change/.test(x)) && q.some((x) => /needs must and must_not/.test(x)));
  assert.deepEqual(editCaseProblems({ ...t, kind: 'review', agent: 'review' }).filter((x) => /kind/.test(x)).length, 1);
});

test('report: per-arm models in the header and the edit grading section', () => {
  const m = parseStream(J(init(), editUse('w', 'Write', '/ws/a'), res('w', 'ok'), bash('b', 'node --test a'), res('b', 'Exit code 1\n', true), done()));
  const rows = [
    { case: 't1', arm: 'haiku-nograph', run: 1, m, problems: [], status: 'valid', sc: { hits: 3, of: 5 }, edit: { detail: 'green (5 pass); killed M1|M2; survived M3', restored: ['apps/x.ts'] } },
    { case: 't1', arm: 'sonnet-nograph', run: 1, m, problems: [], status: 'valid', sc: { hits: 5, of: 5 }, edit: { detail: 'green', restored: [] } },
    { case: 'q', arm: 'nograph', run: 1, m, problems: [], status: 'valid', sc: { hits: 1, of: 1 } },
  ];
  const md = report(rows, { model: 'claude-opus-5-5', models: { 'haiku-nograph': 'claude-haiku-5-5', 'sonnet-nograph': 'claude-sonnet-5-5' }, budget: 8, spent: 0.3 });
  assert.match(md, /^# bench report \(haiku-nograph=claude-haiku-5-5, sonnet-nograph=claude-sonnet-5-5, spent/);
  assert.match(md, /## Edit grading \(044\)/);
  assert.match(md, /\| t1 \| haiku-nograph \| 1 \| yes \| 3\/5 \| green \(5 pass\); killed M1\\\|M2; survived M3 \| 0\/1 \| apps\/x\.ts \| 1:node --test a \|/);
  assert.match(md, /\| haiku-nograph \| 1 \| 3\/5 \| 60% \| 0\.100 \| 0\.100 \|/);
  assert.match(md, /\| sonnet-nograph \| 1 \| 5\/5 \| 100% \|/);
  assert.ok(!/\| q \| nograph \| 1 \| yes \| 1\/1 \| -/.test(md.split('## Edit grading')[1]), 'question rows stay out of the edit section');
  assert.match(report(rows.slice(2), { model: 'claude-opus-5-5', models: { nograph: 'claude-opus-5-5' }, budget: 1, spent: 0 }), /^# bench report \(claude-opus-5-5, spent/);
  assert.deepEqual(editSection(rows.slice(2)), []);
});

// The 044 cases: shape, the reference fixtures that bench/edit-check.mjs runs, and paraphrase tests for
// every must / must_not regex of the scribe cases.
const cases044 = async () => {
  const { readFileSync } = await import('node:fs');
  return selectCases(JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8')).cases, { set: '044' });
};

test('cases: the 044 set is two test and two scribe edit cases, well formed, approved (no proposal field)', async () => {
  const { existsSync } = await import('node:fs');
  const set = await cases044();
  assert.deepEqual(set.map((c) => `${c.id} ${c.kind}`), ['t1-test-close-task test', 't2-test-epic-ready test', 'd1-scribe-claim-cap scribe', 'd2-scribe-spawn-cap scribe']);
  for (const c of set) {
    assert.ok(isEditCase(c), c.id);
    assert.deepEqual(editCaseProblems(c), [], c.id);
    assert.equal(c.group, 'maestro@3814a30', c.id);
    assert.match(c.setup, /maestro-setup\.sh .* 3814a30 \{ARM\}$/, c.id);
    assert.ok(c.skills.length, c.id);
    assert.equal(c.proposal, undefined, `${c.id}: approved by the user, so run.mjs must not refuse it`);
    const ref = c.kind === 'test' ? `./edit/ref/${c.id}.test.ts` : `./edit/ref/${c.id}.json`;
    assert.ok(existsSync(new URL(ref, import.meta.url)), `${c.id}: ${ref}`);
    if (c.kind === 'test') {
      assert.equal(c.edit.mutants.length, 4, c.id);
      assert.ok(c.question.includes(`node --import ./.bench/ts-resolve.mjs --test ${c.edit.test}`), `${c.id}: the prompt gives the run command`);
      assert.ok(c.edit.protect.includes('apps/maestro/src'), `${c.id}: application code is protected`);
    } else {
      for (const p of c.edit.plant) assert.ok(c.edit.protect.some((d) => p.file.startsWith(d)), `${c.id}: the plant in ${p.file} is protected`);
      for (const [f, d] of Object.entries(c.edit.docs)) for (const re of [...d.must, ...d.must_not]) assert.doesNotThrow(() => new RegExp(re, 'i'), `${f}: ${re}`);
    }
  }
});

test('cases: d1 regexes accept correct paraphrases of the 30-minute cap and catch only the stale wording', async () => {
  const d1 = (await cases044()).find((c) => c.id === 'd1-scribe-claim-cap').edit.docs;
  const re = (s) => new RegExp(s, 'i');
  const must = [...new Set(Object.values(d1).flatMap((d) => d.must))];
  assert.equal(must.length, 1, 'one 30-minute regex, shared by the three docs');
  for (const s of ['`CLAIM_IDLE_CAP_MS` (30 minutes, named beside', '(30 min)', 'The 30-minute rule', '**30 min**', 'thirty minutes', 'half an hour', '`30 * 60 * 1000`', 'idle for 30 mins'])
    assert.ok(re(must[0]).test(s), `must accept: ${s}`);
  for (const s of ['(15 minutes,', '300 minutes', '130 min', '3 min', '30 seconds']) assert.ok(!re(must[0]).test(s), `must reject: ${s}`);
  const claims = re(d1['.claude/skills/task-queue/sub-concepts/task-claims.md'].must_not[0]);
  for (const s of ['`CLAIM_IDLE_CAP_MS` (15 minutes, named', '`CLAIM_IDLE_CAP_MS` (15 min)', 'CLAIM_IDLE_CAP_MS (15-minute)']) assert.ok(claims.test(s), `stale: ${s}`);
  for (const s of ['`CLAIM_IDLE_CAP_MS` (30 minutes; it was 15 minutes)', '`CLAIM_IDLE_CAP_MS` (30 min)', 'raised from 15 min to 30 min']) assert.ok(!claims.test(s), `not stale: ${s}`);
  const [bold, rule, live] = d1['apps/maestro/.claude/skills/log-view/SKILL.md'].must_not.map(re);
  assert.ok(bold.test('| **15 min** (`SESSION_DELETE_IDLE_CAP_MS` = `CLAIM_IDLE_CAP_MS`) |'));
  assert.ok(!bold.test('| **30 min** (`SESSION_DELETE_IDLE_CAP_MS` = `CLAIM_IDLE_CAP_MS`, was 15 min) |'));
  assert.ok(rule.test('**Confirm before deleting.** The 15-minute rule cannot tell'));
  assert.ok(!rule.test('The 30-minute rule (it was a 15-minute rule) cannot tell'));
  assert.ok(live.test('(a live claim is within 15 min, inside both windows)'));
  assert.ok(!live.test('(a live claim is within 30 min, inside both windows)'));
});

test('cases: d2 regexes accept correct paraphrases of the new default of 3 and catch only the stale wording', async () => {
  const d2 = (await cases044()).find((c) => c.id === 'd2-scribe-spawn-cap').edit.docs;
  const re = (s) => new RegExp(s, 'i');
  const ok = (r, yes, no) => { for (const s of yes) assert.ok(r.test(s), `accept: ${s}`); for (const s of no) assert.ok(!r.test(s), `reject: ${s}`); };
  const epics = d2['.claude/skills/task-queue/sub-concepts/epics.md'];
  ok(re(epics.must[0]), ['`DEFAULT_SPAWN_CAP` is 3;', '`DEFAULT_SPAWN_CAP` is three', 'DEFAULT_SPAWN_CAP = 3', '`DEFAULT_SPAWN_CAP` defaults to 3', '**`DEFAULT_SPAWN_CAP`** is 3', '`DEFAULT_SPAWN_CAP`: 3'],
    ['`DEFAULT_SPAWN_CAP` is 5;', 'DEFAULT_SPAWN_CAP is 30', 'DEFAULT_SPAWN_CAP is now lower']);
  ok(re(epics.must_not[0]), ['`DEFAULT_SPAWN_CAP` is 5;'], ['`DEFAULT_SPAWN_CAP` is 3 (was 5);', 'DEFAULT_SPAWN_CAP is 50']);
  const mgr = d2['plugins/maestro/skills/maestro-manager/SKILL.md'];
  ok(re(mgr.must[0]), ['(up to 3 at once; without herdr', 'at most three at a time', 'up to **3** at once', 'no more than 3 workers', 'up to 3 concurrent sessions'],
    ['(up to 5 at once;', 'up to 30 at once', 'up to 3']);
  ok(re(mgr.must[1]), ['the default is 3)', 'the default is `3`', 'default cap of 3', 'default: 3', '3 by default', '`3` by default', 'three is the default'],
    ['the default is 5)', 'the default is 30', 'by default']);
  ok(re(mgr.must_not[0]), ['(up to 5 at once;'], ['(up to 3 at once; was 5)']);
  ok(re(mgr.must_not[1]), ['the default is 5)'], ['the default is 3 (it was 5)', 'the default is 50']);
  const herdr = d2['plugins/maestro/skills/maestro-install/references/herdr.md'];
  ok(re(herdr.must[0]), ['(up to 3 at a\ntime)', 'up to 3 at a time', 'at most three at once'], ['(up to 5 at a\ntime)', 'up to 3 tabs']);
  ok(re(herdr.must_not[0]), ['(up to 5 at a\ntime)', 'up to 5 at a time'], ['(up to 3 at a\ntime, was 5)']);
});

test('cases: the d1/d2 reference fixes satisfy their own regexes (offline twin of edit-check)', async () => {
  const { readFileSync } = await import('node:fs');
  for (const c of (await cases044()).filter((x) => x.kind === 'scribe')) {
    const ref = JSON.parse(readFileSync(new URL(`./edit/ref/${c.id}.json`, import.meta.url), 'utf8')).edits;
    for (const [f, d] of Object.entries(c.edit.docs)) {
      const after = ref.filter((e) => e.file === f).map((e) => e.to).join('\n');
      const before = ref.filter((e) => e.file === f).map((e) => e.from).join('\n');
      assert.ok(after, `${c.id}: the reference fixes ${f}`);
      for (const r of d.must) assert.ok(new RegExp(r, 'i').test(after), `${c.id} ${f}: the fix matches ${r}`);
      for (const r of d.must_not) assert.ok(!new RegExp(r, 'i').test(after), `${c.id} ${f}: the fix is not stale for ${r}`);
      assert.ok(d.must_not.some((r) => new RegExp(r, 'i').test(before)), `${c.id} ${f}: the original text is stale`);
    }
  }
});

// bench/edit.mjs on a tiny synthetic workspace (no maestro checkout needed): real `node --test` runs.
test('edit.mjs: prepare, protect, grade a test case and a scribe case on a synthetic workspace', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { prepareEdit, gradeEdit, systemPromptFor, saveArtifacts } = await import('./edit.mjs');
  const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'bench-edit-unit-'));
  try {
    const ws = join(root, 'ws');
    mkdirSync(join(ws, 'src'), { recursive: true });
    mkdirSync(join(ws, 'test'), { recursive: true });
    mkdirSync(join(ws, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(ws, '.claude', 'agents', 'test.md'), '---\nname: test\n---\n\n# Test Agent\n');
    writeFileSync(join(ws, 'src', 'm.ts'), 'export const add = (a: number, b: number): number => a + b;\nexport const CAP = 5;\n');
    writeFileSync(join(ws, 'test', 'old.test.ts'), 'old');
    const c = { id: 'x', kind: 'test', agent: 'test', edit: {
      test: 'test/m.node.test.ts', remove: ['test/old.test.ts'], protect: ['src'],
      mutants: [{ id: 'M1', file: 'src/m.ts', from: 'a + b', to: 'a - b' }, { id: 'M2', file: 'src/m.ts', from: 'CAP = 5', to: 'CAP = 6' }],
    } };
    assert.throws(() => prepareEdit(ws, { ...c, edit: { ...c.edit, remove: ['../escape'] } }), /escapes the workspace/);
    const pristine = prepareEdit(ws, c);
    assert.ok(existsSync(join(ws, '.bench', 'ts-resolve.mjs')), 'resolve hook copied');
    assert.ok(!existsSync(join(ws, 'test', 'old.test.ts')), 'overlapping test removed');
    assert.equal(systemPromptFor(ws, c), '# Test Agent');
    assert.deepEqual([gradeEdit(ws, c, pristine).hits, gradeEdit(ws, c, pristine).detail], [0, 'no test file']);
    // the "model": a test that imports with a .js specifier (the hook resolves it to .ts), plus a stray
    // edit to protected code that grading must undo before it runs anything
    writeFileSync(join(ws, 'test', 'm.node.test.ts'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/m.js';\ntest('add', () => assert.equal(add(2, 3), 5));\n");
    writeFileSync(join(ws, 'src', 'm.ts'), 'export const add = (a: number, b: number): number => 5;\n');
    writeFileSync(join(ws, 'src', 'extra.ts'), 'x');
    const g = gradeEdit(ws, c, pristine);
    assert.deepEqual(g.restored.sort(), ['src/extra.ts', 'src/m.ts']);
    assert.deepEqual([g.hits, g.of], [2, 3], g.detail);
    assert.equal(g.detail, 'green (1 pass); killed M1; survived M2');
    assert.match(readFileSync(join(ws, 'src', 'm.ts'), 'utf8'), /a \+ b;\nexport const CAP = 5;/, 'mutants undone after grading');
    const out = join(root, 'out');
    mkdirSync(out);
    saveArtifacts(ws, c, out, 'haiku-nograph-run1', g);
    assert.deepEqual(readdirSync(out).sort(), ['haiku-nograph-run1.test-output.txt', 'haiku-nograph-run1.test__m.node.test.ts']);

    const s = { id: 'y', kind: 'scribe', agent: 'test', edit: {
      plant: [{ file: 'src/m.ts', from: 'CAP = 5', to: 'CAP = 3' }], protect: ['src'],
      docs: { 'docs/cap.md': { must: ['\\b3\\b'], must_not: ['\\b5\\b'] }, 'docs/gone.md': { must: ['3'], must_not: ['5'] } },
    } };
    mkdirSync(join(ws, 'docs'));
    writeFileSync(join(ws, 'docs', 'cap.md'), 'The cap is 5.\n');
    const sp = prepareEdit(ws, s);
    assert.match(readFileSync(join(ws, 'src', 'm.ts'), 'utf8'), /CAP = 3/, 'planted');
    assert.throws(() => prepareEdit(ws, s), /expected exactly one occurrence/, 'a plant that no longer applies is refused');
    writeFileSync(join(ws, 'docs', 'cap.md'), 'The cap is 3.\n');
    writeFileSync(join(ws, 'src', 'm.ts'), readFileSync(join(ws, 'src', 'm.ts'), 'utf8').replace('CAP = 3', 'CAP = 5')); // reverting the plant
    const sg = gradeEdit(ws, s, sp);
    assert.deepEqual([sg.hits, sg.of, sg.restored], [2, 4, ['src/m.ts']]);
    assert.equal(sg.detail, 'docs/gone.md: missing');
    assert.match(readFileSync(join(ws, 'src', 'm.ts'), 'utf8'), /CAP = 3/, 'the plant is restored');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('run.mjs: edit cases are prepared after setup and graded before the workspace is removed', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./run.mjs', import.meta.url), 'utf8');
  const loop = src.slice(src.indexOf('for (const p of plan)'));
  const at = (s) => { const i = loop.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at("spawnSync('bash', ['-c', setupCmd(c, arm)]") < at('pristine = prepareEdit(ws, c)'));
  assert.ok(at('pristine = prepareEdit(ws, c)') < at("spawnSync('claude', args"));
  assert.ok(at('grade = gradeEdit(ws, c, pristine)') < loop.lastIndexOf("if (!bool.has('keep-ws')) rmSync(ws"), 'graded before the paid run removes its workspace');
  assert.ok(at('grade = gradeEdit(ws, c, pristine)') < at('rows.push('));
  assert.match(src, /\.\.\.editArgs\(ws, c\)/);
  assert.equal((src.match(/\.\.\.editArgs\(ws, c\)/g) || []).length, 2, 'init check and paid runs');
  assert.match(src, /needGraphCall = \[\.\.\.fullArms\]\.some\(isGraphArm\)/);
  assert.match(src, /models: models\(/);
});

// --- 044 gap tests (test agent) ---

test('MODEL_ARMS: every entry has a nograph/graph base and its own model; --model never overrides it and still drives the plain arms', () => {
  for (const [arm, { base, model }] of Object.entries(MODEL_ARMS)) {
    assert.ok(['nograph', 'graph', 'noskills', 'oracle'].includes(base), `${arm}: base ${base}`);
    assert.match(model, /^claude-(haiku|sonnet)-/, `${arm}: model ${model}`);
    for (const given of ['claude-opus-5-5', 'claude-sonnet-5-5', undefined]) assert.equal(modelFor(arm, given), model, `${arm} with --model ${given}`);
  }
  for (const arm of ['nograph', 'graph', 'oracle', 'skills', 'noskills']) {
    assert.equal(modelFor(arm, 'claude-sonnet-5-5'), 'claude-sonnet-5-5', `${arm}: --model`);
    assert.equal(modelFor(arm, undefined), undefined, `${arm}: no --model, nothing invented`);
    assert.equal(baseArm(arm), arm);
  }
  assert.equal(baseArm('unknown-arm'), 'unknown-arm');
  assert.equal(isGraphArm('unknown-arm'), false);
});

test('claudeArgs: every arm under one --model, with and without the edit options', () => {
  const val = (a, flag) => a[a.indexOf(flag) + 1];
  const o = { model: 'claude-opus-5-5', runBudget: 0.75, pluginDir: '/repo/plugin' };
  for (const arm of ARMS) {
    const a = claudeArgs(arm, 'q', o);
    assert.equal(val(a, FLAGS.model), modelFor(arm, o.model), `${arm}: model`);
    assert.equal(a.includes(FLAGS.pluginDir), isGraphArm(arm), `${arm}: --plugin-dir only on graph-based arms`);
    assert.equal(a.filter((x) => x === FLAGS.model).length, 1, `${arm}: a single --model`);
    assert.equal(val(a, FLAGS.maxBudget), '0.75', `${arm}: run budget is a string`);
    assert.equal(val(a, FLAGS.permissionMode), 'dontAsk');
    assert.ok(!a.includes(FLAGS.appendSystemPrompt), `${arm}: no system prompt without one`);
  }
  // edit without a system prompt: tools widened, no empty --append-system-prompt
  const e = claudeArgs('haiku-graph', 'q', { ...o, edit: true });
  assert.equal(val(e, FLAGS.allowedTools), `Bash,Read,Grep,Glob,Skill,${EDIT_TOOLS}`);
  assert.ok(!e.includes(FLAGS.appendSystemPrompt));
  assert.equal(val(e, FLAGS.pluginDir), '/repo/plugin');
  // a system prompt with leading dashes or newlines stays one argv value right after the flag
  const sp = '--- not a flag\n# Scribe Agent\n\nUpdate docs.';
  const s = claudeArgs('sonnet-nograph', 'the handoff', { ...o, edit: true, systemPrompt: sp });
  assert.equal(val(s, FLAGS.appendSystemPrompt), sp);
  assert.equal(s.filter((x) => x === FLAGS.appendSystemPrompt).length, 1);
  assert.equal(val(s, FLAGS.print), 'the handoff');
  assert.equal(val(s, FLAGS.model), 'claude-sonnet-5-5');
  // the options object is not mutated (run.mjs reuses it across arms)
  assert.deepEqual(o, { model: 'claude-opus-5-5', runBudget: 0.75, pluginDir: '/repo/plugin' });
});

test('parseStream: edit denials only from Edit/Write errors; Bash permission errors are Bash exits; exits are 60-char, whitespace-collapsed', () => {
  const longCmd = 'node   --import ./.bench/ts-resolve.mjs\n--test apps/maestro/test/core/close-task.node.test.ts --test-reporter tap';
  const m = parseStream(J(init(),
    editUse('w', 'Write', '/ws/.claude/skills/x.md'), res('w', 'Writing to this path is not allowed in dontAsk mode', true),
    editUse('e', 'Edit', '/ws/y.md'), res('e', 'Permission to use Edit has been denied.', true),
    editUse('ok', 'Edit', '/ws/z.md'), res('ok', 'The file /ws/z.md has been updated (permission note kept).', false),
    bash('b', 'cat /root/secret'), res('b', 'Exit code 1\ncat: /root/secret: Permission denied', true),
    bash('l', longCmd), res('l', 'Exit code 1\n# fail 1', true),
    bash('n', 'node -e 1'), res('n', 'boom', true),
    done()));
  assert.equal(m.editDenials.length, 2, 'Write "not allowed" and Edit "denied"; a successful edit mentioning permission is not one');
  assert.match(m.editDenials[0], /^Write \/ws\/\.claude\/skills\/x\.md -> Writing to this path is not allowed/);
  assert.deepEqual(m.editCounts, { Edit: 2, Write: 1 });
  assert.equal(m.bashExits[0], '1:cat /root/secret', 'a Bash permission error is a Bash exit, not an edit denial');
  assert.equal(m.bashExits[1], `1:${longCmd.replace(/\s+/g, ' ').slice(0, 60)}`);
  assert.equal(m.bashExits[1].length, 62);
  assert.equal(m.bashExits[2], '1:node -e 1', 'is_error without an "Exit code" line counts as exit 1');
  // a refused edit invalidates on every arm, model arms included, edit case or not
  for (const arm of ['haiku-nograph', 'sonnet-nograph', 'nograph']) {
    assert.ok(validity(arm, m, [], { edit: true }).some((p) => /edit refused by the permission layer: Write/.test(p)), arm);
  }
});

test('parseStream: a failed Edit whose echoed old_string mentions permissions is not a refusal', () => {
  const miss = 'String to replace not found in file.\nString: Each worker\'s permission prompts and human-review';
  const m = parseStream(J(init(), editUse('e', 'Edit', '/ws/plugins/maestro/skills/maestro-install/references/herdr.md'), res('e', miss, true), done()));
  assert.deepEqual(m.editDenials, []);
  // a refusal is still caught when the error also echoes the input
  const refused = parseStream(J(init(), editUse('r', 'Edit', '/ws/.claude/skills/a.md'), res('r', 'Permission to use Edit has been denied.\nString: not allowed here', true), done()));
  assert.equal(refused.editDenials.length, 1);
});

test('editErrorHead: cuts at the first echoed-input label at a line start, any case, keeping a multi-line head', () => {
  assert.equal(editErrorHead('String to replace not found in file.\nString: x'), 'String to replace not found in file.');
  // a multi-line head survives whole; the cut is at the label line
  const multi = 'Found 2 matches of the string to replace, but replace_all is false.\nTo replace all occurrences, set replace_all to true.\nString: Permission denied';
  assert.equal(editErrorHead(multi), 'Found 2 matches of the string to replace, but replace_all is false.\nTo replace all occurrences, set replace_all to true.');
  // labels are case-insensitive and may be indented
  assert.equal(editErrorHead('Edit failed\nOLD_STRING: denied'), 'Edit failed');
  assert.equal(editErrorHead('Edit failed\n  New_String: not allowed'), 'Edit failed');
  assert.equal(editErrorHead('Write failed\nContent: permission'), 'Write failed');
  // a label word mid-line is not an echo
  assert.equal(editErrorHead('Bad content: permission denied'), 'Bad content: permission denied');
  // no label: the whole text; non-strings are stringified
  assert.equal(editErrorHead('Permission to use Edit has been denied.'), 'Permission to use Edit has been denied.');
  assert.equal(editErrorHead(undefined), 'undefined');
});

test('parseStream: edit refusal edges (echo-only wording, refusal before echo, multi-line head, label case, array content)', () => {
  const run = (name, content) => parseStream(J(init(), editUse('x', name, '/ws/doc.md'), res('x', content, true), done())).editDenials;
  // refusal wording only in a multi-line echoed old_string, one line of which starts with "Permission"
  assert.deepEqual(run('Edit', 'String to replace not found in file.\nString: intro\nPermission denied is logged\nnot allowed twice'), []);
  // a "Found N matches" multi-line head followed by an echo that mentions denial
  assert.deepEqual(run('Edit', 'Found 3 matches of the string to replace, but replace_all is false.\nTo replace all occurrences, set replace_all to true.\nString: access denied'), []);
  // upper-case echo label still cuts
  assert.deepEqual(run('Edit', 'String to replace not found in file.\nOLD_STRING: permission'), []);
  // a Write error that is not a refusal
  assert.deepEqual(run('Write', 'File has not been read yet. Read it first before writing to it.\ncontent: not allowed'), []);
  // a real refusal before an echo, in a multi-line head, still counts
  assert.equal(run('Write', 'Writing to this path is not allowed in dontAsk mode.\nSee settings.\nContent: hello').length, 1);
  assert.equal(run('Edit', 'Edit failed.\nPermission to use Edit has been denied.\nold_string: a').length, 1);
  // tool_result content as an array of text blocks
  assert.deepEqual(run('Edit', [{ type: 'text', text: 'String to replace not found in file.\nString: permission' }]), []);
  assert.equal(run('Edit', [{ type: 'text', text: 'Permission to use Edit has been denied.' }]).length, 1);
});

test('validity with edit: model arms keep their base-arm init checks (code-graph placement, concept skills)', () => {
  const failing = [bash('b', 'node --test x'), res('b', 'Exit code 1\n', true)];
  const graphNoSkills = parseStream(J(init(CG, []), ...failing, done()));
  assert.ok(validity('haiku-graph', graphNoSkills, ['task-queue'], { edit: true }).some((p) => /task-queue/.test(p)), 'a missing concept skill still invalidates');
  assert.ok(!validity('haiku-graph', graphNoSkills, ['task-queue'], { edit: true }).some((p) => /Bash failure/.test(p)));
  const cgLeak = parseStream(J(init(CG, ['task-queue']), ...failing, done()));
  assert.ok(validity('haiku-nograph', cgLeak, ['task-queue'], { edit: true }).some((p) => /code-graph in the no-graph arm/.test(p)));
  assert.ok(validity('sonnet-nograph', cgLeak, ['task-queue'], { edit: true }).some((p) => /code-graph in the no-graph arm/.test(p)));
  const errResult = parseStream(J(init([], ['task-queue']), done({ is_error: true })));
  assert.ok(validity('haiku-nograph', errResult, ['task-queue'], { edit: true }).length > 0, 'an error result still invalidates an edit run');
});

test('gradeTestRun and gradeDocs: boundaries', () => {
  const green = { status: 0, pass: 2, fail: 0 };
  // every mutant survives: only the green point
  const all = gradeTestRun({ exists: true, original: green, mutants: [{ id: 'M1', ...green }, { id: 'M2', ...green }] });
  assert.deepEqual([all.hits, all.of, all.detail], [1, 3, 'green (2 pass); killed -; survived M1,M2']);
  // exit 0 with no test is not green, so mutants never count
  const empty = gradeTestRun({ exists: true, original: { status: 0, pass: 0, fail: 0 }, mutants: [{ id: 'M1', status: 1, pass: 0, fail: 1 }] });
  assert.deepEqual([empty.hits, empty.of], [0, 2]);
  // a mutant with only placeholder ids (never run) is not counted as killed when the original is red
  const red = gradeTestRun({ exists: true, original: { status: 1, pass: 0, fail: 1 }, mutants: [{ id: 'M1' }] });
  assert.equal(red.hits, 0);
  assert.equal(gradeTestRun({ exists: true, original: null, mutants: [] }).hits, 0, 'no original run');
  // gradeDocs: a file with only must_not, a file both missing facts and stale, a doc absent from the map
  const spec = { 'a.md': { must_not: ['old'] }, 'b.md': { must: ['new', 'also'], must_not: ['old', 'older'] }, 'c.md': { must: ['x'], must_not: ['y'] } };
  const g = gradeDocs(spec, { 'a.md': 'fresh', 'b.md': 'new but OLD and older' });
  assert.deepEqual([g.hits, g.of], [2, 7]);
  assert.equal(g.detail, 'b.md: missing 1/2, stale 2/2; c.md: missing');
  assert.deepEqual(gradeDocs({}, {}), { hits: 0, of: 0, detail: 'all facts right, nothing stale' });
});

test('edit.mjs: restore recreates a deleted protected file, removes a nested added one; a red suite runs no mutant; a missing remove path or stale mutant throws', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { prepareEdit, gradeEdit, runTestFile } = await import('./edit.mjs');
  const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'bench-edit-gap-'));
  const savedOpts = process.env.NODE_OPTIONS;
  try {
    const ws = join(root, 'ws');
    mkdirSync(join(ws, 'src', 'core'), { recursive: true });
    mkdirSync(join(ws, 'test'), { recursive: true });
    writeFileSync(join(ws, 'src', 'core', 'm.ts'), 'export const twice = (n: number): number => n * 2;\n');
    writeFileSync(join(ws, 'src', 'keep.ts'), 'export const K = 1;\n');
    const c = { id: 'g', kind: 'test', agent: 'test', edit: {
      test: 'test/m.node.test.ts', protect: ['src'],
      mutants: [{ id: 'M1', file: 'src/core/m.ts', from: 'n * 2', to: 'n + 2' }],
    } };
    assert.throws(() => prepareEdit(ws, { ...c, edit: { ...c.edit, remove: ['test/absent.test.ts'] } }), /edit.remove names a missing path/);
    assert.throws(() => prepareEdit(ws, { ...c, edit: { ...c.edit, protect: ['/etc'] } }), /escapes the workspace/);
    const pristine = prepareEdit(ws, c);

    // the "model" deletes a protected file and adds one in a new nested dir; the suite is red
    rmSync(join(ws, 'src', 'keep.ts'));
    mkdirSync(join(ws, 'src', 'new', 'deep'), { recursive: true });
    writeFileSync(join(ws, 'src', 'new', 'deep', 'x.ts'), 'x');
    writeFileSync(join(ws, 'test', 'm.node.test.ts'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { twice } from '../src/core/m.js';\ntest('twice', () => assert.equal(twice(2), 5));\n");
    const r = gradeEdit(ws, c, pristine);
    assert.deepEqual(r.restored.sort(), ['src/keep.ts', 'src/new/deep/x.ts']);
    assert.equal(readFileSync(join(ws, 'src', 'keep.ts'), 'utf8'), 'export const K = 1;\n');
    assert.ok(!existsSync(join(ws, 'src', 'new', 'deep', 'x.ts')));
    assert.deepEqual([r.hits, r.of], [0, 2]);
    assert.match(r.detail, /^not green on the original \(exit 1, pass 0, fail 1\)/);
    assert.deepEqual(r.runs.mutants, [], 'a red suite runs no mutant');

    // an inherited NODE_OPTIONS that would break the child (and NODE_TEST_CONTEXT, set by this outer
    // node --test run) does not leak into the graded run
    assert.ok(process.env.NODE_TEST_CONTEXT, 'this test runs under node --test');
    process.env.NODE_OPTIONS = `--require ${join(root, 'does-not-exist.cjs')}`;
    writeFileSync(join(ws, 'test', 'm.node.test.ts'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { twice } from '../src/core/m.js';\ntest('twice', () => assert.equal(twice(3), 6));\n");
    const direct = runTestFile(ws, c.edit.test);
    assert.deepEqual([direct.status, direct.pass, direct.fail, direct.timedOut], [0, 1, 0, false], direct.tail);
    const ok = gradeEdit(ws, c, pristine);
    assert.deepEqual([ok.hits, ok.of, ok.restored], [2, 2, []], ok.detail);
    if (savedOpts === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = savedOpts;

    // a mutant whose text no longer occurs (maestro pin change) stops grading, and the file is untouched
    const stale = { ...c, edit: { ...c.edit, mutants: [{ id: 'M9', file: 'src/core/m.ts', from: 'n * 3', to: 'n' }] } };
    assert.throws(() => gradeEdit(ws, stale, pristine), /g mutant M9: expected exactly one occurrence .* found none/);
    assert.equal(readFileSync(join(ws, 'src', 'core', 'm.ts'), 'utf8'), 'export const twice = (n: number): number => n * 2;\n');
  } finally {
    if (savedOpts === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = savedOpts;
    rmSync(root, { recursive: true, force: true });
  }
});

// --- 051: haiku-noskills and haiku-oracle arms, the harder edit set, the decision-rule guard ---

test('051 arms: haiku-noskills and haiku-oracle pin Haiku and behave as their base arm', () => {
  assert.equal(baseArm('haiku-noskills'), 'noskills');
  assert.equal(baseArm('haiku-oracle'), 'oracle');
  assert.equal(modelFor('haiku-noskills', 'claude-opus-5-5'), 'claude-haiku-5-5');
  assert.equal(modelFor('haiku-oracle', 'claude-opus-5-5'), 'claude-haiku-5-5');
  assert.equal(setupArm('haiku-noskills'), 'noskills', 'the strip runs for the Haiku noskills arm');
  assert.equal(setupArm('haiku-oracle'), 'nograph', 'the oracle arm gets the plain workspace, no graph.db');
  assert.equal(isGraphArm('haiku-oracle'), false);
  assert.equal(isGraphArm('haiku-noskills'), false);
  assert.deepEqual(parseArms('sonnet-nograph,haiku-oracle,haiku-nograph,haiku-noskills'), ['haiku-nograph', 'sonnet-nograph', 'haiku-noskills', 'haiku-oracle']);
  for (const arm of ['haiku-noskills', 'haiku-nograph', 'haiku-oracle', 'sonnet-nograph']) {
    const a = claudeArgs(arm, 'q', { model: 'claude-opus-5-5', runBudget: '0.75', pluginDir: '/p', edit: true, systemPrompt: 'body' });
    assert.ok(!a.includes(FLAGS.pluginDir), `${arm}: no --plugin-dir`);
  }
});

test('051 prompts: stored graph output is in haiku-oracle only', () => {
  const c = { question: 'Write the tests.' };
  const p = (arm) => promptFor(arm, c, 'idx line');
  assert.match(p('haiku-oracle'), /<code-index>\nidx line\n<\/code-index>/);
  assert.equal(p('haiku-oracle'), oraclePrompt('Write the tests.', 'idx line'));
  for (const arm of ['haiku-noskills', 'haiku-nograph', 'sonnet-nograph', 'haiku-graph']) assert.equal(p(arm), 'Write the tests.', arm);
  for (const arm of ['haiku-noskills', 'haiku-nograph', 'haiku-oracle', 'sonnet-nograph']) {
    assert.deepEqual(promptProblems(arm, p(arm)), [], arm);
  }
  assert.match(promptProblems('haiku-oracle', 'Write the tests.')[0], /no stored graph output/);
  for (const arm of ['haiku-noskills', 'haiku-nograph', 'sonnet-nograph']) {
    assert.match(promptProblems(arm, oraclePrompt('q', 'idx'))[0], /only an oracle arm may/, arm);
  }
  assert.equal(isOracleArm('oracle'), true);
  assert.equal(isOracleArm('haiku-nograph'), false);
});

test('051 init checks: skills absent only in haiku-noskills, no code-graph plugin in any of the four arms', () => {
  const withSkills = parseStream(J(init([], ['task-queue', 'maestro']), done()));
  const noSkills = parseStream(J(init([], ['maestro']), done()));
  const cg = parseStream(J(init(CG, ['task-queue', 'maestro']), done()));
  const o = { keepSkills: ['maestro'], edit: true };
  for (const arm of ['haiku-nograph', 'haiku-oracle', 'sonnet-nograph']) {
    assert.deepEqual(validity(arm, withSkills, ['task-queue'], o), [], arm);
    assert.ok(validity(arm, noSkills, ['task-queue'], o).some((x) => /does not load project skill/.test(x)), `${arm} needs its concept skills`);
  }
  assert.deepEqual(validity('haiku-noskills', noSkills, ['task-queue'], o), []);
  assert.ok(validity('haiku-noskills', withSkills, ['task-queue'], o).some((x) => /not stripped/.test(x)), 'a leaked concept skill invalidates haiku-noskills');
  assert.ok(validity('haiku-noskills', parseStream(J(init([], []), done())), ['task-queue'], o).some((x) => /non-concept project skill/.test(x)), 'the non-concept skill must survive the strip');
  for (const arm of ['haiku-noskills', 'haiku-nograph', 'haiku-oracle', 'sonnet-nograph']) {
    assert.ok(validity(arm, cg, arm === 'haiku-noskills' ? [] : ['task-queue'], o).some((x) => /code-graph/.test(x)), `${arm}: a code-graph plugin is a config leak`);
  }
});

test('051 cases: the set is d2 plus four new edit cases, well formed, with captured oracle output and a reference solution each', async () => {
  const { existsSync, readFileSync } = await import('node:fs');
  const set = selectCases(JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8')).cases, { set: '051' });
  assert.deepEqual(set.map((c) => c.id), ['d2-scribe-spawn-cap', 't3-test-session-sweep', 't4-test-channel-lanes', 'd3-scribe-channel-age-cap', 'd4-scribe-sweep-idle-cap']);
  for (const c of set) {
    assert.ok(isEditCase(c), c.id);
    assert.deepEqual(editCaseProblems(c), [], c.id);
    assert.equal(c.group, 'maestro@3814a30', c.id);
    assert.ok(c.skills.length && c.keep_skills.length, `${c.id}: the noskills arm needs skills to strip and one to keep`);
    assert.ok(Array.isArray(c.proxy_cmd) && c.proxy_cmd[0] === 'query', `${c.id}: proxy_cmd for the oracle capture`);
    const of = new URL(`./${oracleFile(c.id)}`, import.meta.url);
    assert.ok(existsSync(of), `${c.id}: stored graph output`);
    assert.ok(readFileSync(of, 'utf8').trim().length > 100, `${c.id}: non-empty oracle`);
    const ref = c.kind === 'test' ? `./edit/ref/${c.id}.test.ts` : `./edit/ref/${c.id}.json`;
    assert.ok(existsSync(new URL(ref, import.meta.url)), `${c.id}: ${ref}`);
    assert.equal(c.proposal, undefined, c.id);
  }
  const d2 = set[0];
  assert.deepEqual(d2.sets, ['044', '051']);
  const pts = (c) => (c.kind === 'test' ? 1 + c.edit.mutants.length : Object.values(c.edit.docs).reduce((n, d) => n + d.must.length + d.must_not.length, 0));
  assert.deepEqual(set.map(pts), [8, 6, 6, 9, 7]);
});

test('051 decision rule: docs/evals.md has the pre-registered rule with cap, thresholds, and no results yet', async () => {
  const { readFileSync } = await import('node:fs');
  const md = readFileSync(new URL('../docs/evals.md', import.meta.url), 'utf8');
  const i = md.indexOf('## Ticket 051');
  assert.ok(i >= 0, 'a Ticket 051 section');
  const sec = md.slice(i);
  for (const re of [/Decision rule \(fixed before any result\)/, /cap/i, /skills help/i, /graph answers help/i, /gap to Sonnet/i, /haiku-noskills/, /haiku-oracle/, /sonnet-nograph/, /haiku-nograph/]) assert.match(sec, re, String(re));
  assert.doesNotMatch(sec, /^#{2,4} Results(?! template)/m, 'results are written only after the paid run');
});

test('051 decision rule: missed-points recovery with a floor, an inconclusive case, per-group verdicts, user confirms at pilot', async () => {
  const { readFileSync } = await import('node:fs');
  const md = readFileSync(new URL('../docs/evals.md', import.meta.url), 'utf8');
  const sec = md.slice(md.indexOf('## Ticket 051'));
  assert.match(sec, /missed/i, 'the rule is on missed points');
  assert.match(sec, /one third of `missed\(B\)`/, 'a third of the baseline\'s missed points');
  assert.match(sec, /at least 3 points \(the absolute floor\)/, 'an absolute floor');
  assert.match(sec, /fewer than 3 points in a group[^.]*inconclusive \(saturated\)/, 'a near-perfect baseline is inconclusive, not pass or fail');
  assert.doesNotMatch(sec, /1\.15 x/, 'no ratio threshold: it is out of reach near the ceiling');
  for (const g of ['test', 'scribe', 'overall']) assert.match(sec, new RegExp(`\\| ${g} \\|`), `results template row for ${g}`);
  assert.match(sec, /Every verdict above is given for test, for scribe and overall/);
  assert.match(sec, /never overrides a group verdict/);
  assert.match(sec, /user confirms the final numbers and the cap at pilot time/);
  assert.match(sec, /per-agent model recommendation/);
  // the scribe-side limit of the graph is stated, with what search was tried
  assert.match(sec, /`code-graph search` was tried/);
  assert.match(sec, /measures this limit of the graph/);
  // the points arithmetic stated in the rule matches the cases: test 24, scribe 48, overall 72 at 2 runs
  const all = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8')).cases;
  const set = selectCases(all, { set: '051' });
  const pts = (c) => (c.kind === 'test' ? 1 + c.edit.mutants.length : Object.values(c.edit.docs).reduce((n, d) => n + d.must.length + d.must_not.length, 0));
  const sum = (k) => 2 * set.filter((c) => c.kind === k).reduce((n, c) => n + pts(c), 0);
  assert.equal(sum('test'), 24);
  assert.equal(sum('scribe'), 48);
  assert.match(sec, /\*\*test\*\* \(t3, t4\) is 24 points, \*\*scribe\*\* \(d2, d3, d4\) is 48, \*\*overall\*\* is 72/);
});

test('051 oracle: scribe cases store a real search plus the impact, as captured by capture-oracle', async () => {
  const { readFileSync } = await import('node:fs');
  const all = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8')).cases;
  for (const id of ['d2-scribe-spawn-cap', 'd3-scribe-channel-age-cap', 'd4-scribe-sweep-idle-cap']) {
    const c = all.find((x) => x.id === id);
    assert.deepEqual(c.proxy_extra.map((a) => a[0]), ['search'], `${id}: one search after proxy_cmd`);
    const text = readFileSync(new URL(`./${oracleFile(id)}`, import.meta.url), 'utf8');
    assert.match(text, /^# Search: /m, `${id}: the stored output holds the search`);
    assert.match(text, /SKILL\.md/, `${id}: the search reaches concept skill docs`);
  }
  assert.match(readFileSync(new URL('./capture-oracle.mjs', import.meta.url), 'utf8'), /proxy_extra/);
});
