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
  settingSources: '--setting-sources', // value: project,local (drops user settings, so no installed plugins; loads the workspace's .claude/skills. A workspace .claude/settings.json would still apply, so maestro-setup.sh deletes it)
  strictMcpConfig: '--strict-mcp-config',
  pluginDir: '--plugin-dir',
};

export const ALLOWED_TOOLS = 'Bash,Read,Grep,Glob,Skill';
export const OK_CG_EXITS = new Set([0, 4, 6, 7]); // documented code-graph exits (docs/usage.md)

// Arms, in the order they run per case. `oracle` = the nograph workspace and flags (no plugin, no
// scribe-output/), with the case's stored graph output appended to the question. `skills` (042) =
// the nograph workspace as is (concept skills present); `noskills` = the same workspace with every
// concept skill removed from .claude/skills (bench/strip-concept-skills.mjs), other skills kept.
export const ARMS = ['nograph', 'oracle', 'graph', 'skills', 'noskills'];
export const DEFAULT_ARMS = 'nograph,graph';
export const SKILL_ARMS = new Set(['skills', 'noskills']);

// The arm a case's setup command is built for ({ARM}): only the graph arm gets a graph, only the
// noskills arm loses its concept skills; every other arm gets the nograph workspace.
export const setupArm = (arm) => (arm === 'graph' || arm === 'noskills' ? arm : 'nograph');

