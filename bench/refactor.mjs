// 070 refactor mode: pure helpers for bench/refactor-run.mjs and bench/refactor-prep.mjs (arms, prompts,
// neighbourhood scope, metrics primer, graders, stage validity, anchoring, tallies, verdicts, report).
// No filesystem, no child process. Reuses the 066 review helpers (stream flags, findings parser, spawn
// evidence, paired rows, the 051-style verdict).
import { FLAGS } from './lib.mjs';
import {
  HAIKU, REVIEW_FORMAT, REVIEW_TOOLS, SONNET, SPAWN_TOOLS, clip, findingsOf, isValidRow, pairedRows, reviewBasePrompt, spawnEvidence, verdict,
} from './review.mjs';

// ---- arms -----------------------------------------------------------------------------------------

// Every arm runs in the no-graph workspace (maestro's concept skills, grep; no plugin, no scribe-output):
// the graph is not what is measured here, the metrics primer is.
// `primer`: the stored metrics primer is appended to the prompt. `spawn`: the session is told to hand the
// survey to Haiku subagents and has the Agent tool. `filter`: (070) a second Sonnet session marks each of the
// scout's proposals file-it or drop-it; the arm is scored on the file-it ones.
// 071 arms. `scout`: the Haiku scout session is SHARED by every arm with the flag, one session per
// (case, run), its cost counted in each of those arms. `batch`: the scout's list goes into one Sonnet filter
// session over the combined backlog of the case's batch, whose cost is split across the cases by proposals.
// `inline`: the list goes into a normal Sonnet review of the same change, which marks each suggestion in
// its own VERDICTS section (never in the findings), costed as the extra spend over `review`, the same review
// without the list (a control arm, never scored as a refactor arm).
export const REFACTOR_ARMS = {
  'sonnet-plain': { model: SONNET, primer: false, spawn: false, filter: false },
  'haiku-metrics-primer': { model: HAIKU, primer: true, spawn: false, filter: false, scout: true },
  'haiku-scout-sonnet-filter': { model: HAIKU, primer: true, spawn: false, filter: true, scout: true },
  'sonnet-spawns-haiku-scouts': { model: SONNET, primer: false, spawn: true, filter: false },
  'haiku-batched-filter': { model: HAIKU, primer: true, spawn: false, filter: false, scout: true, batch: true },
  'haiku-reviewer-inline': { model: HAIKU, primer: true, spawn: false, filter: false, scout: true, inline: true },
  'sonnet-review-plain': { model: SONNET, primer: false, spawn: false, filter: false, review: true },
  // 073: the plain scout's own session (not shared) plus the decided-against entries of the case's neighbourhood
  // (bench/refactor-decided.mjs); scored against `haiku-metrics-primer` on paired cells.
  'haiku-decided-against': { model: HAIKU, primer: true, spawn: false, filter: false, decided: true },
};
export const REFACTOR_ARM_NAMES = Object.keys(REFACTOR_ARMS);
// Opt-in, off by default (`--arms` must name them): the 070 spawn arm and the 070 per-case filter pipeline.
// The default is the 071 design; the control `sonnet-review-plain` is added by `withSupportArms`.
export const OPT_IN_REFACTOR_ARMS = ['sonnet-spawns-haiku-scouts', 'haiku-scout-sonnet-filter', 'sonnet-review-plain', 'haiku-decided-against'];
export const DEFAULT_REFACTOR_ARMS = REFACTOR_ARM_NAMES.filter((a) => !OPT_IN_REFACTOR_ARMS.includes(a)).join(',');
export const DEFAULT_REFACTOR_RUNS = '2';
export const REFACTOR_BASELINE = 'sonnet-plain';
export const REVIEW_CONTROL = 'sonnet-review-plain';
export const FILTER_MODEL = SONNET;
export const CATEGORIES = ['dedupe', 'extract', 'align', 'cycle', 'unused'];
export const isControlArm = (a) => !!REFACTOR_ARMS[a]?.review;
export const isScoutArm = (a) => !!REFACTOR_ARMS[a]?.scout;

export function parseRefactorArms(s) {
  const want = String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const bad = want.filter((a) => !REFACTOR_ARMS[a]);
  if (bad.length) throw new Error(`unknown refactor arm(s): ${bad.join(', ')} (known: ${REFACTOR_ARM_NAMES.join(', ')})`);
  if (!want.length) throw new Error('no arm given');
  return REFACTOR_ARM_NAMES.filter((a) => want.includes(a));
}

