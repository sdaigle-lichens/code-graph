// 066 review mode: pure helpers for bench/review-run.mjs and bench/review-prep.mjs (arms, prompts,
// diff and primer building, graders, validity, verdicts). No filesystem, no child process.
import { FLAGS, replaceOnce } from './lib.mjs';

// ---- arms -----------------------------------------------------------------------------------------

export const SONNET = 'claude-sonnet-5-5';
export const HAIKU = 'claude-haiku-5-5';
export const REVIEW_TOOLS = 'Bash,Read,Grep,Glob,Skill';
export const SPAWN_TOOLS = `${REVIEW_TOOLS},Agent`;

// Every review arm runs in the no-graph workspace (maestro's concept skills, no plugin, no scribe-output).
// `primer`: the stored diff primer is appended to the prompt. `spawn`: the reviewer is told to hand the
// impact pass to a Haiku subagent, and the Agent tool exists in that arm only.
export const REVIEW_ARMS = {
  'sonnet-nograph': { model: SONNET, primer: false, spawn: false },
  'sonnet-diff-primer': { model: SONNET, primer: true, spawn: false },
  'haiku-diff-primer': { model: HAIKU, primer: true, spawn: false },
  'sonnet-spawns-haiku': { model: SONNET, primer: false, spawn: true },
  'haiku-nograph': { model: HAIKU, primer: false, spawn: false }, // separates the model effect from the primer effect
};
export const REVIEW_ARM_NAMES = Object.keys(REVIEW_ARMS);
// 067: the planned arms after both pilot A screens saturated. `sonnet-diff-primer` (a primer cannot lift a
// baseline at the ceiling) and `sonnet-spawns-haiku` stay defined (prompts, tool sets and the spawn-validity
// check are tested) but are left out of the plan; add them with `--arms`.
export const DEFAULT_REVIEW_ARMS = 'sonnet-nograph,haiku-nograph,haiku-diff-primer';
export const DEFAULT_RUNS = '3';
export const DEFAULT_BUDGET = '13';
export const BASELINE = 'sonnet-nograph';

export function parseReviewArms(s) {
  const want = String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const bad = want.filter((a) => !REVIEW_ARMS[a]);
  if (bad.length) throw new Error(`unknown review arm(s): ${bad.join(', ')} (known: ${REVIEW_ARM_NAMES.join(', ')})`);
  if (!want.length) throw new Error('no arm given');
  return REVIEW_ARM_NAMES.filter((a) => want.includes(a));
}

export const toolsFor = (arm) => (REVIEW_ARMS[arm].spawn ? SPAWN_TOOLS : REVIEW_TOOLS);

// `--tools` makes the session's tool set exact, so only the spawn arm has the Agent tool.
export function reviewArgs(arm, prompt, { runBudget }) {
  const tools = toolsFor(arm);
  return [
    FLAGS.print, prompt,
    FLAGS.model, REVIEW_ARMS[arm].model,
    FLAGS.outputFormat, 'stream-json', FLAGS.verbose,
    FLAGS.maxBudget, String(runBudget),
    FLAGS.noSessionPersistence,
    FLAGS.allowedTools, tools,
    FLAGS.tools, tools,
    FLAGS.permissionMode, 'dontAsk',
    FLAGS.settingSources, 'project,local',
    FLAGS.strictMcpConfig,
  ];
}

// ---- prompts --------------------------------------------------------------------------------------

export const PRIMER_OPEN = '<diff-primer>';
export const PRIMER_CLOSE = '</diff-primer>';

const BASE_PROMPT = (diff) => `You are reviewing a code change to the maestro repository in the current directory. The change is already applied in the working tree. Check the diff for real defects: bugs, calls the change breaks elsewhere, broken invariants. Do not report style or naming. Look beyond the diff when the change could affect other code.

<diff>
${diff.trim()}
</diff>`;

const FORMAT = `Finish with a section that starts with the line \`FINDINGS:\` followed by one line per defect, in the form \`- <file path>: <the defect, in one or two sentences>\`. If you find no defect, write \`FINDINGS: none\`.`;

const SPAWN_PARAGRAPH = `Hand the impact and blast-radius pass to a Haiku subagent: use the Agent tool with the model set to \`haiku\`, and ask it to list, for each changed symbol, its callers and dependents (file and line, and what each passes or expects), and any import the change adds. Then judge the diff and its report yourself.`;