// True when a SKILL.md's YAML frontmatter carries the concept-skill marker `metadata.type:
// concept-skill` (block form `metadata:\n  type: concept-skill`, quoted or not, or inline
// `metadata: { type: concept-skill }`). Text outside the frontmatter never counts.
export function isConceptSkillMd(text) {
  const fm = /^﻿?---\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/.exec(String(text ?? ''));
  if (!fm) return false;
  const lines = fm[1].split(/\r?\n/);
  const isType = (s) => /^type:\s*["']?concept-skill["']?\s*(#.*)?$/.test(s.trim());
  for (let i = 0; i < lines.length; i++) {
    const inline = /^metadata:\s*\{(.*)\}\s*$/.exec(lines[i]);
    if (inline) { if (inline[1].split(',').some(isType)) return true; continue; }
    if (!/^metadata:\s*(#.*)?$/.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length && (/^\s+\S/.test(lines[j]) || !lines[j].trim()); j++) {
      if (isType(lines[j])) return true;
    }
  }
  return false;
}

// The skill name a SKILL.md declares (frontmatter `name:`), else the fallback (its directory name).
export function skillNameOf(text, fallback) {
  const fm = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(String(text ?? ''));
  const n = fm && /^name:\s*["']?([^"'\n#]+?)["']?\s*$/m.exec(fm[1]);
  return n ? n[1].trim() : fallback;
}

// `--arms a,b`: known arms only, deduped, in ARMS order.
export function parseArms(s) {
  const want = String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const bad = want.filter((a) => !ARMS.includes(a));
  if (bad.length) throw new Error(`unknown arm(s): ${bad.join(', ')} (known: ${ARMS.join(', ')})`);
  if (!want.length) throw new Error('no arm given');
  return ARMS.filter((a) => want.includes(a));
}

export const ORACLE_HEADER = 'Context from a code index of this repository, retrieved for this question. Each `@path:line` points into the source.';

// The oracle prompt: the question, then the stored index output as context. The text never names the
// CLI, so the model has no reason to try running it (it is not installed in this arm).
export function oraclePrompt(question, indexOutput) {
  const body = String(indexOutput ?? '').trim();
  if (!body) throw new Error('oracle prompt needs the stored index output');
  return `${question}\n\n${ORACLE_HEADER}\n\n<code-index>\n${body}\n</code-index>`;
}

export function promptFor(arm, c, oracleText) {
  return arm === 'oracle' ? oraclePrompt(c.question, oracleText) : c.question;
}

// Where a case's stored graph output lives (captured by bench/capture-oracle.mjs from `proxy_cmd`).
export const oracleFile = (id) => `oracle/${id}.txt`;

// Ordered run plan: run number, then case, then arm. `graphCases` (substrings of case ids) limits the
// graph arm to the matching cases; empty = graph on every case.
export function planRuns(cases, { arms, graphCases = [], runs = 1 }) {
  const plan = [];
  for (let n = 1; n <= runs; n++) {
    for (const c of cases) {
      for (const arm of arms) {
        if (arm === 'graph' && graphCases.length && !graphCases.some((s) => c.id.includes(s))) continue;
        plan.push({ case: c.id, arm, run: n });
      }
    }
  }
  return plan;
}

// Never start a run that could push the total past the cap: each run may spend up to runBudget.
export const budgetStop = (spent, runBudget, budget) => spent + Number(runBudget) > Number(budget) + 1e-9;

// A run that hit the account usage limit (HTTP 429) is not a bench result: not counted, rerun later.
export const isUsageLimit = (m) => Boolean(m && m.usageLimit);

// valid | invalid | usage-limit. Rows written before 041 carry no status: derive it from problems.
export function runStatus(m, problems) {
  if (isUsageLimit(m)) return 'usage-limit';
  return problems.length ? 'invalid' : 'valid';
}
export const statusOf = (r) => r.status || (r.problems.length ? 'invalid' : 'valid');

// Rerun plan from a previous invocation's runs.json: planned runs with no valid or invalid row, i.e.
// the ones that hit the usage limit or never started because the invocation stopped.
export function rerunPlan(prev) {
  const done = new Set(prev.rows.filter((r) => statusOf(r) !== 'usage-limit').map((r) => `${r.case}|${r.arm}|${r.run}`));
  return prev.planned.filter((p) => !done.has(`${p.case}|${p.arm}|${p.run}`));
}

export function claudeArgs(arm, prompt, { model, runBudget, pluginDir }) {
  const a = [
    FLAGS.print, prompt,
    FLAGS.model, model,
    FLAGS.outputFormat, 'stream-json', FLAGS.verbose,
    FLAGS.maxBudget, String(runBudget),
    FLAGS.noSessionPersistence,
    FLAGS.allowedTools, ALLOWED_TOOLS,
    FLAGS.permissionMode, 'dontAsk',
    FLAGS.settingSources, 'project,local',
    FLAGS.strictMcpConfig,
  ];
  if (arm === 'graph') a.push(FLAGS.pluginDir, pluginDir);
  return a;
}

// True only when a command segment runs the code-graph CLI: `code-graph ...`, `<path>/code-graph ...`,
// or `node [flags] <path>/code-graph.cjs ...` (optionally behind VAR=x prefixes). A grep, cat or echo
// that merely mentions code-graph does not count.
export function isCg(cmd) {
  const unq = (s) => s.replace(/^["']|["']$/g, '');
  const isBin = (s) => /(^|\/)code-graph(\.cjs)?$/.test(unq(s));
  for (const seg of String(cmd).split(/&&|\|\||[;|&\n]/)) {
    const t = seg.trim().split(/\s+/).filter(Boolean);
    while (t.length && /^\w+=/.test(t[0])) t.shift();
    if (!t.length) continue;
    if (isBin(t[0])) return true;
    if (/^(.*\/)?(node|nodejs)$/.test(t[0])) {
      const script = t.slice(1).find((x) => !x.startsWith('-'));
      if (script && isBin(script)) return true;
    }
  }
  return false;
}

const textOf =(c) => (typeof c === 'string' ? c : (c || []).map((x) => x.text || '').join(''));

// Parse one stream-json transcript into metrics.
export function parseStream(text) {
  const m = {
    init: null, cost: null, turns: null, isError: null, answer: '',
    input: 0, output: 0, cacheRead: 0, cacheCreate: 0,
    counts: { Read: 0, Grep: 0, Glob: 0, Bash: 0, Skill: 0 },
    bashFailures: [], // non-code-graph failures or seccomp: these invalidate the run
    graphCalls: [], // { exit, chars }
    seccomp: 0,
    usageLimit: false, // result event reports an account usage limit (429)
    skillCalls: [], // skill names passed to the Skill tool, in call order
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
      if (j.api_error_status === 429 || j.api_error === 'usage_limit_reached') m.usageLimit = true;
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
        if (b.name === 'Skill' && b.input) {
          const s = b.input.skill ?? b.input.name ?? b.input.command;
          if (typeof s === 'string' && s.trim()) m.skillCalls.push(s.trim().replace(/^\//, ''));
        }
      } else if (b.type === 'tool_result') {
        const t = idToTool.get(b.tool_use_id);
        if (!t || t.name !== 'Bash') continue;
        const out = textOf(b.content);
        const cmd = String((t.input && t.input.command) || '');
        const e = /^Exit code (\d+)/m.exec(out);
        const exit = e ? Number(e[1]) : (b.is_error ? 1 : 0);
        const seccomp = /apply-seccomp/.test(out);
        const cg = isCg(cmd);
        if (seccomp) m.seccomp++;
        if (cg) m.graphCalls.push({ exit, chars: out.length });
        const okCg = cg && OK_CG_EXITS.has(exit);
        if (seccomp || ((exit !== 0 || b.is_error) && !okCg)) {
          m.bashFailures.push(`${cmd.replace(/\s+/g, ' ').slice(0, 80)} -> ${out.replace(/\s+/g, ' ').slice(0, 100)}`);
        }
      }
    }
  }
  if (!m.answer) m.answer = lastText;
  return m;
}

const ARM_LABEL = { oracle: 'oracle', skills: 'skills', noskills: 'noskills' };
const sameSkill = (x, s) => String(x) === s || String(x).endsWith(`:${s}`);

// Problems that make a run invalid (not counted). Empty list = valid.
// `expectSkills` (optional, per case): the case's concept skills. Every arm but `noskills` must list
// them all in the init event (so a dropped .claude/skills cannot go unnoticed); `noskills` must list
// none of them and must not call any of them through the Skill tool.
// `keepSkills` (optional, per case `keep_skills`): non-concept project skills both skill arms must
// still list, so `noskills` proves it removed only the concept skills, not .claude/skills wholesale.
export function validity(arm, m, expectSkills = [], { keepSkills = [] } = {}) {
  const p = [];
  if (m.seccomp) p.push(`apply-seccomp in ${m.seccomp} Bash call(s): nested sandbox, the CLI never ran`);
  for (const f of m.bashFailures) if (!/apply-seccomp/.test(f)) p.push(`Bash failure: ${f}`);
  if (!m.init) {
    p.push('no init event in transcript');
  } else {
    const names = (x) => (Array.isArray(x) ? x.map((e) => (typeof e === 'string' ? e : e && (e.name || e.path || JSON.stringify(e)))) : []);
    const seen = [...names(m.init.plugins), ...names(m.init.skills), ...names(m.init.slash_commands), ...names(m.init.agents)];
    const hasCg = seen.some((s) => /code-graph/.test(String(s)));
    const listed = (s) => seen.some((x) => sameSkill(x, s));
    if (arm === 'noskills') {
      const leaked = expectSkills.filter(listed);
      if (leaked.length) p.push(`init lists concept skill(s) in the noskills arm: ${leaked.join(', ')} (not stripped)`);
    } else {
      const missing = expectSkills.filter((s) => !listed(s));
      if (missing.length) p.push(`init does not load project skill(s): ${missing.join(', ')}`);
    }
    if (SKILL_ARMS.has(arm)) {
      const gone = keepSkills.filter((s) => !listed(s));
      if (gone.length) p.push(`init does not list non-concept project skill(s) in the ${arm} arm: ${gone.join(', ')}`);
    }
    if (arm !== 'graph' && hasCg) p.push(`init shows code-graph in the ${ARM_LABEL[arm] || 'no-graph'} arm (config leak)`);
    if (arm === 'graph' && !hasCg) p.push('init does not show the code-graph plugin in the graph arm');
  }
  if (arm === 'noskills') {
    const called = [...new Set((m.skillCalls || []).filter((x) => expectSkills.some((s) => sameSkill(x, s))))];
    if (called.length) p.push(`Skill call to concept skill(s) in the noskills arm: ${called.join(', ')}`);
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

export const SELECTION_BIAS_NOTE = 'the maestro questions were kept only because an offline proxy showed the graph covers the answer (questions it missed were dropped), so these results favour the graph and overstate its advantage on questions in general.';
export const SKILLS_BIAS_NOTE = 'the questions were chosen where a concept skill should help (each names the skill that covers it), so these results favour the skills arm and overstate what concept skills save on questions in general.';

// Per case: how many valid `skills`-arm runs called at least one of the case's covering skills.
// covering = { caseId: [skill names] }. Cases with no covering skill are left out.
export function coveringLoads(rows, covering = {}) {
  const out = new Map();
  for (const r of rows) {
    const want = covering[r.case];
    if (r.arm !== 'skills' || statusOf(r) !== 'valid' || !want || !want.length) continue;
    const s = out.get(r.case) || { runs: 0, loaded: 0, skills: want };
    s.runs++;
    if ((r.m.skillCalls || []).some((x) => want.some((w) => sameSkill(x, w)))) s.loaded++;
    out.set(r.case, s);
  }
  return out;
}

const STATUS_CELL = { valid: 'yes', invalid: 'INVALID', 'usage-limit': 'USAGE-LIMIT' };

// Sums over the valid rows, grouped by keyOf(row). Rows that are invalid or hit the usage limit are
// not counted.
export function sums(rows, keyOf) {
  const out = new Map();
  for (const r of rows) {
    if (statusOf(r) !== 'valid') continue;
    const k = keyOf(r);
    if (k == null) continue;
    const s = out.get(k) || { n: 0, cost: 0, turns: 0, input: 0, output: 0, cacheRead: 0, cacheCreate: 0, Read: 0, Grep: 0, Glob: 0, Bash: 0, Skill: 0, hits: 0, of: 0 };
    s.n++; s.cost += r.m.cost || 0; s.turns += r.m.turns || 0;
    for (const t of ['input', 'output', 'cacheRead', 'cacheCreate']) s[t] += r.m[t] || 0;
    for (const t of ['Read', 'Grep', 'Glob', 'Bash', 'Skill']) s[t] += r.m.counts[t] || 0;
    s.hits += r.sc.hits; s.of += r.sc.of;
    out.set(k, s);
  }
  return out;
}

// Relative difference of a against b on cost, e.g. -0.25 = a is 25% cheaper. null when b is 0 or missing.
export const costDelta = (a, b) => (a && b && b.cost ? (a.cost - b.cost) / b.cost : null);
const pct = (d) => (d == null ? 'n/a' : `${d > 0 ? '+' : ''}${(d * 100).toFixed(0)}%`);

export function report(rows, meta) {
  const L = [];
  const by = (st) => rows.filter((r) => statusOf(r) === st);
  const invalid = by('invalid');
  const limited = by('usage-limit');
  L.push(`# bench report (${meta.model}, spent $${meta.spent.toFixed(3)} of $${meta.budget})`, '');
  if (meta.biasNote) L.push(`NOTE (selection bias): ${SELECTION_BIAS_NOTE}`, '');
  if (meta.skillsBiasNote) L.push(`NOTE (selection bias, concept skills): ${SKILLS_BIAS_NOTE}`, '');
  if (meta.stop) L.push(`STOPPED: ${meta.stop}`, '');
  if (meta.rerunOf) L.push(`Rerun of ${meta.rerunOf}: its rows are merged into the tables below.`, '');
  if (limited.length) {
    L.push(`## USAGE-LIMIT RUNS (${limited.length}, not counted; rerun them with \`node bench/run.mjs --rerun <results dir>\`)`, '');
    for (const r of limited) L.push(`- ${r.case} ${r.arm} run${r.run}: account usage limit (429), cost $${f(r.m.cost, 3)}`);
    L.push('');
  }
  if (invalid.length) {
    L.push(`## INVALID RUNS (${invalid.length}, not counted)`, '');
    for (const r of invalid) for (const p of r.problems) L.push(`- ${r.case} ${r.arm} run${r.run}: ${p}`);
    L.push('');
  } else if (rows.length) L.push('No invalid run: no Bash failures, init events match their arm.', '');
  if (meta.missing && meta.missing.length) {
    L.push(`## NOT RUN (${meta.missing.length} planned runs have no counted result)`, '');
    for (const p of meta.missing) L.push(`- ${p.case} ${p.arm} run${p.run}`);
    L.push('');
  }
  L.push('## Per case and arm', '');
  L.push('| case | arm | run | valid | cost $ | turns | in tok | out tok | cache read | cache create | Read | Grep | Glob | Bash | Skill | code-graph calls (exit:chars) | skills loaded | score |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const m = r.m;
    const calls = m.graphCalls.length ? m.graphCalls.map((c) => `${c.exit}:${c.chars}`).join(' ') : '-';
    const loaded = (m.skillCalls || []).length ? m.skillCalls.join(' ') : '-';
    L.push(`| ${r.case} | ${r.arm} | ${r.run} | ${STATUS_CELL[statusOf(r)]} | ${f(m.cost, 3)} | ${m.turns ?? 'n/a'} | ${m.input} | ${m.output} | ${m.cacheRead} | ${m.cacheCreate} | ${m.counts.Read} | ${m.counts.Grep} | ${m.counts.Glob} | ${m.counts.Bash} | ${m.counts.Skill} | ${calls} | ${loaded} | ${r.sc.hits}/${r.sc.of} |`);
  }
  const sumRow = (label, arm, s) => `| ${label} | ${arm} | ${s.n} | ${f(s.cost, 3)} | ${s.turns} | ${s.input} / ${s.output} | ${s.cacheRead} / ${s.cacheCreate} | ${s.Read}/${s.Grep}/${s.Glob}/${s.Bash}/${s.Skill} | ${s.hits}/${s.of} |`;
  const head = (first) => [`| ${first} | arm | valid runs | cost $ | turns | in / out tok | cache read / create | Read/Grep/Glob/Bash/Skill | pass |`, '|---|---|---|---|---|---|---|---|---|'];
  const perCase = sums(rows, (r) => `${r.case}|${r.arm}`);
  if (perCase.size) {
    L.push('', '## Sums per case and arm (valid runs only)', '', ...head('case'));
    for (const [k, s] of perCase) { const [c, a] = k.split('|'); L.push(sumRow(c, a, s)); }
  }
  // Per kind (question group): needs the case -> kind map, given by run.mjs.
  const kindOf = meta.kinds || {};
  const perKind = sums(rows, (r) => (kindOf[r.case] ? `${kindOf[r.case]}|${r.arm}` : null));
  if (perKind.size) {
    L.push('', '## Sums per question group and arm (valid runs only)', '', ...head('group'));
    const kinds = [...new Set([...perKind.keys()].map((k) => k.split('|')[0]))];
    for (const k of kinds) for (const a of ARMS) if (perKind.has(`${k}|${a}`)) L.push(sumRow(k, a, perKind.get(`${k}|${a}`)));
    L.push('', '| group | oracle vs nograph (cost) | graph vs oracle (cost) | skills vs noskills (cost) |', '|---|---|---|---|');
    for (const k of kinds) {
      const g = (a) => perKind.get(`${k}|${a}`);
      L.push(`| ${k} | ${pct(costDelta(g('oracle'), g('nograph')))} | ${pct(costDelta(g('graph'), g('oracle')))} | ${pct(costDelta(g('skills'), g('noskills')))} |`);
    }
    L.push('', 'Totals compare only when both arms have the same number of valid runs per question; check the valid-runs column.');
  }
  // 042: concept skills against none, per case, and whether the skills arm loaded the covering skill.
  const skillCases = [...new Set([...perCase.keys()].filter((k) => /\|(no)?skills$/.test(k)).map((k) => k.split('|')[0]))];
  if (skillCases.length) {
    const loads = coveringLoads(rows, meta.covering || {});
    L.push('', '## skills vs noskills per case (valid runs only)', '');
    L.push('| case | skills cost $ (runs) | noskills cost $ (runs) | skills vs noskills (cost) | skills pass | noskills pass | covering skill loaded (skills arm) |', '|---|---|---|---|---|---|---|');
    for (const c of skillCases) {
      const s = perCase.get(`${c}|skills`); const n = perCase.get(`${c}|noskills`); const l = loads.get(c);
      const cell = (x) => (x ? `${f(x.cost, 3)} (${x.n})` : 'n/a');
      const pass = (x) => (x ? `${x.hits}/${x.of}` : 'n/a');
      L.push(`| ${c} | ${cell(s)} | ${cell(n)} | ${pct(costDelta(s, n))} | ${pass(s)} | ${pass(n)} | ${l ? `${l.loaded}/${l.runs} (${l.skills.join(', ')})` : '-'} |`);
    }
  }
  return L.join('\n') + '\n';
}

// Pass rule for the fixture check: graph arm has a code-graph call exiting 0 with output, no run
// has a Bash failure, no-graph init shows no code-graph plugin (all covered by validity()).
// Case selection: --only matches the id, --group matches the case's `group` field (cases without one
// never match a --group), --set matches one entry of the case's `sets` list exactly (042: the named
// question set of one ticket's run); all given = all must match. An empty filter does not filter.
export function selectCases(cases, { only = '', group = '', set = '' } = {}) {
  return cases.filter((c) => (!only || c.id.includes(only)) && (!group || (c.group || '').includes(group)) && (!set || (c.sets || []).includes(set)));
}

// Cases still awaiting the user's approval (a `proposal` field): the runner refuses to spend on them.
export const proposals = (cases) => cases.filter((c) => c.proposal);

// Without opts: the fixture check (nograph + graph ran, every run valid, a real code-graph call).
// With `planned`: every planned run has a valid row, every planned arm ran, and the graph call is
// required only when `needGraphCall` (an oracle plan measures the graph arm's friction, so a graph run
// that never calls the CLI is a result, not a failure). Usage-limit rows are not counted either way.
export function checkVerdict(rows, { planned = null, needGraphCall = true } = {}) {
  const counted = rows.filter((r) => statusOf(r) !== 'usage-limit');
  const graph = counted.filter((r) => r.arm === 'graph');
  const realCall = graph.some((r) => r.m.graphCalls.some((c) => c.exit === 0 && c.chars > 0));
  const allValid = counted.length > 0 && counted.every((r) => statusOf(r) === 'valid');
  const arms = planned ? [...new Set(planned.map((p) => p.arm))] : ['nograph', 'graph'];
  const bothArms = arms.every((a) => counted.some((r) => r.arm === a));
  const have = new Set(counted.map((r) => `${r.case}|${r.arm}|${r.run}`));
  const complete = !planned || planned.every((p) => have.has(`${p.case}|${p.arm}|${p.run}`));
  const callOk = !needGraphCall || realCall;
  return { pass: callOk && allValid && bothArms && complete, realCall, allValid, bothArms, complete };
}