// 071: the control review is planned with the inline arm, so that its extra cost is measured on the same cells.
export function withSupportArms(arms) {
  return arms.includes('haiku-reviewer-inline') && !arms.includes(REVIEW_CONTROL) ? REFACTOR_ARM_NAMES.filter((a) => arms.includes(a) || a === REVIEW_CONTROL) : arms;
}

// The sessions an arm runs: the scout/main session, then (pipelines) the filter, the batch filter or the
// inline review; the control arm is one review. Each has its own exact tool set; only the spawn arm's main
// session has the Agent tool.
export function stagesOf(arm) {
  const a = REFACTOR_ARMS[arm];
  if (a.filter) return ['scout', 'filter'];
  if (a.batch) return ['scout', 'batch'];
  if (a.inline) return ['scout', 'inline'];
  if (a.review) return ['review'];
  return ['main'];
}
export function stageSpec(arm, stage) {
  const a = REFACTOR_ARMS[arm];
  if (!a) throw new Error(`unknown refactor arm ${arm}`);
  if (stage === 'filter' || stage === 'batch' || stage === 'inline') return { model: FILTER_MODEL, tools: REVIEW_TOOLS, spawn: false };
  return { model: a.model, tools: a.spawn ? SPAWN_TOOLS : REVIEW_TOOLS, spawn: a.spawn };
}

