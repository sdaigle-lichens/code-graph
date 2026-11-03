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
  appendSystemPrompt: '--append-system-prompt', // 044: the maestro agent file's body (edit cases)
  tools: '--tools', // 044 edit cases: the only tools that exist in the session (bypassPermissions would allow any listed one)
};

export const ALLOWED_TOOLS = 'Bash,Read,Grep,Glob,Skill';
export const EDIT_TOOLS = 'Edit,Write'; // added for edit cases only (044)
export const OK_CG_EXITS = new Set([0, 4, 6, 7]); // documented code-graph exits (docs/usage.md)

// Arms, in the order they run per case. `oracle` = the nograph workspace and flags (no plugin, no
// scribe-output/), with the case's stored graph output appended to the question. `skills` (042) =
// the nograph workspace as is (concept skills present); `noskills` = the same workspace with every
// concept skill removed from .claude/skills (bench/strip-concept-skills.mjs), other skills kept.
// 044 model arms: each pins its own model and behaves like its `base` arm in every other respect
// (workspace, flags, validity). `--model` keeps setting the model of the other arms.
export const MODEL_ARMS = {
  'haiku-nograph': { base: 'nograph', model: 'claude-haiku-5-5' },
  'haiku-graph': { base: 'graph', model: 'claude-haiku-5-5' },
  'sonnet-nograph': { base: 'nograph', model: 'claude-sonnet-5-5' },
  // 051: concept skills stripped / stored graph output pasted into the prompt, on Haiku.
  'haiku-noskills': { base: 'noskills', model: 'claude-haiku-5-5' },
  'haiku-oracle': { base: 'oracle', model: 'claude-haiku-5-5' },
};
export const ARMS = ['nograph', 'oracle', 'graph', 'skills', 'noskills', ...Object.keys(MODEL_ARMS)];
export const DEFAULT_ARMS = 'nograph,graph';
export const SKILL_ARMS = new Set(['skills', 'noskills']);

// The arm an arm behaves as: a model arm's base, else itself.
export const baseArm = (arm) => MODEL_ARMS[arm]?.base ?? arm;
// The model an arm runs: a model arm's own, else the --model value.
export const modelFor = (arm, model) => MODEL_ARMS[arm]?.model ?? model;
export const isGraphArm = (arm) => baseArm(arm) === 'graph';

// The arm a case's setup command is built for ({ARM}): only the graph arm gets a graph, only the
// noskills arm loses its concept skills; every other arm gets the nograph workspace.
export const setupArm = (arm) => (isGraphArm(arm) || baseArm(arm) === 'noskills' ? baseArm(arm) : 'nograph');

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

export const isOracleArm = (arm) => baseArm(arm) === 'oracle';

export function promptFor(arm, c, oracleText) {
  return isOracleArm(arm) ? oraclePrompt(c.question, oracleText) : c.question;
}

