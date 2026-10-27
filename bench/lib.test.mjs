// node --test bench/lib.test.mjs : validity, metrics and report logic on synthetic stream-json transcripts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStream, validity, report, checkVerdict, score, claudeArgs, isCg, selectCases } from './lib.mjs';

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

test('selectCases: --group by substring on the group field, composes with --only', async () => {
  const { readFileSync } = await import('node:fs');
  const all = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8')).cases;
  const ids = (o) => selectCases(all, o).map((c) => c.id);
  assert.equal(ids({}).length, all.length);
  const g = ids({ group: 'maestro' });
  assert.deepEqual(g.map((i) => i.split('-')[0]), ['m1', 'm2', 'm3', 'm4', 'm5']);
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