// The pre-registered filter batches (docs/evals.md, Ticket 071): the cases of one batch share one filter
// session. `c.batch` names the batch; the cases the run selects keep their batch, so `--only` shrinks a batch.
export function batchesOf(cases) {
  const by = new Map();
  for (const c of cases) { const k = c.batch ?? c.id; (by.get(k) ?? by.set(k, []).get(k)).push(c); }
  return [...by.values()];
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
export const DECIDED_OPEN = '<decided-against>';
export const DECIDED_CLOSE = '</decided-against>';

const BASE_PROMPT = (scope) => `You are auditing one neighbourhood of the maestro repository in the current directory for code-structure improvements worth a refactor ticket: code duplicated across files or concepts, a helper that should be extracted or reused, a pattern that one file of a family does differently from its siblings, an import cycle, an export that nothing imports. The neighbourhood is the list of files below (a change's files and the files next to them in the import graph). Read them and the code around them; do not edit anything. Propose only improvements that are warranted: if the neighbourhood is fine as it is, say so. Do not report bugs, naming or formatting.

${SCOPE_OPEN}
${scope.trim()}
${SCOPE_CLOSE}`;

const FORMAT = `Finish with a section that starts with the line \`PROPOSALS:\` followed by one line per proposal, in the form \`- <file path>: <kind>: <the problem and the change, in one or two sentences>\`, where kind is one of dedupe, extract-helper, align-pattern, break-cycle, remove-unused. If nothing is warranted, write \`PROPOSALS: none\` and nothing else: no bullet, no sentence after it, no all-clear line.`;

const SPAWN_PARAGRAPH = `Hand the survey of the neighbourhood to Haiku subagents: use the Agent tool with the model set to \`haiku\`, give each subagent a few of the files, and ask it to list code that duplicates code in another file, patterns that differ from the sibling files, imports that close a cycle, and exports nothing imports (file and line). Then judge their reports yourself and write the proposals.`;

// `decided` (073): the ready decided-against block (bench/refactor-decided.mjs `decidedBlock`), only for the
// decided-against arm; it goes right after the metrics primer.
export function refactorPrompt(arm, scope, primer = '', decided = '') {
  const a = REFACTOR_ARMS[arm];
  if (!a) throw new Error(`unknown refactor arm ${arm}`);
  const parts = [BASE_PROMPT(scope)];
  if (a.primer) {
    if (!String(primer).trim()) throw new Error('a primer arm needs the stored metrics primer');
    parts.push(`${PRIMER_OPEN}\nFacts computed from the code index of the repository. They are leads, not verdicts: check them against the source. The index does not measure duplication or pattern drift.\n\n${String(primer).trim()}\n${PRIMER_CLOSE}`);
  }
  if (a.decided) {
    if (!String(decided).includes(DECIDED_OPEN)) throw new Error('the decided-against arm needs the decided-against block');
    parts.push(String(decided).trim());
  } else if (String(decided).trim()) throw new Error(`the ${arm} arm takes no decided-against block`);
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

// 071 batch filter: ONE Sonnet session over the combined backlog of several cases. `blocks`: [{ id, scope,
// items }] (cases with no proposal left out); the proposals are numbered 1..N across the whole batch, so
// the filter's answer is one `VERDICTS:` list and `sliceVerdicts` hands each case its part.
export function batchFilterPrompt(blocks) {
  if (!blocks.length) throw new Error('the batch filter needs at least one case with a proposal');
  let n = 0;
  const parts = blocks.map((b) => {
    const list = b.items.map((x) => `${++n}. ${x}`).join('\n');
    return `<neighbourhood-backlog case="${b.id}">\n${SCOPE_OPEN}\n${b.scope.trim()}\n${SCOPE_CLOSE}\n\n<scout-proposals>\n${list}\n</scout-proposals>\n</neighbourhood-backlog>`;
  });
  return `You are a senior reviewer filtering a backlog of refactor suggestions that a cheap scout raised on ${blocks.length} neighbourhood${blocks.length > 1 ? 's' : ''} of the maestro repository in the current directory. Each neighbourhood below has its own numbered suggestions; the numbers run on across the whole backlog. Decide for each suggestion whether it is a real structural problem worth a refactor ticket (file-it) or a false alarm, a matter of taste, something already fine or not worth a ticket (drop-it). Check each one against the source before you decide. Do not give a verdict on the code as a whole, do not add suggestions of your own, and do not edit anything.

${parts.join('\n\n')}

${FILTER_FORMAT}`;
}

// The verdicts of a batch -> one case's part: proposals offset+1..offset+n renumbered 1..n.
export function sliceVerdicts(v, offset, n) {
  const part = (a) => a.filter((i) => i > offset && i <= offset + n).map((i) => i - offset);
  return { structured: v.structured, kept: part(v.kept), dropped: part(v.dropped), unmarked: part(v.unmarked), outOfList: 0 };
}

// The batch's cost split over its cases, by the share of the batch's proposals each case contributed (an
// equal split when none did). Returns one share per count, summing to `cost`.
export function splitCost(cost, counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  return counts.map((k) => (total ? cost * (k / total) : cost / counts.length));
}

export const SUGGEST_OPEN = '<scout-suggestions>';
export const SUGGEST_CLOSE = '</scout-suggestions>';

// The change a review arm reads: a plant case's plant, else the harmless `reviewChange` (a doc comment).
export const reviewChangeOf = (c) => ((c.refactor.plant || []).length ? c.refactor.plant : c.refactor.reviewChange || []);

// The control: a normal review of the change, the 066 base prompt and format, nothing else.
export function reviewControlPrompt(diff) {
  return [reviewBasePrompt(diff), REVIEW_FORMAT].join('\n\n');
}

// The same review plus the scout's list. The suggestions are marked in their own `VERDICTS:` section that
// comes BEFORE the final `FINDINGS:` section, so the review's own verdict (its findings) stays the review's.
export function inlineReviewPrompt(diff, items) {
  if (!items.length) throw new Error('the inline review needs at least one scout suggestion');
  const list = items.map((x, i) => `${i + 1}. ${x}`).join('\n');
  return [
    reviewBasePrompt(diff),
    `A cheap scout also read the files around this change and raised the code-structure suggestions below. They are not part of your review of the change and must not appear in FINDINGS. Check each one against the source and, before the FINDINGS section, write a section that starts with the line \`VERDICTS:\` with exactly one line per suggestion, in the form \`- <number>: file-it: <reason>\` (a real structural problem worth a refactor ticket) or \`- <number>: drop-it: <reason>\` (a false alarm, a matter of taste, or not worth a ticket). Add no suggestions of your own.\n\n${SUGGEST_OPEN}\n${list}\n${SUGGEST_CLOSE}`,
    REVIEW_FORMAT,
  ].join('\n\n');
}

// Review prompts: the list is in the inline prompt and in no other.
export function reviewPromptProblems(arm, prompt) {
  const has = String(prompt).includes(SUGGEST_OPEN);
  if (!!REFACTOR_ARMS[arm].inline !== has) return [`the ${arm} review prompt ${has ? 'carries a scout list' : 'lacks the scout list'}`];
  if (!String(prompt).includes('FINDINGS:')) return [`the ${arm} review prompt lacks the FINDINGS format`];
  return [];
}

// The metrics primer is in the prompt of the primer arms and of no other arm; the spawn instruction only
// in the spawn arm.
export function promptProblems(arm, prompt) {
  const a = REFACTOR_ARMS[arm];
  const has = String(prompt).includes(PRIMER_OPEN);
  if (a.primer && !has) return [`the ${arm} arm's prompt carries no metrics primer`];
  if (!a.primer && has) return [`the ${arm} arm's prompt carries a metrics primer (only a primer arm may)`];
  const hasDecided = String(prompt).includes(DECIDED_OPEN);
  if (!!a.decided !== hasDecided) return [`the ${arm} arm's prompt ${hasDecided ? 'carries a decided-against block (only the decided-against arm may)' : 'lacks the decided-against block'}`];
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

const pathOf = (item) => { const i = item.indexOf(': '); return i > 0 ? item.slice(0, i) : item; };
const matches = (x, item) => !isAllClear(item) && new RegExp(x.file, 'i').test(pathOf(item)) && x.change.every((d) => new RegExp(d, 'i').test(item));

// c.refactor = { expected: [{ id, category, file: regex, change: [regex, ...] }], tolerated: [{ file, change }] }.
// An expected improvement counts as proposed when one proposal names its file (the path token, before the
// first ": ") and matches every change pattern. A proposal that matches an expected or a tolerated
// improvement is not a false finding; on EVERY case (clean or not) every other proposal is one (ticket 070,
// manager redirect). Some of them may be real improvements in real code: that is a pre-registered
// limitation, never a post-hoc judgement. `falseByCat` splits them by the category of the proposal's kind.
const KIND_CAT = { dedupe: 'dedupe', 'extract-helper': 'extract', extract: 'extract', 'align-pattern': 'align', align: 'align', 'break-cycle': 'cycle', cycle: 'cycle', 'remove-unused': 'unused', unused: 'unused' };
export const proposalCategory = (item) => {
  const rest = item.slice(item.indexOf(': ') + 2);
  const kind = /^\s*([a-z-]+)\s*:/i.exec(rest);
  return (kind && KIND_CAT[kind[1].toLowerCase()]) || 'other';
};
// An all-clear is text that says nothing is warranted ("no proposals", "nothing to do", "No refactor is
// warranted", "fine as written"): a formatting habit, not a proposal. It is its own count (`allClear`), per
// case and per arm, and is NOT a false finding (pre-registered in docs/evals.md), so an arm that writes
// all-clear lines instead of `PROPOSALS: none` is not scored worse for it.
// Prefix forms ("No proposals; ...") and whole-line forms ("none", "Leave it as is.", "No issues found.").
// Both apply ONLY to an item without the proposal shape (below): a `<file>: <kind>: <text>` line is always a
// proposal, whatever words its text contains.
const ALL_CLEAR_RE = /^\W*(?:no (?:further |other |additional )?(?:proposals?|refactors?|refactoring|changes?|improvements?|suggestions?)\b|nothing (?:to (?:do|change|propose|refactor|report|improve|suggest)|is warranted|warranted|needed|else)\b|n\/a\b|all (?:clear|good)\b)/i;
const ALL_CLEAR_LINE_RE = /^\W*(?:none|leave (?:it|this|them|that) (?:as is|alone)|no (?:issues|problems|findings|duplication|duplicates|cycles|unused exports)(?: found)?|not needed|nothing found|nothing to flag|none of (?:the|these|those) (?:files?|modules?|neighbours?|code)(?: \w+){0,3}|(?:the |these |those )?(?:files?|modules?|code) (?:are|is) all (?:good|fine|ok|clean))\W*$/i;
// An "it is fine" sentence, anchored to the whole (short) line.
const ABSENT_LINE_RE = /^(?!.*\b(?:but|however|although|though|yet|duplicat\w*|except)\b)\W*(?:[\w'`./ ,-]{0,60}?\b(?:is|are|looks?|seems?|appears?|remains?|stays?) (?:fine|correct|ok|okay|clean|good|appropriate|intended|harmless|justified)|(?:fine|ok|clean) as (?:written|is)|no (?:refactor|change|improvement|duplication|cycle)s? (?:is |are )?(?:needed|warranted|required))(?:[\w'`./ ,-]{0,40})?\W*$/i;
// A proposal line has the form `<file>: <kind>: <text>`; anything else is prose.
const SHAPE_RE = /^\S+:\s+[a-z][a-z-]*:\s/i;
export const isAllClear = (item) => {
  const t = item.trim();
  if (SHAPE_RE.test(t)) return false;
  return ALL_CLEAR_RE.test(t) || ALL_CLEAR_LINE_RE.test(t) || ABSENT_LINE_RE.test(t);
};
// Prose that names a file path is a claim about code, not an all-clear.
const PATHY_RE = /\b[\w.-]+\/[\w.-]+|\b[\w-]+\.(?:ts|tsx|js|mjs|cjs|json|md)\b/i;

// The proposals of an answer: the items under its `PROPOSALS:` header with the all-clear text taken out and
// counted. `PROPOSALS:` followed by prose on its own line (no bullet, not in the proposal form) is an
// all-clear too: a legitimate zero on a case with expected improvements, a "none" on a clean case, never a
// proposal and never an unstructured run.
export function proposalsOf(text) {
  const f = findingsOf(text, 'PROPOSALS');
  let items = f.items.slice();
  let allClear = 0;
  if (f.structured) {
    const hdr = [...String(text ?? '').matchAll(/^[ \t*#>_`-]*PROPOSALS[ \t*`_]*:[ \t*`_]*(.*)$/gim)].pop();
    const rest = hdr ? hdr[1].trim() : '';
    // findingsOf reads bullet lines only: a `<file>: <kind>: <text>` line with no bullet under the header is
    // a proposal too. A line that follows a bullet or another item without a blank line is its continuation.
    // A bare marker on the header line (`PROPOSALS: -`) is an empty bullet: findingsOf keeps it as the item
    // "-", the next dashless shaped line is its content (picked up below), and the marker itself is dropped.
    const bare = /^(?:[-*•]|\d+[.)])$/.test(rest);
    let scanned = 0;
    if (hdr) {
      const after = String(text ?? '').slice(hdr.index + hdr[0].length).split('\n').slice(1);
      // Same bullet test as findingsOf (on the raw line: an empty `- ` is a bullet); a bullet WITH text on
      // the header line opens an item too, so a shaped line right after it is its continuation.
      const isBullet = (s) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(s);
      let inBullet = !bare && isBullet(`${rest} `);
      for (const raw of after) {
        const line = raw.trim();
        if (!line) { inBullet = false; continue; }
        if (isBullet(raw)) inBullet = true;
        else if (!inBullet && SHAPE_RE.test(line)) { items.push(line); scanned++; }
      }
    }
    const bullet = /^(?:[-*•]|\d+[.)])\s+/.exec(rest);
    if (bare && items.length) {
      items.shift();
      if (!scanned) allClear++;
    } else if (bullet) {
      // `PROPOSALS: - a.ts: dedupe: x`: a bullet on the header line is the first item (findingsOf drops it).
      items.unshift(rest.slice(bullet[0].length).trim());
    } else if (rest && !f.none && items.length && !SHAPE_RE.test(rest) && !PATHY_RE.test(rest)) {
      // Header prose that names no file is an all-clear; prose naming a path stays one item (a claim).
      items.shift(); allClear++;
    }
  }
  const real = items.filter((it) => !isAllClear(it));
  allClear += items.length - real.length;
  return { ...f, items: real, allClear };
}

