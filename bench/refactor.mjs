// 070 refactor mode: pure helpers for bench/refactor-run.mjs and bench/refactor-prep.mjs (arms, prompts,
// neighbourhood scope, metrics primer, graders, stage validity, anchoring, tallies, verdicts, report).
// No filesystem, no child process. Reuses the 066 review helpers (stream flags, findings parser, spawn
// evidence, paired rows, the 051-style verdict).
import { FLAGS } from './lib.mjs';
import {
  HAIKU, REVIEW_TOOLS, SONNET, SPAWN_TOOLS, clip, findingsOf, isValidRow, pairedRows, spawnEvidence, verdict,
} from './review.mjs';

// ---- arms -----------------------------------------------------------------------------------------

// Every arm runs in the no-graph workspace (maestro's concept skills, grep; no plugin, no scribe-output):
// the graph is not what is measured here, the metrics primer is.
// `primer`: the stored metrics primer is appended to the prompt. `spawn`: the session is told to hand the
// survey to Haiku subagents and has the Agent tool. `filter`: a second Sonnet session marks each of the
// scout's proposals file-it or drop-it; the arm is scored on the file-it ones.
export const REFACTOR_ARMS = {
  'sonnet-plain': { model: SONNET, primer: false, spawn: false, filter: false },
  'haiku-metrics-primer': { model: HAIKU, primer: true, spawn: false, filter: false },
  'haiku-scout-sonnet-filter': { model: HAIKU, primer: true, spawn: false, filter: true },
  'sonnet-spawns-haiku-scouts': { model: SONNET, primer: false, spawn: true, filter: false },
};
export const REFACTOR_ARM_NAMES = Object.keys(REFACTOR_ARMS);
export const DEFAULT_REFACTOR_ARMS = REFACTOR_ARM_NAMES.join(',');
export const DEFAULT_REFACTOR_RUNS = '3';
export const REFACTOR_BASELINE = 'sonnet-plain';
export const FILTER_MODEL = SONNET;
export const CATEGORIES = ['dedupe', 'extract', 'align', 'cycle', 'unused'];

export function parseRefactorArms(s) {
  const want = String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const bad = want.filter((a) => !REFACTOR_ARMS[a]);
  if (bad.length) throw new Error(`unknown refactor arm(s): ${bad.join(', ')} (known: ${REFACTOR_ARM_NAMES.join(', ')})`);
  if (!want.length) throw new Error('no arm given');
  return REFACTOR_ARM_NAMES.filter((a) => want.includes(a));
}

// The sessions an arm runs: the scout/main session, then (pipeline only) the filter. Each has its own
// exact tool set; only the spawn arm's main session has the Agent tool.
export const stagesOf = (arm) => (REFACTOR_ARMS[arm].filter ? ['scout', 'filter'] : ['main']);
export function stageSpec(arm, stage) {
  const a = REFACTOR_ARMS[arm];
  if (!a) throw new Error(`unknown refactor arm ${arm}`);
  if (stage === 'filter') return { model: FILTER_MODEL, tools: REVIEW_TOOLS, spawn: false };
  return { model: a.model, tools: a.spawn ? SPAWN_TOOLS : REVIEW_TOOLS, spawn: a.spawn };
}

export function refactorArgs(arm, stage, prompt, { runBudget }) {
  const s = stageSpec(arm, stage);
  return [
    FLAGS.print, prompt,
    FLAGS.model, s.model,
    FLAGS.outputFormat, 'stream-json', FLAGS.verbose,
    FLAGS.maxBudget, String(runBudget),
    FLAGS.noSessionPersistence,
    FLAGS.allowedTools, s.tools,
    FLAGS.tools, s.tools,
    FLAGS.permissionMode, 'dontAsk',
    FLAGS.settingSources, 'project,local',
    FLAGS.strictMcpConfig,
  ];
}

// ---- prompts --------------------------------------------------------------------------------------