// 051 context check: the stored graph output is in the prompt of the oracle-based arm and of no other
// (the init event carries no prompt, so the runner checks the prompt it is about to send). Empty = ok.
export function promptProblems(arm, prompt) {
  const text = String(prompt ?? '');
  const has = text.includes(ORACLE_HEADER) || text.includes('<code-index>');
  if (isOracleArm(arm) && !has) return [`the ${arm} arm's prompt carries no stored graph output`];
  if (!isOracleArm(arm) && has) return [`the ${arm} arm's prompt carries stored graph output (only an oracle arm may)`];
  return [];
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
        if (isGraphArm(arm) && graphCases.length && !graphCases.some((s) => c.id.includes(s))) continue;
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

// `edit` (044 edit cases) adds Edit and Write to the allowed tools; `systemPrompt` (the maestro
// agent file's body) is appended to Claude Code's system prompt, as the agent's prompt would be.
// Edit cases run under bypassPermissions, not dontAsk: `.claude/` is a protected path that neither an
// allow rule nor dontAsk lets Edit/Write touch, and the scribe cases edit `.claude/skills`. `--tools`
// then limits the session to the allowed tools, and validity() checks the init event's tool list.
export function claudeArgs(arm, prompt, { model, runBudget, pluginDir, edit = false, systemPrompt = '' }) {
  const tools = edit ? `${ALLOWED_TOOLS},${EDIT_TOOLS}` : ALLOWED_TOOLS;
  const a = [
    FLAGS.print, prompt,
    FLAGS.model, modelFor(arm, model),
    FLAGS.outputFormat, 'stream-json', FLAGS.verbose,
    FLAGS.maxBudget, String(runBudget),
    FLAGS.noSessionPersistence,
    FLAGS.allowedTools, tools,
    FLAGS.permissionMode, edit ? 'bypassPermissions' : 'dontAsk',
    FLAGS.settingSources, 'project,local',
    FLAGS.strictMcpConfig,
  ];
  if (edit) a.push(FLAGS.tools, tools);
  if (systemPrompt) a.push(FLAGS.appendSystemPrompt, systemPrompt);
  if (isGraphArm(arm)) a.push(FLAGS.pluginDir, pluginDir);
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

// 043: a non-zero exit from these read-only commands (alone or chained only with each other) is recorded
// but does not invalidate a run: grep with no match exits 1, a sed address past the end of a file too.
const READ_ONLY_CMDS = new Set(['grep', 'egrep', 'fgrep', 'sed', 'rg', 'cat', 'head', 'tail', 'ls', 'find']);

// Split on unquoted && || ; | & and newlines. Returns null when the command has unquoted command
// substitution, backticks, or a redirection other than to /dev/null or a file descriptor (it may write).
function splitSegments(cmd) {
  const segs = [];
  let cur = '';
  let q = '';
  const s = String(cmd);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = '';
      else if (q === '"' && (c === '`' || (c === '$' && s[i + 1] === '('))) return null;
      else if (c === '\\' && q === '"') { cur += c + (s[i + 1] || ''); i++; continue; }
      cur += c;
      continue;
    }
    if (c === '\\') { cur += c + (s[i + 1] || ''); i++; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '`' || (c === '$' && s[i + 1] === '(') || c === '(' || c === '<') return null;
    if (c === '>') {
      const rest = s.slice(i).replace(/^>>?\s*/, '');
      if (/^&\d/.test(s.slice(i + 1)) && !/^>>/.test(s.slice(i))) { i += 1; while (/[\d&-]/.test(s[i + 1] || '')) i++; continue; }
      if (!/^\/dev\/null(\s|$|[;&|])/.test(rest)) return null;
      i += s.slice(i).length - rest.length + '/dev/null'.length - 1;
      continue;
    }
    if (c === '&' || c === '|' || c === ';' || c === '\n') {
      segs.push(cur);
      cur = '';
      if ((c === '&' || c === '|') && s[i + 1] === c) i++;
      continue;
    }
    cur += c;
  }
  segs.push(cur);
  return q ? null : segs.map((x) => x.trim()).filter(Boolean);
}

