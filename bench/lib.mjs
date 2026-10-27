// Pure helpers for bench/run.mjs: the claude -p flag set, stream-json parsing, validity checks, tables.
// Every claude CLI flag name lives in FLAGS below. Verify them against `claude -p --help` and fix them
// here only (see bench/README.md).

export const FLAGS = {
  print: '-p',
  model: '--model',
  outputFormat: '--output-format', // value: stream-json
  verbose: '--verbose', // stream-json under -p requires it (flag exists per `claude -p --help`)
  maxBudget: '--max-budget-usd',
  noSessionPersistence: '--no-session-persistence',
  allowedTools: '--allowedTools',
  permissionMode: '--permission-mode', // value: dontAsk (a listed choice in `claude -p --help`; keeps -p from prompting)
  settingSources: '--setting-sources', // value: local (drops user + project settings, so no installed plugins)
  strictMcpConfig: '--strict-mcp-config',
  pluginDir: '--plugin-dir',
};

export const ALLOWED_TOOLS = 'Bash,Read,Grep,Glob,Skill';
export const OK_CG_EXITS = new Set([0, 4, 6, 7]); // documented code-graph exits (docs/usage.md)

export function claudeArgs(arm, prompt, { model, runBudget, pluginDir }) {
  const a = [
    FLAGS.print, prompt,
    FLAGS.model, model,
    FLAGS.outputFormat, 'stream-json', FLAGS.verbose,
    FLAGS.maxBudget, String(runBudget),
    FLAGS.noSessionPersistence,
    FLAGS.allowedTools, ALLOWED_TOOLS,
    FLAGS.permissionMode, 'dontAsk',
    FLAGS.settingSources, 'local',
    FLAGS.strictMcpConfig,
  ];
  if (arm === 'graph') a.push(FLAGS.pluginDir, pluginDir);
  return a;
}

const textOf = (c) => (typeof c === 'string' ? c : (c || []).map((x) => x.text || '').join(''));

// Parse one stream-json transcript into metrics.
export function parseStream(text) {
  const m = {
    init: null, cost: null, turns: null, isError: null, answer: '',
    input: 0, output: 0, cacheRead: 0, cacheCreate: 0,
    counts: { Read: 0, Grep: 0, Glob: 0, Bash: 0, Skill: 0 },
    bashFailures: [], // non-code-graph failures or seccomp: these invalidate the run
    graphCalls: [], // { exit, chars }
    seccomp: 0,
  };
  const idToTool = new Map();
  const seenMsg = new Set();
  let lastText = '';
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type === 'system' && j.subtype === 'init') m.init = j;
    if (j.type === 'result') {
      if (typeof j.total_cost_usd === 'number') m.cost = j.total_cost_usd;
      if (typeof j.num_turns === 'number') m.turns = j.num_turns;
      m.isError = j.is_error ?? m.isError;
      if (typeof j.result === 'string') m.answer = j.result;
    }
    const msg = j.message;
    if (!msg) continue;
    if (j.type === 'assistant' && msg.usage) {
      const k = msg.id || JSON.stringify(msg.usage);
      if (!seenMsg.has(k)) {
        seenMsg.add(k);
        const u = msg.usage;
        m.input += u.input_tokens || 0;
        m.output += u.output_tokens || 0;
        m.cacheRead += u.cache_read_input_tokens || 0;
        m.cacheCreate += u.cache_creation_input_tokens || 0;
      }
    }
    for (const b of Array.isArray(msg.content) ? msg.content : []) {
      if (b.type === 'text' && j.type === 'assistant') lastText = b.text;
      if (b.type === 'tool_use') {
        idToTool.set(b.id, b);
        if (b.name in m.counts) m.counts[b.name]++;
      } else if (b.type === 'tool_result') {
        const t = idToTool.get(b.tool_use_id);
        if (!t || t.name !== 'Bash') continue;
        const out = textOf(b.content);
        const cmd = String((t.input && t.input.command) || '');
        const e = /^Exit code (\d+)/m.exec(out);
        const exit = e ? Number(e[1]) : (b.is_error ? 1 : 0);
        const seccomp = /apply-seccomp/.test(out);
        const isCg = /code-graph(\.cjs)?\b/.test(cmd);
        if (seccomp) m.seccomp++;
        if (isCg) m.graphCalls.push({ exit, chars: out.length });
        const okCg = isCg && OK_CG_EXITS.has(exit);
        if (seccomp || ((exit !== 0 || b.is_error) && !okCg)) {
          m.bashFailures.push(`${cmd.replace(/\s+/g, ' ').slice(0, 80)} -> ${out.replace(/\s+/g, ' ').slice(0, 100)}`);
        }
      }
    }
  }
  if (!m.answer) m.answer = lastText;
  return m;
}