export const SCOPE_OPEN = '<neighbourhood>';
export const SCOPE_CLOSE = '</neighbourhood>';
export const PRIMER_OPEN = '<metrics-primer>';
export const PRIMER_CLOSE = '</metrics-primer>';

const BASE_PROMPT = (scope) => `You are auditing one neighbourhood of the maestro repository in the current directory for code-structure improvements worth a refactor ticket: code duplicated across files or concepts, a helper that should be extracted or reused, a pattern that one file of a family does differently from its siblings, an import cycle, an export that nothing imports. The neighbourhood is the list of files below (a change's files and the files next to them in the import graph). Read them and the code around them; do not edit anything. Propose only improvements that are warranted: if the neighbourhood is fine as it is, say so. Do not report bugs, naming or formatting.

${SCOPE_OPEN}
${scope.trim()}
${SCOPE_CLOSE}`;

const FORMAT = `Finish with a section that starts with the line \`PROPOSALS:\` followed by one line per proposal, in the form \`- <file path>: <kind>: <the problem and the change, in one or two sentences>\`, where kind is one of dedupe, extract-helper, align-pattern, break-cycle, remove-unused. If nothing is warranted, write \`PROPOSALS: none\`.`;

const SPAWN_PARAGRAPH = `Hand the survey of the neighbourhood to Haiku subagents: use the Agent tool with the model set to \`haiku\`, give each subagent a few of the files, and ask it to list code that duplicates code in another file, patterns that differ from the sibling files, imports that close a cycle, and exports nothing imports (file and line). Then judge their reports yourself and write the proposals.`;

export function refactorPrompt(arm, scope, primer = '') {
  const a = REFACTOR_ARMS[arm];
  if (!a) throw new Error(`unknown refactor arm ${arm}`);
  const parts = [BASE_PROMPT(scope)];
  if (a.primer) {
    if (!String(primer).trim()) throw new Error('a primer arm needs the stored metrics primer');
    parts.push(`${PRIMER_OPEN}\nFacts computed from the code index of the repository. They are leads, not verdicts: check them against the source. The index does not measure duplication or pattern drift.\n\n${String(primer).trim()}\n${PRIMER_CLOSE}`);
  }
  if (a.spawn) parts.push(SPAWN_PARAGRAPH);
  parts.push(FORMAT);
  return parts.join('\n\n');
}

const FILTER_FORMAT = 'Finish with a section that starts with the line `VERDICTS:` followed by exactly one line per proposal, in the form `- <number>: file-it: <reason>` or `- <number>: drop-it: <reason>`.';

// Stage 2 of the pipeline. A reviewer-style filter that only marks each proposal; it never rules on the
// change as a whole and adds nothing of its own.
export function filterPrompt(scope, items) {
  if (!items.length) throw new Error('the filter needs at least one proposal');
  const list = items.map((x, i) => `${i + 1}. ${x}`).join('\n');
  return `You are a senior reviewer filtering refactor suggestions that a cheap scout raised on one neighbourhood of the maestro repository in the current directory. Decide for each suggestion whether it is a real structural problem worth a refactor ticket (file-it) or a false alarm, a matter of taste, something already fine or not worth a ticket (drop-it). Check each one against the source before you decide. Do not give a verdict on the change or on the code as a whole, do not add suggestions of your own, and do not edit anything.

${SCOPE_OPEN}
${scope.trim()}
${SCOPE_CLOSE}

<scout-proposals>
${list}
</scout-proposals>

${FILTER_FORMAT}`;
}

// The metrics primer is in the prompt of the primer arms and of no other arm; the spawn instruction only
// in the spawn arm.
export function promptProblems(arm, prompt) {
  const a = REFACTOR_ARMS[arm];
  const has = String(prompt).includes(PRIMER_OPEN);
  if (a.primer && !has) return [`the ${arm} arm's prompt carries no metrics primer`];
  if (!a.primer && has) return [`the ${arm} arm's prompt carries a metrics primer (only a primer arm may)`];
  const spawnText = String(prompt).includes('Haiku subagents');
  if (a.spawn !== spawnText) return [`the ${arm} arm's prompt ${spawnText ? 'tells the session to spawn subagents' : 'lacks the spawn instruction'}`];
  if (!String(prompt).includes(SCOPE_OPEN)) return [`the ${arm} arm's prompt carries no neighbourhood`];
  return [];
}