// True when every segment of the command runs one of READ_ONLY_CMDS (sed only without -i).
export function isReadOnly(cmd) {
  const segs = splitSegments(cmd);
  if (!segs || !segs.length) return false;
  return segs.every((seg) => {
    const t = seg.split(/\s+/);
    const name = t[0].replace(/^.*\//, '');
    if (!READ_ONLY_CMDS.has(name)) return false;
    if (name === 'sed' && t.slice(1).some((a) => /^-[a-zA-Z]*i|^--in-place/.test(a))) return false;
    if (name === 'find' && t.some((a) => /^-(delete|exec|execdir|ok|okdir|fprint\w*|fls)$/.test(a))) return false;
    return true;
  });
}

const textOf =(c) => (typeof c === 'string' ? c : (c || []).map((x) => x.text || '').join(''));

// The error text of a failed Edit/Write, without the input Claude Code echoes back: "String to replace
// not found in file.\nString: <old_string>" repeats the document, and the graded docs mention
// permissions, so a model's miss must not read as a permission refusal.
export const editErrorHead = (t) => String(t).split(/(?:^|\n)\s*(?:String|old_string|new_string|content)\s*:/i)[0];

// Parse one stream-json transcript into metrics.
export function parseStream(text) {
  const m = {
    init: null, cost: null, turns: null, isError: null, answer: '',
    input: 0, output: 0, cacheRead: 0, cacheCreate: 0,
    counts: { Read: 0, Grep: 0, Glob: 0, Bash: 0, Skill: 0 },
    editCounts: { Edit: 0, Write: 0 }, // 044 edit cases
    editDenials: [], // Edit/Write calls the permission layer refused: the harness, not the model, failed
    bashExits: [], // every non-zero Bash exit, as `exit:command` (edit cases report them; they do not invalidate there)
    bashFailures: [], // non-code-graph failures or seccomp: these invalidate the run
    readOnlyFailures: [], // non-zero exits of read-only grep/sed/rg/cat/head/tail/ls/find: recorded, not invalidating
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
        if (b.name in m.editCounts) m.editCounts[b.name]++;
        if (b.name === 'Skill' && b.input) {
          const s = b.input.skill ?? b.input.name ?? b.input.command;
          if (typeof s === 'string' && s.trim()) m.skillCalls.push(s.trim().replace(/^\//, ''));
        }
      } else if (b.type === 'tool_result') {
        const t = idToTool.get(b.tool_use_id);
        if (t && t.name in m.editCounts && b.is_error && /permission|denied|not allowed/i.test(editErrorHead(textOf(b.content)))) {
          m.editDenials.push(`${t.name} ${String(t.input?.file_path || '').slice(-80)} -> ${textOf(b.content).replace(/\s+/g, ' ').slice(0, 100)}`);
        }
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
        if (exit !== 0 || b.is_error) m.bashExits.push(`${exit}:${cmd.replace(/\s+/g, ' ').slice(0, 60)}`);
        if (seccomp || ((exit !== 0 || b.is_error) && !okCg)) {
          const entry = `${cmd.replace(/\s+/g, ' ').slice(0, 80)} -> ${out.replace(/\s+/g, ' ').slice(0, 100)}`;
          if (!seccomp && !cg && isReadOnly(cmd)) m.readOnlyFailures.push(entry);
          else m.bashFailures.push(entry);
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
// An Edit/Write the permission layer refused always invalidates (see below).
// `edit` (044 edit cases): a failing Bash call does not invalidate the run. Writing tests means
// running them while they still fail, and a missing tool (no vitest, no ts-morph) is part of the
// task; the outcome grading judges the work. Seccomp still invalidates. A model arm is checked as
// its base arm.
export function validity(arm, m, expectSkills = [], { keepSkills = [], edit = false } = {}) {
  const p = [];
  if (m.seccomp) p.push(`apply-seccomp in ${m.seccomp} Bash call(s): nested sandbox, the CLI never ran`);
  if (!edit) for (const f of m.bashFailures) if (!/apply-seccomp/.test(f)) p.push(`Bash failure: ${f}`);
  // A refused Edit/Write (e.g. a protected .claude/ path under dontAsk) means the arm could not do the
  // task at all: a harness problem, never a model result.
  for (const d of m.editDenials || []) p.push(`edit refused by the permission layer: ${d}`);
  arm = baseArm(arm);
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
    // Edit cases run under bypassPermissions, so any tool the session has is usable: it must have
    // only the allowed ones (else `--tools` was ignored and arms could differ in tools).
    if (edit && Array.isArray(m.init.tools)) {
      const allowed = new Set(`${ALLOWED_TOOLS},${EDIT_TOOLS}`.split(','));
      const extra = m.init.tools.filter((t) => !allowed.has(t));
      if (extra.length) p.push(`init lists tools beyond the allowed set under bypassPermissions: ${extra.join(', ')}`);
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

// --- 044 edit cases: the model edits the workspace, the harness grades the files it leaves ---

export const isEditCase = (c) => Boolean(c && c.edit);
export const EDIT_KINDS = new Set(['test', 'scribe']);

// The body of a Claude Code agent file, frontmatter removed: the prompt the agent runs with.
export function agentBody(text) {
  const s = String(text ?? '');
  const fm = /^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(s);
  const body = (fm ? s.slice(fm[0].length) : s).trim();
  if (!body) throw new Error('the agent file has no body');
  return body;
}

// Replace the single occurrence of `from`. Throws on zero or several, so a planted change or a mutant
// can neither silently not apply nor land somewhere unintended.
export function replaceOnce(text, from, to, label = 'replace') {
  const i = from ? text.indexOf(from) : -1;
  const n = i === -1 ? 0 : text.indexOf(from, i + 1) === -1 ? 1 : 2;
  if (n !== 1) throw new Error(`${label}: expected exactly one occurrence of ${JSON.stringify(String(from).slice(0, 60))}, found ${n === 0 ? 'none' : 'several'}`);
  return text.slice(0, i) + to + text.slice(i + from.length);
}

// `pass N` and `fail N` from the summary `node --test` prints: `# ` under the TAP reporter, `ℹ ` under
// the spec reporter (the default on some Node versions even when piped). Null when a line is absent.
export function nodeTestSummary(out) {
  const num = (k) => { const m = new RegExp(`^(?:#|ℹ) ${k} (\\d+)\\s*$`, 'm').exec(String(out ?? '')); return m ? Number(m[1]) : null; };
  return { pass: num('pass'), fail: num('fail') };
}

// A suite run is green when it exited 0 with at least one passing test and none failing.
export const isGreen = (r) => Boolean(r && r.status === 0 && r.pass > 0 && !r.fail);

// Test-case grade: 1 point for a suite that is green on the original code, plus 1 per mutant whose run
// is not green (the suite caught the planted bug). Mutants count only when the original run is green:
// a red or missing suite "catches" every mutant, so it scores 0 of 1 + mutants.
export function gradeTestRun({ exists, original, mutants = [] }) {
  const of = 1 + mutants.length;
  if (!exists) return { hits: 0, of, detail: 'no test file' };
  if (!isGreen(original)) {
    const why = original?.timedOut ? 'timed out' : `exit ${original?.status}, pass ${original?.pass ?? '?'}, fail ${original?.fail ?? '?'}`;
    return { hits: 0, of, detail: `not green on the original (${why})` };
  }
  const killed = mutants.filter((x) => !isGreen(x)).map((x) => x.id);
  const survived = mutants.filter((x) => isGreen(x)).map((x) => x.id);
  return {
    hits: 1 + killed.length,
    of,
    detail: `green (${original.pass} pass); killed ${killed.join(',') || '-'}; survived ${survived.join(',') || '-'}`,
  };
}

// Scribe-case grade. spec = { file: { must: [regex], must_not: [regex] } }, docs = { file: text|null }.
// 1 point per `must` regex the file matches and per `must_not` regex it does not. A missing or empty
// file scores 0 on all of its regexes (deleting a stale doc is not a fix).
export function gradeDocs(spec, docs) {
  let hits = 0;
  let of = 0;
  const parts = [];
  for (const [file, { must = [], must_not: mustNot = [] }] of Object.entries(spec)) {
    const text = docs[file];
    of += must.length + mustNot.length;
    if (!text || !String(text).trim()) { parts.push(`${file}: missing`); continue; }
    const missed = must.filter((re) => !new RegExp(re, 'i').test(text));
    const stale = mustNot.filter((re) => new RegExp(re, 'i').test(text));
    hits += must.length - missed.length + mustNot.length - stale.length;
    if (missed.length || stale.length) parts.push(`${file}: ${missed.length ? `missing ${missed.length}/${must.length}` : ''}${missed.length && stale.length ? ', ' : ''}${stale.length ? `stale ${stale.length}/${mustNot.length}` : ''}`);
  }
  return { hits, of, detail: parts.length ? parts.join('; ') : 'all facts right, nothing stale' };
}

// Shape problems of an edit case (empty list = well formed). The replacement texts themselves are
// checked against the pinned tree by bench/edit-check.mjs.
export function editCaseProblems(c) {
  const p = [];
  const e = c.edit;
  const rep = (x) => x && typeof x.file === 'string' && typeof x.from === 'string' && x.from && typeof x.to === 'string' && x.from !== x.to;
  if (!EDIT_KINDS.has(c.kind)) p.push(`kind must be test or scribe, not ${c.kind}`);
  if (c.agent !== c.kind) p.push('agent must name the maestro agent of the same kind');
  if (!c.graph_contribution) p.push('graph_contribution is missing');
  for (const x of e.plant || []) if (!rep(x)) p.push(`bad plant entry ${JSON.stringify(x)}`);
  if (c.kind === 'test') {
    if (!/\.node\.test\.ts$/.test(e.test || '')) p.push('edit.test must be a .node.test.ts path');
    if (!(e.mutants || []).length) p.push('a test case needs at least one mutant');
    for (const x of e.mutants || []) if (!rep(x) || !x.id) p.push(`bad mutant ${JSON.stringify(x)}`);
    if (!String(c.question).includes(e.test || '\0')) p.push('the prompt must name the test file');
  }
  if (c.kind === 'scribe') {
    if (!(e.plant || []).length) p.push('a scribe case needs a planted code change');
    const docs = Object.entries(e.docs || {});
    if (!docs.length) p.push('a scribe case needs edit.docs');
    for (const [f, d] of docs) if (!(d.must || []).length || !(d.must_not || []).length) p.push(`${f}: needs must and must_not`);
  }
  return p;
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
  const models = Object.entries(meta.models || {});
  const modelLabel = models.length && models.some(([, m]) => m !== meta.model)
    ? models.map(([a, m]) => `${a}=${m}`).join(', ')
    : meta.model;
  L.push(`# bench report (${modelLabel}, spent $${meta.spent.toFixed(3)} of $${meta.budget})`, '');
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
  L.push(...editSection(rows));
  return L.join('\n') + '\n';
}

// 044: what each edit run left behind (the score column above is its grade), its Edit/Write calls,
// its non-zero Bash exits (they do not invalidate an edit run) and a per-arm total against cost.
export function editSection(rows) {
  const edits = rows.filter((r) => r.edit);
  if (!edits.length) return [];
  const L = ['', '## Edit grading (044)', ''];
  L.push('| case | arm | run | valid | points | grade detail | Edit/Write | protected files restored | non-zero Bash exits |', '|---|---|---|---|---|---|---|---|---|');
  const cell = (s) => String(s).replace(/\|/g, '\\|');
  for (const r of edits) {
    const ec = r.m.editCounts || { Edit: 0, Write: 0 };
    const exits = r.m.bashExits || [];
    L.push(`| ${r.case} | ${r.arm} | ${r.run} | ${STATUS_CELL[statusOf(r)]} | ${r.sc.hits}/${r.sc.of} | ${cell(r.edit.detail || '-')} | ${ec.Edit}/${ec.Write} | ${(r.edit.restored || []).join(', ') || '-'} | ${exits.length ? cell(exits.slice(0, 4).join('; ')) + (exits.length > 4 ? ` (+${exits.length - 4})` : '') : '-'} |`);
  }
  const perArm = sums(edits, (r) => r.arm);
  L.push('', '| arm | valid runs | points | points % | cost $ | cost $ per run |', '|---|---|---|---|---|---|');
  for (const a of ARMS) {
    const s = perArm.get(a);
    if (s) L.push(`| ${a} | ${s.n} | ${s.hits}/${s.of} | ${s.of ? f((100 * s.hits) / s.of) : 'n/a'}% | ${f(s.cost, 3)} | ${f(s.cost / s.n, 3)} |`);
  }
  L.push('', 'Points compare only across arms with the same valid runs per case; the decision rule is in docs/evals.md (Ticket 044).');
  return L;
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
  const graph = counted.filter((r) => isGraphArm(r.arm));
  const realCall = graph.some((r) => r.m.graphCalls.some((c) => c.exit === 0 && c.chars > 0));
  const allValid = counted.length > 0 && counted.every((r) => statusOf(r) === 'valid');
  const arms = planned ? [...new Set(planned.map((p) => p.arm))] : ['nograph', 'graph'];
  const bothArms = arms.every((a) => counted.some((r) => r.arm === a));
  const have = new Set(counted.map((r) => `${r.case}|${r.arm}|${r.run}`));
  const complete = !planned || planned.every((p) => have.has(`${p.case}|${p.arm}|${p.run}`));
  const callOk = !needGraphCall || realCall;
  return { pass: callOk && allValid && bothArms && complete, realCall, allValid, bothArms, complete };
}