// What one proposal is, for the usefulness metric (bench/refactor-audit.mjs): `expected:<id>`, `tolerated`,
// `allclear` or `rest` (judged by the fixed audit). The same precedence as gradeItems.
export function classifyItem(c, item) {
  const x = (c.refactor.expected || []).find((e) => matches(e, item));
  if (x) return `expected:${x.id}`;
  if ((c.refactor.tolerated || []).some((e) => matches(e, item))) return 'tolerated';
  return isAllClear(item) ? 'allclear' : 'rest';
}

export function gradeItems(c, items) {
  const exp = c.refactor.expected || [];
  const tol = c.refactor.tolerated || [];
  const found = exp.map((x) => ({ id: x.id, category: x.category, found: items.some((it) => matches(x, it)) }));
  let credited = 0;
  let tolerated = 0;
  let allClear = 0;
  let rest = 0;
  const falseByCat = {};
  for (const it of items) {
    if (exp.some((x) => matches(x, it))) credited++;
    else if (tol.some((x) => matches(x, it))) tolerated++;
    else if (isAllClear(it)) allClear++;
    else { rest++; const k = proposalCategory(it); falseByCat[k] = (falseByCat[k] || 0) + 1; }
  }
  const clean = !exp.length;
  return { planted: exp.length, found: found.filter((x) => x.found).length, expected: found, proposals: items.length - allClear, credited, tolerated, allClear, falseFindings: rest, falseByCat, clean };
}