export function reviewPrompt(arm, diff, primer = '') {
  const a = REVIEW_ARMS[arm];
  if (!a) throw new Error(`unknown review arm ${arm}`);
  const parts = [BASE_PROMPT(diff)];
  if (a.primer) {
    if (!String(primer).trim()) throw new Error('a primer arm needs the stored primer');
    parts.push(`${PRIMER_OPEN}\nFacts computed from the code index of the repository before the change. They are leads, not verdicts: check them against the source.\n\n${String(primer).trim()}\n${PRIMER_CLOSE}`);
  }
  if (a.spawn) parts.push(SPAWN_PARAGRAPH);
  parts.push(FORMAT);
  return parts.join('\n\n');
}

// The primer is in the prompt of the primer arms and of no other arm.
export function promptProblems(arm, prompt) {
  const has = String(prompt).includes(PRIMER_OPEN);
  if (REVIEW_ARMS[arm].primer && !has) return [`the ${arm} arm's prompt carries no diff primer`];
  if (!REVIEW_ARMS[arm].primer && has) return [`the ${arm} arm's prompt carries a diff primer (only a primer arm may)`];
  const spawnText = String(prompt).includes('Haiku subagent');
  if (REVIEW_ARMS[arm].spawn !== spawnText) return [`the ${arm} arm's prompt ${spawnText ? 'tells the reviewer to spawn a subagent' : 'lacks the spawn instruction'}`];
  return [];
}

// ---- diffs ----------------------------------------------------------------------------------------

const lines = (t) => { const a = t.split('\n'); if (a[a.length - 1] === '') a.pop(); return a; };

// One-hunk unified diff of before -> after (3 lines of context), plus where the change sits in the OLD
// file (what the code index knows): lo..hi are 1-based old line numbers; a pure insertion touches the
// two lines around it. Throws when nothing changed.
export function unifiedDiff(path, before, after, ctx = 3) {
  if (before === after) throw new Error(`${path}: no change`);
  const a = lines(before);
  const b = lines(after);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const ma = a.slice(p, a.length - s);
  const mb = b.slice(p, b.length - s);
  if (ma.length * mb.length > 4e6) throw new Error(`${path}: change too large to diff`);
  // Longest common subsequence of the changed middle, so an unchanged stretch between two edits stays context.
  const lcs = Array.from({ length: ma.length + 1 }, () => new Array(mb.length + 1).fill(0));
  for (let i = ma.length - 1; i >= 0; i--) for (let j = mb.length - 1; j >= 0; j--) lcs[i][j] = ma[i] === mb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const ops = []; // [kind, text, oldIndex0]
  let i = 0;
  let j = 0;
  while (i < ma.length || j < mb.length) {
    if (i < ma.length && j < mb.length && ma[i] === mb[j]) { ops.push([' ', ma[i], p + i]); i++; j++; }
    else if (i < ma.length && (j === mb.length || lcs[i + 1][j] >= lcs[i][j + 1])) { ops.push(['-', ma[i], p + i]); i++; }
    else { ops.push(['+', mb[j], p + i]); j++; }
  }
  let lo = Infinity;
  let hi = 0;
  let inDel = false; // an added line right after removed ones replaces them: the removed lines already mark the range
  for (const [k, , o] of ops) {
    if (k === ' ') inDel = false;
    if (k === '-') { inDel = true; lo = Math.min(lo, o + 1); hi = Math.max(hi, o + 1); }
    else if (k === '+' && !inDel) { lo = Math.min(lo, Math.max(1, o)); hi = Math.max(hi, Math.min(a.length, o + 1)); }
  }
  const start = Math.max(0, p - ctx);
  const tail = a.slice(a.length - s, Math.min(a.length, a.length - s + ctx));
  const body = [...a.slice(start, p).map((x) => ` ${x}`), ...ops.map(([k, x]) => `${k}${x}`), ...tail.map((x) => ` ${x}`)];
  const oldN = body.filter((x) => x[0] !== '+').length;
  const newN = body.filter((x) => x[0] !== '-').length;
  const text = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, `@@ -${start + 1},${oldN} +${start + 1},${newN} @@`, ...body].join('\n') + '\n';
  return { text, lo, hi, added: ops.filter(([k]) => k === '+').map(([, x]) => x), before };
}