// ---- neighbourhood scope --------------------------------------------------------------------------

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (name) => new RegExp(`(?<![A-Za-z0-9_$])${esc(name)}(?![A-Za-z0-9_$])`);
const baseName = (p) => p.split('/').pop().replace(/\.[a-z]+$/, '');

// The files next to the touched ones in the import graph. `edges`: [{ from, to }] (the union of the trees
// before and after the planted change), `exportsOf`: { file: [names] }, `text`: the planted text (what the
// change removed and added). A direct neighbour joins the scope when the change mentions it (its file
// name, or a symbol it exports); when the change mentions none (a clean or a text-free case) up to `fill`
// neighbours that are not hubs join instead, least imported first.
export function neighbourFiles({ touched, edges, exportsOf = {}, text = '', hubs = [], fanIn = {}, fill = 4 }) {
  const t = new Set(touched);
  const cand = new Set();
  for (const e of edges) {
    if (t.has(e.from) && !t.has(e.to)) cand.add(e.to);
    if (t.has(e.to) && !t.has(e.from)) cand.add(e.from);
  }
  const mentioned = [...cand].filter((f) => {
    const b = baseName(f);
    if (b.length >= 6 && word(b).test(text)) return true;
    return (exportsOf[f] || []).some((n) => n.length >= 6 && word(n).test(text));
  }).sort();
  if (mentioned.length) return mentioned;
  const hub = new Set(hubs);
  return [...cand].filter((f) => !hub.has(f)).sort((a, b) => (fanIn[a] ?? 0) - (fanIn[b] ?? 0) || (a < b ? -1 : 1)).slice(0, fill).sort();
}

// entries: [{ file, concept }] -> the file list the agent is given. Sorted, and no label says which files
// the change touched: that would give the location away.
export function buildScope(entries) {
  const L = [`${entries.length} files:`];
  for (const e of [...entries].sort((a, b) => (a.file < b.file ? -1 : 1))) L.push(`- ${e.file} (concept ${e.concept || 'none: outside every concept'})`);
  return L.join('\n') + '\n';
}

// ---- metrics --------------------------------------------------------------------------------------