export function gradeRefactor(c, text) {
  const f = proposalsOf(text);
  const g = gradeItems(c, f.items);
  return { structured: f.structured, none: f.none, ...g, allClear: g.allClear + f.allClear, items: f.items };
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
  return gradeFiltered(c, scoutText, (n) => (filterText == null ? null : verdictsOf(filterText, n)));
}

// 071: the same grade where the verdicts come from a batch filter or an inline review. `verdictsFor(n)` gets
// the case's number of scout proposals and returns the case's verdicts (or null when no session ran).
export function gradeFiltered(c, scoutText, verdictsFor) {
  const f = proposalsOf(scoutText); // all-clear text never reaches the filter; it is counted from the scout
  const scout = { ...gradeItems(c, f.items), allClear: f.allClear };
  if (!f.items.length) return { ...gradeItems(c, []), allClear: f.allClear, structured: f.structured, none: f.none, items: [], scout, anchor: anchoring(0, null), verdicts: null, lostByFilter: 0, falseRemoved: 0 };
  const v = verdictsFor(f.items.length);
  const survivors = v ? v.kept.map((i) => f.items[i - 1]) : [];
  const g = gradeItems(c, survivors);
  return {
    structured: f.structured, none: f.none, ...g, allClear: f.allClear, items: survivors, scout, verdicts: v, anchor: anchoring(f.items.length, v),
    lostByFilter: scout.found - g.found, falseRemoved: scout.falseFindings - g.falseFindings,
  };
}