// Problems that make a run invalid (not counted). Empty list = valid.
export function validity(arm, m) {
  const p = [];
  if (m.seccomp) p.push(`apply-seccomp in ${m.seccomp} Bash call(s): nested sandbox, the CLI never ran`);
  for (const f of m.bashFailures) if (!/apply-seccomp/.test(f)) p.push(`Bash failure: ${f}`);
  if (!m.init) {
    p.push('no init event in transcript');
  } else {
    const names = (x) => (Array.isArray(x) ? x.map((e) => (typeof e === 'string' ? e : e && (e.name || e.path || JSON.stringify(e)))) : []);
    const seen = [...names(m.init.plugins), ...names(m.init.skills), ...names(m.init.slash_commands), ...names(m.init.agents)];
    const hasCg = seen.some((s) => /code-graph/.test(String(s)));
    if (arm === 'nograph' && hasCg) p.push('init shows code-graph in the no-graph arm (config leak)');
    if (arm === 'graph' && !hasCg) p.push('init does not show the code-graph plugin in the graph arm');
  }
  if (m.isError) p.push('result event has is_error');
  if (m.cost == null) p.push('no result event (cost unknown)');
  return p;
}

export function score(answer, must) {
  const hits = must.filter((re) => new RegExp(re, 'i').test(answer)).length;
  return { hits, of: must.length };
}

const f = (x, d = 0) => (x == null ? 'n/a' : x.toFixed(d));

export function report(rows, meta) {
  const L = [];
  const invalid = rows.filter((r) => r.problems.length);
  L.push(`# bench report (${meta.model}, spent $${meta.spent.toFixed(3)} of $${meta.budget})`, '');
  if (meta.stop) L.push(`STOPPED: ${meta.stop}`, '');
  if (invalid.length) {
    L.push(`## INVALID RUNS (${invalid.length}, not counted)`, '');
    for (const r of invalid) for (const p of r.problems) L.push(`- ${r.case} ${r.arm} run${r.run}: ${p}`);
    L.push('');
  } else if (rows.length) L.push('All runs valid: no Bash failures, init events match their arm.', '');
  L.push('## Per case and arm', '');
  L.push('| case | arm | run | valid | cost $ | turns | in tok | out tok | cache read | cache create | Read | Grep | Glob | Bash | Skill | code-graph calls (exit:chars) | score |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const m = r.m;
    const calls = m.graphCalls.length ? m.graphCalls.map((c) => `${c.exit}:${c.chars}`).join(' ') : '-';
    L.push(`| ${r.case} | ${r.arm} | ${r.run} | ${r.problems.length ? 'INVALID' : 'yes'} | ${f(m.cost, 3)} | ${m.turns ?? 'n/a'} | ${m.input} | ${m.output} | ${m.cacheRead} | ${m.cacheCreate} | ${m.counts.Read} | ${m.counts.Grep} | ${m.counts.Glob} | ${m.counts.Bash} | ${m.counts.Skill} | ${calls} | ${r.sc.hits}/${r.sc.of} |`);
  }
  return L.join('\n') + '\n';
}

// Pass rule for the fixture check: graph arm has a code-graph call exiting 0 with output, no run
// has a Bash failure, no-graph init shows no code-graph plugin (all covered by validity()).
export function checkVerdict(rows) {
  const graph = rows.filter((r) => r.arm === 'graph');
  const realCall = graph.some((r) => r.m.graphCalls.some((c) => c.exit === 0 && c.chars > 0));
  const allValid = rows.length > 0 && rows.every((r) => !r.problems.length);
  const bothArms = graph.length > 0 && rows.some((r) => r.arm === 'nograph');
  return { pass: realCall && allValid && bothArms, realCall, allValid, bothArms };
}