// Strongly connected components with more than one file (or a self import) of the import graph, each
// sorted, the list sorted. Tarjan, iterative.
export function findCycles(edges) {
  const adj = new Map();
  const add = (a) => { if (!adj.has(a)) adj.set(a, new Set()); };
  for (const e of edges) { add(e.from); add(e.to); adj.get(e.from).add(e.to); }
  const nodes = [...adj.keys()].sort();
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const out = [];
  let counter = 0;
  for (const root of nodes) {
    if (index.has(root)) continue;
    const work = [[root, [...adj.get(root)].sort(), 0]];
    index.set(root, counter); low.set(root, counter); counter++; stack.push(root); onStack.add(root);
    while (work.length) {
      const frame = work[work.length - 1];
      const [v, nexts] = frame;
      if (frame[2] < nexts.length) {
        const w = nexts[frame[2]++];
        if (!index.has(w)) {
          index.set(w, counter); low.set(w, counter); counter++; stack.push(w); onStack.add(w);
          work.push([w, [...adj.get(w)].sort(), 0]);
        } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
      } else {
        work.pop();
        if (work.length) { const p = work[work.length - 1][0]; low.set(p, Math.min(low.get(p), low.get(v))); }
        if (low.get(v) === index.get(v)) {
          const comp = [];
          let w;
          do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
          if (comp.length > 1 || adj.get(v).has(v)) out.push(comp.sort());
        }
      }
    }
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

// Exports of the `entries` ([{ file, exports }]) that no other source file mentions as a whole word.
// `sources`: [{ file, text }] of every source file. A text scan: the code index exposes fan-in per file,
// not per export, and a barrel re-export or a dynamic use only shows as a mention, so this is a lead.
export function unusedExports(entries, sources) {
  const out = [];
  for (const e of entries) {
    for (const name of e.exports || []) {
      const re = word(name);
      if (!sources.some((s) => s.file !== e.file && re.test(s.text))) out.push({ file: e.file, name });
    }
  }
  return out;
}

// data = { files: [{ file, concept, fanIn, fanOut, exports }], hubs: [file], cycles: [[file]], unused: [{ file, name }],
//          crossEdges: [{ from, fromConcept, to, toConcept }], cross: [{ a, b, text }] }
export function buildMetricsPrimer(data) {
  const L = ['## Scope files (fan-in: files importing it; fan-out: files it imports; both from the code index)'];
  for (const f of data.files) L.push(f.indexed === false ? `- ${f.file} (concept ${f.concept || 'none'}): not in the code index (no metrics)` : `- ${f.file} (concept ${f.concept || 'none'}): fan-in ${f.fanIn}, fan-out ${f.fanOut}, ${f.exports} exports`);
  L.push('', '## Hubs among the scope files (the index lists them as high fan-in)');
  L.push(...(data.hubs.length ? data.hubs.map((h) => `- ${h}`) : ['none']));
  L.push('', '## Import cycles that include a scope file');
  L.push(...(data.cycles.length ? data.cycles.map((c) => `- ${c.join(' <-> ')}`) : ['none']));
  L.push('', '## Exports of the scope files that no other source file mentions (leads: check re-exports and dynamic use)');
  L.push(...(data.unused.length ? data.unused.map((u) => `- \`${u.name}\` in ${u.file}`) : ['none']));
  L.push('', '## Cross-concept import edges between scope files');
  L.push(...(data.crossEdges.length ? data.crossEdges.map((e) => `- ${e.from} (${e.fromConcept}) imports ${e.to} (${e.toConcept})`) : ['none']));
  L.push('', '## Cross-concept relations of the scope files (query cross)');
  if (!data.cross.length) L.push('', 'none');
  for (const x of data.cross) L.push('', `### ${x.a} <-> ${x.b}`, '', clip(String(x.text).replace(/^# .*\n+/, ''), 15));
  return L.join('\n') + '\n';
}

// ---- graders --------------------------------------------------------------------------------------

// A proposal that says the code is fine is not a proposal, whatever keywords it also names.
const ABSENT_RE = /\b(?:is|are|looks?|seems?|appears?|remains?|stays?) (?:fine|correct|ok|okay|clean|good|appropriate|intended|harmless|justified)\b|\b(?:fine|ok|clean) as (?:written|is)\b|\bno (?:refactor|change|improvement|duplication|cycle)s? (?:is |are )?(?:needed|warranted|required)\b|\bnot worth\b/i;

const pathOf = (item) => { const i = item.indexOf(': '); return i > 0 ? item.slice(0, i) : item; };
const matches = (x, item) => !ABSENT_RE.test(item) && new RegExp(x.file, 'i').test(pathOf(item)) && x.change.every((d) => new RegExp(d, 'i').test(item));

// c.refactor = { expected: [{ id, category, file: regex, change: [regex, ...] }], tolerated: [{ file, change }] }.
// An expected improvement counts as proposed when one proposal names its file (the path token, before the
// first ": ") and matches every change pattern. A proposal that matches an expected or a tolerated
// improvement is not a false finding; on a clean case every other proposal is one. On the other cases the
// remaining proposals are `extra` (they may be real: the tree is real code) and are reported, not scored.
export function gradeItems(c, items) {
  const exp = c.refactor.expected || [];
  const tol = c.refactor.tolerated || [];
  const found = exp.map((x) => ({ id: x.id, category: x.category, found: items.some((it) => matches(x, it)) }));
  let credited = 0;
  let tolerated = 0;
  let rest = 0;
  for (const it of items) {
    if (exp.some((x) => matches(x, it))) credited++;
    else if (tol.some((x) => matches(x, it))) tolerated++;
    else rest++;
  }
  const clean = !exp.length;
  return { planted: exp.length, found: found.filter((x) => x.found).length, expected: found, proposals: items.length, credited, tolerated, extra: clean ? 0 : rest, falseFindings: clean ? rest : 0, clean };
}

export function gradeRefactor(c, text) {
  const f = findingsOf(text, 'PROPOSALS');
  return { structured: f.structured, none: f.none, ...gradeItems(c, f.items), items: f.items };
}

// ---- pipeline: the filter's verdicts and anchoring ------------------------------------------------

// The filter's `VERDICTS:` lines -> which of the n numbered proposals it kept (file-it) or dropped
// (drop-it). A proposal with no readable verdict is `unmarked` and does not survive; a line that names a
// number outside 1..n is `outOfList` (the filter may not add proposals of its own).
export function verdictsOf(text, n) {
  const t = String(text ?? '');
  const hdr = [...t.matchAll(/^[ \t*#>_`-]*VERDICTS[ \t*`_]*:[ \t*`_]*(.*)$/gim)].pop();
  // One line per proposal, its number first (`- 1: file-it`, `1. file-it`, `#1 drop-it`): a numbered list
  // marker is the number, so the generic bullet parser (which strips it) is not used here.
  const lines = hdr ? `${hdr[1]}\n${t.slice(hdr.index + hdr[0].length)}`.split('\n').filter((l) => l.trim()) : [];
  const kept = new Set();
  const dropped = new Set();
  let outOfList = 0;
  for (const line of lines) {
    const m = /^[\s*_`>-]*(?:#|no\.?\s*)?(\d+)\b[\s*_`]*[:.)\-]?\s*(.*)$/is.exec(line);
    if (!m) continue; // prose between the lines is not a verdict
    const i = Number(m[1]);
    const k = /\bfile[- ]it\b/i.exec(m[2]);
    const d = /\bdrop[- ]it\b/i.exec(m[2]);
    if (i < 1 || i > n || (!k && !d)) { outOfList++; continue; }
    if (kept.has(i) || dropped.has(i)) continue; // the first line for a proposal wins
    if (k && (!d || k.index < d.index)) kept.add(i); else dropped.add(i);
  }
  const unmarked = [];
  for (let i = 1; i <= n; i++) if (!kept.has(i) && !dropped.has(i)) unmarked.push(i);
  return { structured: !!hdr, kept: [...kept].sort((a, b) => a - b), dropped: [...dropped].sort((a, b) => a - b), unmarked, outOfList };
}

// How much of the scout's list the filter passed on: survivors / scout proposals. 1 with a non-empty list
// means the list came through unchanged (the filter filtered nothing); null when the scout proposed nothing.
export function anchoring(scoutCount, v) {
  return {
    scout: scoutCount,
    kept: v ? v.kept.length : 0,
    dropped: v ? v.dropped.length : 0,
    unmarked: v ? v.unmarked.length : 0,
    outOfList: v ? v.outOfList : 0,
    rate: scoutCount ? (v ? v.kept.length : 0) / scoutCount : null,
    unchanged: scoutCount > 0 && !!v && v.kept.length === scoutCount,
  };
}

// The pipeline's grade: the scout's list graded whole, the survivors graded as the arm's result, and the
// expected improvements the filter threw away (found by the scout, not kept) or the false findings it
// removed.
export function gradePipeline(c, scoutText, filterText) {
  const f = findingsOf(scoutText, 'PROPOSALS');
  const scout = gradeItems(c, f.items);
  if (!f.items.length) return { ...gradeItems(c, []), structured: f.structured, none: f.none, items: [], scout, anchor: anchoring(0, null), verdicts: null, lostByFilter: 0, falseRemoved: 0 };
  const v = filterText == null ? null : verdictsOf(filterText, f.items.length);
  const survivors = v ? v.kept.map((i) => f.items[i - 1]) : [];
  const g = gradeItems(c, survivors);
  return {
    structured: f.structured, none: f.none, ...g, items: survivors, scout, verdicts: v, anchor: anchoring(f.items.length, v),
    lostByFilter: scout.found - g.found, falseRemoved: scout.falseFindings - g.falseFindings,
  };
}

// ---- validity -------------------------------------------------------------------------------------

const isAgentName = (n) => n === 'Agent' || n === 'Task';

// Problems of one session beyond lib.validity: the init event's model and exact tool set (Agent only in
// the spawn arm's main session), and the spawn evidence (the spawn arm needs a Haiku subagent in the
// transcript; no other session may call Agent).
export function stageProblems(arm, stage, m, transcript) {
  const s = stageSpec(arm, stage);
  const p = [];
  const tag = stage === 'main' ? arm : `${arm} ${stage}`;
  if (m.init) {
    if (m.init.model && !String(m.init.model).includes(s.model.replace(/^claude-/, ''))) p.push(`${tag}: init model ${m.init.model} is not ${s.model}`);
    if (Array.isArray(m.init.tools)) {
      const has = m.init.tools.some(isAgentName);
      if (s.spawn && !has) p.push(`${tag}: init tools lack Agent in the spawn arm`);
      if (!s.spawn && has) p.push(`${tag}: init tools list Agent`);
      const want = new Set(s.tools.split(','));
      const extra = m.init.tools.filter((t) => !want.has(t) && !(isAgentName(t) && s.spawn));
      if (extra.length) p.push(`${tag}: init lists tools beyond the set: ${extra.join(', ')}`);
    }
  }
  const ev = spawnEvidence(transcript);
  if (s.spawn && !ev.haiku) p.push(ev.calls ? `invalid spawn run: ${ev.calls} Agent call(s) but none started a Haiku subagent (models: ${ev.models.join(', ')})` : 'invalid spawn run: no Agent call, so no Haiku subagent started');
  if (!s.spawn && ev.calls) p.push(`${tag}: ${ev.calls} Agent call(s)`);
  return p;
}

// Problems of the stored case files: the scope must list every file the change plants into, the primer
// must carry its sections. (The full drift check against a fresh workspace is refactor-prep.mjs --check.)
export function storedProblems(c, scope, primer) {
  const p = [];
  for (const f of new Set((c.refactor.plant || []).map((x) => x.file))) if (!scope.includes(f)) p.push(`the stored scope omits the planted file ${f}`);
  for (const f of c.refactor.touched || []) if (!scope.includes(f)) p.push(`the stored scope omits the touched file ${f}`);
  for (const h of ['## Scope files', '## Import cycles', '## Exports of the scope files']) if (!primer.includes(h)) p.push(`the stored primer lacks the section "${h}"`);
  return p;
}

// ---- tallies, verdicts, pilot ---------------------------------------------------------------------

export const rowCost = (r) => (r.m?.cost || 0) + (r.m2?.cost || 0);

const blank = () => ({ found: 0, planted: 0 });
// Per arm: expected improvements kept by category and overall, false findings kept (clean runs), extra
// proposals, cost, anchoring (pipeline), what the filter lost or removed, by case kind.
export function tally(rows, planned) {
  const out = {};
  for (const r of pairedRows(rows, planned)) {
    const t = (out[r.arm] ||= {
      cats: Object.fromEntries(CATEGORIES.map((k) => [k, blank()])), overall: blank(), falseFindings: 0, cleanRuns: 0, extra: 0, runs: 0, cost: 0,
      anchor: { runs: 0, scout: 0, kept: 0, unchanged: 0 }, lostByFilter: 0, falseRemoved: 0, scoutFound: 0, scoutFalse: 0,
    });
    t.runs++;
    t.cost += rowCost(r);
    t.extra += r.grade.extra || 0;
    if (r.grade.clean) { t.cleanRuns++; t.falseFindings += r.grade.falseFindings; }
    for (const e of r.grade.expected) {
      (t.cats[e.category] ||= blank()).planted++; t.overall.planted++;
      if (e.found) { t.cats[e.category].found++; t.overall.found++; }
    }
    if (r.grade.anchor) {
      t.anchor.runs++;
      t.anchor.scout += r.grade.anchor.scout;
      t.anchor.kept += r.grade.anchor.kept;
      if (r.grade.anchor.unchanged) t.anchor.unchanged++;
      t.lostByFilter += r.grade.lostByFilter || 0;
      t.falseRemoved += r.grade.falseRemoved || 0;
      t.scoutFound += r.grade.scout?.found || 0;
      t.scoutFalse += r.grade.scout?.falseFindings || 0;
    }
  }
  return out;
}

// Kept improvements: the 051-style rule on { found, planted } (verdict in review.mjs): `helps`, `hurts`,
// `no effect shown` or `inconclusive`, per category, the overall never overriding a category.
export const improvementVerdict = (base, x) => verdict(base, x);

// Kept false findings on clean runs, an arm against the baseline: fewer or more by at least 3, else no
// difference shown. Both arms are scored on the same clean cells.
export function falseVerdict(base, x) {
  const d = base - x;
  return d >= 3 ? 'fewer' : d <= -3 ? 'more' : 'no difference shown';
}

// The baseline pilot (one sonnet-plain run per case): `saturated` when it missed under 3 expected
// improvements (the improvement verdict could not show a gain), `floor` when it found under a third of
// them (the cases or the grader are too hard or too strict). Either means rework the cases before a paid run.
export function pilotScreen(rows, planned) {
  const t = tally(rows.filter((r) => r.arm === REFACTOR_BASELINE), planned?.filter((p) => p.arm === REFACTOR_BASELINE))[REFACTOR_BASELINE];
  if (!t) return { ok: false, note: 'no valid baseline run' };
  const missed = t.overall.planted - t.overall.found;
  const saturated = missed < 3;
  const floor = t.overall.found * 3 < t.overall.planted;
  const note = saturated ? `saturated: the baseline missed ${missed} of ${t.overall.planted}; rework the cases` : floor ? `floor: the baseline found ${t.overall.found} of ${t.overall.planted}; rework the cases or the grader` : `ok: the baseline missed ${missed} of ${t.overall.planted} and kept ${t.falseFindings} false finding(s) on ${t.cleanRuns} clean run(s)`;
  return { ok: !saturated && !floor, saturated, floor, missed, planted: t.overall.planted, found: t.overall.found, falseFindings: t.falseFindings, note };
}

// ---- report ---------------------------------------------------------------------------------------

const usd = (n) => (n == null ? 'n/a' : `$${n.toFixed(3)}`);

export function refactorReport(rows, meta) {
  const L = [`# refactor bench report (spent $${meta.spent.toFixed(3)} of $${meta.budget})`, ''];
  if (meta.stop) L.push(`STOPPED: ${meta.stop}`, '');
  const bad = rows.filter((r) => !isValidRow(r));
  if (bad.length) {
    L.push(`## INVALID OR USAGE-LIMIT RUNS (${bad.length}, not counted)`, '');
    for (const r of bad) for (const p of (r.problems.length ? r.problems : [r.status])) L.push(`- ${r.case} ${r.arm} run${r.run}: ${p}`);
    L.push('');
  } else if (rows.length) L.push('No invalid run.', '');
  L.push('## Per case and arm', '', '| case | arm | run | valid | kept / expected | proposals kept | extra | false findings | anchoring (kept/scout) | cost $ (scout + filter) | turns |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const g = r.grade;
    const an = g.anchor ? `${g.anchor.kept}/${g.anchor.scout}` : '-';
    const cost = r.m2 ? `${usd(rowCost(r))} (${usd(r.m?.cost)} + ${usd(r.m2.cost)})` : usd(rowCost(r));
    L.push(`| ${r.case} | ${r.arm} | ${r.run} | ${isValidRow(r) ? 'yes' : 'NO'} | ${g.found}/${g.planted} | ${g.proposals} | ${g.extra} | ${g.clean ? g.falseFindings : '-'} | ${an} | ${cost} | ${r.m?.turns ?? 'n/a'} |`);
  }
  const t = tally(rows, meta.planned);
  const arms = REFACTOR_ARM_NAMES.filter((a) => t[a]);
  const nValid = rows.filter(isValidRow).length;
  const nCounted = pairedRows(rows, meta.planned).length;
  L.push('', `Counted: ${nCounted} of ${nValid} valid runs. A (case, run) cell is scored only when every arm planned there has a valid run, so every arm is scored on the same cells; ${nValid - nCounted} valid run(s) were left out because another arm's cell is missing or invalid.`);
  const fp = (x) => `${x.found}/${x.planted}`;
  L.push('', '## Per arm (paired valid runs only; the pipeline is scored on what survives the filter)', '', `| arm | valid runs | ${CATEGORIES.join(' | ')} | overall kept | false findings (clean runs) | extra | cost per run |`, `|---|---|${CATEGORIES.map(() => '---').join('|')}|---|---|---|---|`);
  for (const a of arms) L.push(`| ${a} | ${t[a].runs} | ${CATEGORIES.map((k) => fp(t[a].cats[k])).join(' | ')} | ${fp(t[a].overall)} | ${t[a].falseFindings} (${t[a].cleanRuns}) | ${t[a].extra} | ${usd(t[a].cost / t[a].runs)} |`);
  const pipe = arms.filter((a) => REFACTOR_ARMS[a].filter);
  if (pipe.length) {
    L.push('', '## Pipeline: anchoring and what the filter did', '', '| arm | runs with a list | scout proposals | kept | anchoring | lists passed unchanged | expected lost by the filter | false findings removed by the filter |', '|---|---|---|---|---|---|---|---|');
    for (const a of pipe) {
      const x = t[a];
      L.push(`| ${a} | ${x.anchor.runs} | ${x.anchor.scout} | ${x.anchor.kept} | ${x.anchor.scout ? `${((x.anchor.kept / x.anchor.scout) * 100).toFixed(0)}%` : 'n/a'} | ${x.anchor.unchanged} | ${x.lostByFilter} | ${x.falseRemoved} |`);
    }
  }
  if (t[REFACTOR_BASELINE]) {
    const B = t[REFACTOR_BASELINE];
    L.push('', `## Verdicts against ${REFACTOR_BASELINE} (rule in docs/evals.md, Ticket 070)`, '', `| arm | ${CATEGORIES.join(' | ')} | overall (never overrides a category) | false findings vs baseline | cost per run vs baseline |`, `|---|${CATEGORIES.map(() => '---').join('|')}|---|---|---|`);
    const cell = (a, g) => { const v = improvementVerdict(g === 'overall' ? B.overall : B.cats[g], g === 'overall' ? t[a].overall : t[a].cats[g]); return `${v.v} (missed ${v.mb} -> ${v.mx})`; };
    for (const a of arms) {
      if (a === REFACTOR_BASELINE) continue;
      const dc = B.cost ? `${(((t[a].cost / t[a].runs) / (B.cost / B.runs) - 1) * 100).toFixed(0)}%` : 'n/a';
      L.push(`| ${a} | ${CATEGORIES.map((k) => cell(a, k)).join(' | ')} | ${cell(a, 'overall')} | ${t[a].falseFindings} vs ${B.falseFindings}: ${falseVerdict(B.falseFindings, t[a].falseFindings)} | ${dc} |`);
    }
    const ps = pilotScreen(rows, meta.planned);
    L.push('', `Baseline screen: ${ps.note}`);
  }
  return L.join('\n') + '\n';
}