// 071 review sessions. A review's own verdict is its FINDINGS section: `hasFindings` is the merge-blocking
// yes/no, the list's effect on it is the cells where inline and control differ.
export function reviewVerdictOf(text) {
  const f = findingsOf(text, 'FINDINGS');
  return { structured: f.structured, none: f.none, findings: f.items.length, hasFindings: f.items.length > 0 };
}
const noRefactorGrade = { planted: 0, found: 0, expected: [], proposals: 0, credited: 0, tolerated: 0, allClear: 0, falseFindings: 0, falseByCat: {}, clean: true, items: [] };
// The control review: scored on nothing in the refactor tables (it is the cost and verdict reference).
export function gradeReviewControl(text) {
  const rv = reviewVerdictOf(text);
  return { ...noRefactorGrade, structured: rv.structured, none: rv.none, review: rv };
}
// The inline review: the scout's list graded by the review's VERDICTS (marks) like a filter, plus the review's
// own verdict. When the scout proposed nothing, no inline session ran: `reviewText` is null.
export function gradeInline(c, scoutText, reviewText) {
  const g = gradeFiltered(c, scoutText, (n) => (reviewText == null ? null : verdictsOf(reviewText, n)));
  return { ...g, review: reviewText == null ? null : reviewVerdictOf(reviewText) };
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

// Problems of the answers themselves: a scout, baseline or spawn answer with no `PROPOSALS:` section, or a
// filter answer with no `VERDICTS:` section, would otherwise grade as a valid run with nothing proposed and
// no false finding. Such a run is invalid (not counted, listed in the report); the cell is rerun or reported.
export function answerProblems(arm, grade) {
  const p = [];
  if (!grade.structured && !grade.review) p.push(`${arm}: the answer has no PROPOSALS section (unstructured); the run is not counted`);
  if (grade.verdicts && !grade.verdicts.structured) p.push(`${arm}: the filter answer has no VERDICTS section (unstructured); the run is not counted`);
  if (grade.review && !grade.review.structured) p.push(`${arm}: the review answer has no FINDINGS section (unstructured); the run is not counted`);
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
// Per arm: expected improvements kept by category and overall, false findings kept (every proposal beyond
// the expected ones, on every case; by proposal category in falseByCat), cost, anchoring (pipeline), what
// the filter lost or removed.
export function tally(allRows, allPlanned) {
  const out = {};
  const rows = allRows.filter((r) => !isControlArm(r.arm)); // the control review is a cost reference, not an arm
  const planned = allPlanned?.filter((p) => !isControlArm(p.arm));
  for (const r of pairedRows(rows, planned)) {
    const t = (out[r.arm] ||= {
      cats: Object.fromEntries(CATEGORIES.map((k) => [k, blank()])), overall: blank(), falseFindings: 0, allClear: 0, falseByCat: {}, cleanRuns: 0, runs: 0, cost: 0,
      anchor: { runs: 0, scout: 0, kept: 0, unchanged: 0 }, lostByFilter: 0, falseRemoved: 0, scoutFound: 0, scoutFalse: 0,
    });
    t.runs++;
    t.cost += rowCost(r);
    if (r.grade.clean) t.cleanRuns++;
    t.falseFindings += r.grade.falseFindings || 0;
    t.allClear += r.grade.allClear || 0;
    for (const [k, n] of Object.entries(r.grade.falseByCat || {})) t.falseByCat[k] = (t.falseByCat[k] || 0) + n;
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

// Does the scout's list change the review's own verdict? Per paired cell with a list, the inline review's
// has-findings against the control review's; `flips` counts the cells where they differ. Cells are those
// where both reviews are valid and the inline session ran.
export function reviewShift(rows, planned) {
  const ok = new Set(pairedRows(rows.filter((r) => !isControlArm(r.arm)), planned?.filter((p) => !isControlArm(p.arm))).map((r) => `${r.case}#${r.run}`));
  const ctl = new Map(rows.filter((r) => r.arm === REVIEW_CONTROL && isValidRow(r)).map((r) => [`${r.case}#${r.run}`, r]));
  let cells = 0;
  let flips = 0;
  let toFindings = 0;
  let fromFindings = 0;
  for (const r of rows.filter((x) => x.arm === 'haiku-reviewer-inline' && isValidRow(x) && x.grade.review)) {
    const k = `${r.case}#${r.run}`;
    const cr = ctl.get(k);
    if (!ok.has(k) || !cr) continue;
    cells++;
    const a = r.grade.review.hasFindings;
    const b = cr.grade.review.hasFindings;
    if (a !== b) { flips++; if (a) toFindings++; else fromFindings++; }
  }
  return { cells, flips, toFindings, fromFindings };
}

// Kept improvements: the 051-style rule on { found, planted } (verdict in review.mjs): `helps`, `hurts`,
// `no effect shown` or `inconclusive`, per category, the overall never overriding a category.
export const improvementVerdict = (base, x) => verdict(base, x);

// Kept false findings (every proposal beyond the expected ones, on every case; overall or in one proposal
// category), an arm against the baseline: fewer or more by at least 3, else no difference shown. Both arms
// are scored on the same cells.
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
  const note = saturated ? `saturated: the baseline missed ${missed} of ${t.overall.planted}; rework the cases` : floor ? `floor: the baseline found ${t.overall.found} of ${t.overall.planted}; rework the cases or the grader` : `ok: the baseline missed ${missed} of ${t.overall.planted} and kept ${t.falseFindings} false finding(s) over ${t.runs} case run(s)`;
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
  L.push('## Per case and arm', '', '| case | arm | run | valid | kept / expected | proposals kept | false findings | all-clear lines | structured | anchoring (kept/scout) | cost $ (scout + filter) | turns |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const g = r.grade;
    const an = g.anchor ? `${g.anchor.kept}/${g.anchor.scout}` : '-';
    const cost = r.m2 ? `${usd(rowCost(r))} (${usd(r.m?.cost)} + ${usd(r.m2.cost)})` : usd(rowCost(r));
    L.push(`| ${r.case} | ${r.arm} | ${r.run} | ${isValidRow(r) ? 'yes' : 'NO'} | ${g.found}/${g.planted} | ${g.proposals} | ${g.falseFindings}${g.clean ? ' (clean case)' : ''} | ${g.allClear || 0} | ${g.structured ? 'yes' : 'no (unstructured)'}${g.verdicts ? ` / filter ${g.verdicts.structured ? 'yes' : 'no (unstructured)'}` : ''} | ${an} | ${cost} | ${r.m?.turns ?? 'n/a'} |`);
  }
  const t = tally(rows, meta.planned);
  const arms = REFACTOR_ARM_NAMES.filter((a) => t[a]);
  const arow = rows.filter((r) => !isControlArm(r.arm));
  const nValid = arow.filter(isValidRow).length;
  const nCounted = pairedRows(arow, meta.planned?.filter((p) => !isControlArm(p.arm))).length;
  L.push('', `Counted: ${nCounted} of ${nValid} valid runs. A (case, run) cell is scored only when every arm planned there has a valid run, so every arm is scored on the same cells; ${nValid - nCounted} valid run(s) were left out because another arm's cell is missing or invalid.`);
  const fp = (x) => `${x.found}/${x.planted}`;
  L.push('', '## Per arm (paired valid runs only; the pipeline is scored on what survives the filter)', '', `| arm | valid runs | ${CATEGORIES.join(' | ')} | overall kept | false findings kept (all cases) | all-clear lines (not false findings) | cost per run |`, `|---|---|${CATEGORIES.map(() => '---').join('|')}|---|---|---|---|`);
  for (const a of arms) L.push(`| ${a} | ${t[a].runs} | ${CATEGORIES.map((k) => fp(t[a].cats[k])).join(' | ')} | ${fp(t[a].overall)} | ${t[a].falseFindings} | ${t[a].allClear} | ${usd(t[a].cost / t[a].runs)} |`);
  const FCATS = [...CATEGORIES, 'other'];
  L.push('', '## False findings kept, by the category of the proposal (every proposal beyond the expected ones, on every case)', '', `| arm | ${FCATS.join(' | ')} | total |`, `|---|${FCATS.map(() => '---').join('|')}|---|`);
  for (const a of arms) L.push(`| ${a} | ${FCATS.map((k) => t[a].falseByCat[k] || 0).join(' | ')} | ${t[a].falseFindings} |`);
  const pipe = arms.filter((a) => REFACTOR_ARMS[a].filter || REFACTOR_ARMS[a].batch || REFACTOR_ARMS[a].inline);
  if (rows.some((r) => r.arm === 'haiku-reviewer-inline')) {
    const s = reviewShift(rows, meta.planned);
    L.push('', '## Does the scout\'s list change the review\'s own verdict (inline vs the same review without the list)', '', `Cells with both reviews valid and a list: ${s.cells}. The has-findings verdict differs in ${s.flips} (${s.toFindings} gained findings with the list, ${s.fromFindings} lost them).`);
  }
  if (pipe.length) {
    L.push('', '## Pipeline: anchoring and what the filter did', '', '| arm | runs with a list | scout proposals | kept | anchoring | lists passed unchanged | expected lost by the filter | false findings removed by the filter |', '|---|---|---|---|---|---|---|---|');
    for (const a of pipe) {
      const x = t[a];
      L.push(`| ${a} | ${x.anchor.runs} | ${x.anchor.scout} | ${x.anchor.kept} | ${x.anchor.scout ? `${((x.anchor.kept / x.anchor.scout) * 100).toFixed(0)}%` : 'n/a'} | ${x.anchor.unchanged} | ${x.lostByFilter} | ${x.falseRemoved} |`);
    }
  }
  if (t[REFACTOR_BASELINE]) {
    const B = t[REFACTOR_BASELINE];
    L.push('', `## Verdicts against ${REFACTOR_BASELINE} (rule in docs/evals.md, Ticket 070)`, '', `| arm | ${CATEGORIES.join(' | ')} | overall (never overrides a category) | false findings vs baseline (all) | false findings by category (arm vs baseline) | cost per run vs baseline |`, `|---|${CATEGORIES.map(() => '---').join('|')}|---|---|---|---|`);
    const cell = (a, g) => { const v = improvementVerdict(g === 'overall' ? B.overall : B.cats[g], g === 'overall' ? t[a].overall : t[a].cats[g]); return `${v.v} (missed ${v.mb} -> ${v.mx})`; };
    for (const a of arms) {
      if (a === REFACTOR_BASELINE) continue;
      const dc = B.cost ? `${(((t[a].cost / t[a].runs) / (B.cost / B.runs) - 1) * 100).toFixed(0)}%` : 'n/a';
      const fb = FCATS.map((k) => { const b = B.falseByCat[k] || 0; const x = t[a].falseByCat[k] || 0; return `${k} ${x} vs ${b}: ${falseVerdict(b, x)}`; }).join('; ');
      L.push(`| ${a} | ${CATEGORIES.map((k) => cell(a, k)).join(' | ')} | ${cell(a, 'overall')} | ${t[a].falseFindings} vs ${B.falseFindings}: ${falseVerdict(B.falseFindings, t[a].falseFindings)} | ${fb} | ${dc} |`);
    }
    const ps = pilotScreen(rows, meta.planned);
    L.push('', `Baseline screen: ${ps.note}`);
  }
  return L.join('\n') + '\n';
}