// The diff of a case's planted replacements ([{ file, from, to }]) against the tree `read(file)` returns.
// Replacements to one file are applied in order and diffed together. Returns the diff text and, per file,
// the changed old-line range and the added lines.
export function diffForPlants(read, plants, label = 'plant') {
  const files = [...new Set(plants.map((x) => x.file))];
  const changes = [];
  const out = [];
  for (const file of files) {
    const before = read(file);
    const after = plants.filter((x) => x.file === file).reduce((t, x) => replaceOnce(t, x.from, x.to, `${label} ${file}`), before);
    const d = unifiedDiff(file, before, after);
    out.push(d.text);
    changes.push({ file, lo: d.lo, hi: d.hi, added: d.added, before });
  }
  return { diff: out.join(''), changes };
}

// ---- primer ---------------------------------------------------------------------------------------

// `query file` output -> [{ name, type, concept, start, end }]
export function parseFileVertices(text) {
  const out = [];
  for (const m of String(text).matchAll(/^## `([^`]+)` \(([^,)]+), ([^)]+)\) — L(\d+)-(\d+)/gm)) {
    out.push({ name: m[1], type: m[2], concept: m[3], start: Number(m[4]), end: Number(m[5]) });
  }
  return out;
}

// `query impact` output -> { direct, indirect }, each [{ file, line, name }] without duplicates.
export function parseImpact(text) {
  const t = String(text);
  const cut = t.search(/^## Indirect/m);
  const part = (s) => {
    const seen = new Set();
    const out = [];
    for (const m of s.matchAll(/^- @(\S+?):(\d+) — `([^`]+)`/gm)) {
      const k = `${m[1]}:${m[2]}:${m[3]}`;
      if (!seen.has(k)) { seen.add(k); out.push({ file: m[1], line: Number(m[2]), name: m[3] }); }
    }
    return out;
  };
  return cut === -1 ? { direct: part(t), indirect: [] } : { direct: part(t.slice(0, cut)), indirect: part(t.slice(cut)) };
}

// Indexed symbols whose line range overlaps the changed old-line range.
export const changedSymbols = (vertices, lo, hi) => vertices.filter((v) => v.start <= hi && v.end >= lo);

// Relative import specifiers in the added lines that the file did not import before.
export function addedImports(change) {
  const spec = (t) => [...String(t).matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)].map((m) => m[1]);
  const old = new Set(spec(change.before));
  return [...new Set(spec(change.added.join('\n')))].filter((s) => !old.has(s));
}

// `./x.js` imported from `from` (a posix repo path) -> candidate repo paths.
export function importCandidates(from, specifier) {
  const parts = from.split('/').slice(0, -1);
  for (const seg of specifier.replace(/\.js$/, '').split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  const base = parts.join('/');
  return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`];
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Callers whose name no test text mentions.
export const untestedCallers = (callers, testCorpus) => callers.filter((c) => !new RegExp(`(?<![A-Za-z0-9_$])${esc(c.name)}(?![A-Za-z0-9_$])`).test(testCorpus));

export const clip = (text, maxLines = 30) => {
  const l = String(text).trimEnd().split('\n');
  return l.length <= maxLines ? l.join('\n') : `${l.slice(0, maxLines).join('\n')}\n... (${l.length - maxLines} more lines)`;
};

// data = { files: [{ file, concept, symbols: [{ name, start, end, impact (text) }], newEdges: [{ spec, target, targetConcept }] }],
//          untested: [{ symbol, callers: [{ file, line, name }] }], cross: [{ a, b, text }] }
export function buildPrimer(data) {
  const L = [];
  L.push('## Changed symbols');
  for (const f of data.files) {
    const syms = f.symbols.map((s) => `\`${s.name}\` (L${s.start}-${s.end})`).join(', ');
    L.push(`- ${f.file} (concept ${f.concept || 'none: outside every concept'}): ${syms || 'no indexed symbol overlaps the changed lines (module-level change)'}`);
  }
  L.push('', '## Impact of each changed symbol (callers, depth 2)');
  let any = false;
  for (const f of data.files) for (const s of f.symbols) {
    any = true;
    L.push('', `### \`${s.name}\` in ${f.file}`, '', clip(String(s.impact).replace(/^# .*\n+/, ''), 40));
  }
  if (!any) L.push('', 'none (no indexed symbol changed)');
  L.push('', '## Untested callers (no test file mentions the caller by name)');
  const un = data.untested.filter((u) => u.callers.length);
  if (!un.length) L.push('', 'none');
  for (const u of un) for (const c of u.callers) L.push(`- \`${c.name}\` (${c.file}:${c.line}) calls \`${u.symbol}\``);
  L.push('', '## New cross-concept edges added by the diff');
  const edges = data.files.flatMap((f) => f.newEdges.filter((e) => e.targetConcept !== f.concept).map((e) => `- ${f.file} (${f.concept || 'none'}) now imports \`${e.spec}\` -> ${e.target} (${e.targetConcept || 'none: outside every concept'})`));
  L.push('', ...(edges.length ? edges : ['none']));
  L.push('', '## Cross-concept relations of the touched concepts (existing edges, before the change)');
  if (!data.cross.length) L.push('', 'none');
  for (const x of data.cross) L.push('', `### ${x.a} <-> ${x.b}`, '', clip(String(x.text).replace(/^# .*\n+/, ''), 25));
  return L.join('\n') + '\n';
}

// ---- graders --------------------------------------------------------------------------------------

const NONE_RE = /\b(no (defects?|issues?|bugs?|problems?|findings?)|nothing to report|lgtm)\b/i;
const BULLET_RE = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/;

// The findings a review lists: the items under its last `FINDINGS:` header (structured), else every
// bullet of the text. `none` is true when the review says it found nothing.
// `header` (070 refactor mode: PROPOSALS, VERDICTS) names the section; it must be a plain word.
export function findingsOf(text, header = 'FINDINGS') {
  const t = String(text ?? '');
  const hdr = [...t.matchAll(new RegExp(`^[ \\t*#>_\`-]*${header}[ \\t*\`_]*:[ \\t*\`_]*(.*)$`, 'gim'))].pop();
  const grab = (src) => {
    const items = [];
    let open = false;
    for (const line of src.split('\n')) {
      const b = BULLET_RE.exec(line);
      if (b) { items.push(b[1].trim()); open = true; }
      else if (!line.trim()) open = false;
      else if (open) items[items.length - 1] += ` ${line.trim()}`;
    }
    return items;
  };
  if (hdr) {
    const rest = hdr[1].trim();
    const after = t.slice(hdr.index + hdr[0].length);
    const items = grab(after);
    const none = /^none\b/i.test(rest.replace(/^[\s*`_]+/, '')) && !items.length;
    // `FINDINGS: <text>` on the header line itself is one finding.
    if (rest && !none && !BULLET_RE.test(rest)) items.unshift(rest);
    return { structured: true, none, items };
  }
  const items = grab(t);
  return { structured: false, none: NONE_RE.test(t) && !items.length, items };
}

// A finding that says the code is fine is not a finding of a defect, whatever keywords it also names.
const ABSENT_RE = /\b(?:is|are|looks?|seems?|appears?|remains?|stays?) (?:fine|correct|ok|okay|safe|right|intended|harmless|valid)\b|\b(?:correct|fine|safe|ok) as written\b|\bno (?:bug|issue|problem|defect|concern)s?\b|\bnot (?:a |an )?(?:bug|problem|issue|defect)\b|[,;(]\s*(?:correct|fine|ok|okay|safe)\s*[,;).]/i;
function saysAbsent(item) { return ABSENT_RE.test(item); }

// c.review = { clean?: true, bugs: [{ id, category, file: regex, defect: [regex, ...] }] }.
// A planted bug counts as found when one finding names its file and matches every defect pattern.
export function gradeReview(c, text) {
  const f = findingsOf(text);
  const bugs = c.review.bugs || [];
  // The file regex is matched against the path token (the text before the first ": "), so a finding for
  // another file that merely mentions a planted file's name in its description is not credited. An item
  // with no ": " has no separate path token and is matched whole.
  const pathOf = (item) => { const i = item.indexOf(': '); return i > 0 ? item.slice(0, i) : item; };
  const hit = (b, item) => !saysAbsent(item) && new RegExp(b.file, 'i').test(pathOf(item)) && b.defect.every((d) => new RegExp(d, 'i').test(item));
  const found = bugs.map((b) => ({ id: b.id, category: b.category, found: f.items.some((it) => hit(b, it)) }));
  const matched = new Set();
  f.items.forEach((it, i) => { if (bugs.some((b) => hit(b, it))) matched.add(i); });
  return {
    structured: f.structured,
    planted: bugs.length,
    found: found.filter((x) => x.found).length,
    bugs: found,
    findings: f.items.length,
    extra: f.items.length - matched.size, // findings that match no planted bug (may be real)
    falseAlarms: bugs.length ? 0 : f.items.length, // on a clean diff every finding is a false alarm
    clean: !bugs.length,
  };
}

// ---- validity -------------------------------------------------------------------------------------

const isAgentName = (n) => n === 'Agent' || n === 'Task';

// Agent calls in a transcript and whether one started a Haiku subagent: the call's `model`, or the
// model of an assistant message that belongs to a subagent (it carries parent_tool_use_id).
export function spawnEvidence(transcript) {
  const calls = [];
  const subModels = new Set();
  for (const line of String(transcript).split('\n')) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type === 'assistant' && j.parent_tool_use_id && j.message?.model) subModels.add(j.message.model);
    for (const b of Array.isArray(j.message?.content) ? j.message.content : []) {
      if (b.type === 'tool_use' && isAgentName(b.name)) calls.push({ model: String(b.input?.model ?? ''), type: String(b.input?.subagent_type ?? '') });
    }
  }
  // What ran wins over what was asked: when subagent messages exist, one must be Haiku; the call's own
  // model field counts only when the stream carries no subagent message at all.
  const haiku = calls.length > 0 && (subModels.size ? [...subModels].some((m) => /haiku/i.test(m)) : calls.some((c) => /haiku/i.test(c.model)));
  return { calls: calls.length, haiku, models: calls.map((c) => c.model || '-'), subModels: [...subModels] };
}

// Problems beyond lib.validity (which the runner also applies, minus its Bash-failure entries: a
// reviewer may run `git diff` in a workspace that is not a git repo). Init event: the arm's model and its
// exact tool set (Agent only in the spawn arm). Spawn arm: the transcript must show a Haiku subagent.
export function reviewProblems(arm, m, transcript) {
  const p = [];
  const a = REVIEW_ARMS[arm];
  if (m.init) {
    if (m.init.model && !String(m.init.model).includes(a.model.replace(/^claude-/, ''))) p.push(`init model ${m.init.model} is not ${a.model}`);
    if (Array.isArray(m.init.tools)) {
      const has = m.init.tools.some(isAgentName);
      if (a.spawn && !has) p.push('init tools lack Agent in the spawn arm');
      if (!a.spawn && has) p.push(`init tools list Agent in the ${arm} arm`);
      const want = new Set(toolsFor(arm).split(','));
      const extra = m.init.tools.filter((t) => !want.has(t) && !(isAgentName(t) && a.spawn));
      if (extra.length) p.push(`init lists tools beyond the arm's set: ${extra.join(', ')}`);
    }
  }
  const ev = spawnEvidence(transcript);
  if (a.spawn && !ev.haiku) p.push(ev.calls ? `invalid spawn run: ${ev.calls} Agent call(s) but none started a Haiku subagent (models: ${ev.models.join(', ')})` : 'invalid spawn run: no Agent call, so no Haiku subagent started');
  if (!a.spawn && ev.calls) p.push(`${ev.calls} Agent call(s) in the ${arm} arm`);
  return p;
}

// ---- tallies and verdicts -------------------------------------------------------------------------

export const isValidRow = (r) => (r.status || (r.problems?.length ? 'invalid' : 'valid')) === 'valid';

// Per arm: { local, cross, overall: { found, planted }, falseAlarms, cleanRuns, runs, cost, extra }
// Valid rows that every arm can be scored on: a (case, run) cell counts only when every arm planned at that
// cell has a valid row there, so no arm is scored on cells another arm lacks (a cap stop in the second
// pass, an invalid run). `planned` is the run plan ([{ case, arm, run }]); without it, the arms that have a
// row (valid or not) at the cell are the ones required.
export function pairedRows(rows, planned) {
  const key = (r) => `${r.case}#${r.run}`;
  const need = new Map();
  for (const r of planned ?? rows) (need.get(key(r)) ?? need.set(key(r), new Set()).get(key(r))).add(r.arm);
  const have = new Map();
  for (const r of rows) if (isValidRow(r)) (have.get(key(r)) ?? have.set(key(r), new Set()).get(key(r))).add(r.arm);
  return rows.filter((r) => isValidRow(r) && [...need.get(key(r))].every((a) => have.get(key(r))?.has(a)));
}

export function tally(rows, planned) {
  const out = {};
  for (const r of pairedRows(rows, planned)) {
    const t = (out[r.arm] ||= { local: { found: 0, planted: 0 }, cross: { found: 0, planted: 0 }, overall: { found: 0, planted: 0 }, falseAlarms: 0, cleanRuns: 0, runs: 0, cost: 0, extra: 0 });
    t.runs++;
    t.cost += r.m?.cost || 0;
    t.extra += r.grade.extra || 0;
    if (r.grade.clean) { t.cleanRuns++; t.falseAlarms += r.grade.falseAlarms; }
    for (const b of r.grade.bugs) {
      t[b.category].planted++; t.overall.planted++;
      if (b.found) { t[b.category].found++; t.overall.found++; }
    }
  }
  return out;
}

// The pre-registered rule (docs/evals.md, ticket 066) for one group: base and x are { found, planted }.
export function verdict(base, x) {
  const mb = base.planted - base.found;
  const mx = x.planted - x.found;
  if (base.planted !== x.planted) return { v: 'not comparable (different numbers of valid runs)', mb, mx };
  if (mb < 3) return { v: 'inconclusive (baseline misses under 3)', mb, mx };
  const gain = mb - mx;
  if (gain >= 3 && gain * 3 >= mb) return { v: 'helps', mb, mx };
  if (mx - mb >= 3) return { v: 'hurts', mb, mx };
  return { v: 'no effect shown', mb, mx };
}

const usd = (n) => (n == null ? 'n/a' : `$${n.toFixed(3)}`);

export function reviewReport(rows, meta) {
  const L = [`# review bench report (spent $${meta.spent.toFixed(3)} of $${meta.budget})`, ''];
  if (meta.stop) L.push(`STOPPED: ${meta.stop}`, '');
  const bad = rows.filter((r) => !isValidRow(r));
  if (bad.length) {
    L.push(`## INVALID OR USAGE-LIMIT RUNS (${bad.length}, not counted)`, '');
    for (const r of bad) for (const p of (r.problems.length ? r.problems : [r.status])) L.push(`- ${r.case} ${r.arm} run${r.run}: ${p}`);
    L.push('');
  } else if (rows.length) L.push('No invalid run.', '');
  L.push('## Per case and arm', '', '| case | arm | run | valid | found / planted | findings | extra | false alarms | structured | cost $ | turns |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const g = r.grade;
    L.push(`| ${r.case} | ${r.arm} | ${r.run} | ${isValidRow(r) ? 'yes' : 'NO'} | ${g.found}/${g.planted} | ${g.findings} | ${g.extra} | ${g.clean ? g.falseAlarms : '-'} | ${g.structured ? 'yes' : 'no'} | ${usd(r.m?.cost)} | ${r.m?.turns ?? 'n/a'} |`);
  }
  const t = tally(rows, meta.planned);
  const arms = REVIEW_ARM_NAMES.filter((a) => t[a]);
  const nValid = rows.filter(isValidRow).length;
  const nCounted = pairedRows(rows, meta.planned).length;
  L.push('', `Counted: ${nCounted} of ${nValid} valid runs. A (case, run) cell is scored only when every arm planned there has a valid run, so every arm is scored on the same cells; ${nValid - nCounted} valid run(s) were left out because another arm's cell is missing or invalid.`);
  L.push('', '## Per arm (paired valid runs only)', '', '| arm | valid runs | local found | cross found | overall found | false alarms (clean runs) | extra findings | cost per run |', '|---|---|---|---|---|---|---|---|');
  const fp = (x) => `${x.found}/${x.planted}`;
  for (const a of arms) L.push(`| ${a} | ${t[a].runs} | ${fp(t[a].local)} | ${fp(t[a].cross)} | ${fp(t[a].overall)} | ${t[a].falseAlarms} (${t[a].cleanRuns}) | ${t[a].extra} | ${usd(t[a].cost / t[a].runs)} |`);
  if (t[BASELINE]) {
    L.push('', `## Verdicts against ${BASELINE} (rule in docs/evals.md, Ticket 066)`, '', '| arm | local | cross | overall (never overrides a category) | false alarms vs baseline | cost per run vs baseline |', '|---|---|---|---|---|---|');
    const cell = (a, g) => { const v = verdict(t[BASELINE][g], t[a][g]); return `${v.v} (missed ${v.mb} -> ${v.mx})`; };
    for (const a of arms) {
      if (a === BASELINE) continue;
      const dc = t[BASELINE].cost ? `${(((t[a].cost / t[a].runs) / (t[BASELINE].cost / t[BASELINE].runs) - 1) * 100).toFixed(0)}%` : 'n/a';
      L.push(`| ${a} | ${cell(a, 'local')} | ${cell(a, 'cross')} | ${cell(a, 'overall')} | ${t[a].falseAlarms} vs ${t[BASELINE].falseAlarms} | ${dc} |`);
    }
  }
  return L.join('\n') + '\n';
}
