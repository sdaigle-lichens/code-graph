// 073 decided-against list: pure helpers for the `haiku-decided-against` scout arm (docs/evals.md, Ticket 073).
// A decided-against entry records a refactor finding that a person or the reviewer declined: the code it is
// about (file + symbol), the contentHash of that code when it was declined, the declined claim and the reason.
// The scribe only records; it never judges. Rules measured here:
//   - an entry EXPIRES when the contentHash of its code changes (or the code is gone): it is not injected;
//   - only entries for files of the case's NEIGHBOURHOOD (the stored scope) are injected, so the prompt stays small;
//   - the list is hand-built at $0 from 071 paid-run proposals that are not expected improvements
//     (bench/refactor-decided-prep.mjs) and committed as bench/refactor/decided-against.json before any run.
// No filesystem here except loadDecided(); no child process.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECIDED_CLOSE, DECIDED_OPEN, classifyItem } from './refactor.mjs';
import { isValidRow, pairedRows } from './review.mjs';

export const DECIDED_FILE = join(dirname(fileURLToPath(import.meta.url)), 'refactor', 'decided-against.json');
export const DECIDED_ARM = 'haiku-decided-against';
export const DECIDED_CONTROL = 'haiku-metrics-primer';

// ---- contentHash of the code an entry is about ---------------------------------------------------------

const normalize = (s) => s.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').trim();
export const hashText = (s) => createHash('sha256').update(normalize(s)).digest('hex').slice(0, 16);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The source text of a top-level declaration: from the line that declares `symbol` to the first line that
// closes it at column 0 (`}`, `};`, `)`, `);`, `]`, `];`), or the declaration line itself when it ends in `;`.
// null when the symbol is not declared at the top level of `text`.
export function symbolText(text, symbol) {
  const lines = String(text).split('\n');
  const decl = new RegExp(`^(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var|class|interface|type|enum)\\s+${esc(symbol)}(?![A-Za-z0-9_$])`);
  const start = lines.findIndex((l) => decl.test(l));
  if (start < 0) return null;
  if (/;\s*$/.test(lines[start]) && !/[{(\[]\s*$/.test(lines[start])) return lines[start];
  for (let i = start + 1; i < lines.length; i++) if (/^[}\])]+[;,]?\s*$/.test(lines[i])) return lines.slice(start, i + 1).join('\n');
  return lines.slice(start).join('\n');
}

// The contentHash of what an entry is about, in `fileText`: its symbol's declaration, else the whole file.
// null when the symbol is gone (the entry then counts as expired).
export function codeHash(fileText, symbol) {
  if (fileText == null) return null;
  if (!symbol) return hashText(fileText);
  const t = symbolText(fileText, symbol);
  return t == null ? null : hashText(t);
}

// ---- the stored list -------------------------------------------------------------------------------------

// Problems of a stored list: every entry has a code reference (file), a contentHash, a claim and a reason,
// the match patterns the report counts repeats with, and unique ids.
export function decidedStoredProblems(list) {
  const p = [];
  if (!list || !Array.isArray(list.entries) || !list.entries.length) return ['the decided-against list has no entries'];
  const ids = new Set();
  for (const e of list.entries) {
    const tag = e?.id || '(no id)';
    if (!e || !e.id) p.push('an entry has no id');
    else if (ids.has(e.id)) p.push(`${tag}: duplicate id`);
    else ids.add(e.id);
    for (const k of ['file', 'contentHash', 'claim', 'reason', 'kind']) if (!e || typeof e[k] !== 'string' || !e[k].trim()) p.push(`${tag}: no ${k}`);
    if (e?.contentHash && !/^[0-9a-f]{16}$/.test(e.contentHash)) p.push(`${tag}: contentHash is not 16 hex digits`);
    if (!e?.match || typeof e.match.file !== 'string' || !Array.isArray(e.match.change) || !e.match.change.length) p.push(`${tag}: no match patterns`);
  }
  return p;
}

export function loadDecided(file = DECIDED_FILE) {
  if (!existsSync(file)) throw new Error(`missing ${file}; generate it with node bench/refactor-decided-prep.mjs`);
  const list = JSON.parse(readFileSync(file, 'utf8'));
  const problems = decidedStoredProblems(list);
  if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`);
  return list;
}

// ---- neighbourhood and expiry ----------------------------------------------------------------------------

// The files of a stored scope (`- <path> (concept ...)` lines).
export const scopeFiles = (scope) => [...String(scope).matchAll(/^- (\S+) \(concept /gm)].map((m) => m[1]);

// Which entries a case gets. `readFile(path)` returns the file's text in the case's workspace (the tree after
// the case's plant), or null when missing.
//   outside: the entry's file is not in the neighbourhood: never injected;
//   expired: the file is in the neighbourhood but its code's contentHash changed (or the code is gone);
//   inject: the rest, in list order.
export function decidedFor(entries, scope, readFile) {
  const inScope = new Set(scopeFiles(scope));
  const inject = [];
  const expired = [];
  const outside = [];
  for (const e of entries) {
    if (!inScope.has(e.file)) { outside.push(e); continue; }
    if (codeHash(readFile(e.file), e.symbol) === e.contentHash) inject.push(e);
    else expired.push(e);
  }
  return { inject, expired, outside };
}

// The prompt block for the injected entries.
export function decidedBlock(entries) {
  if (!entries.length) throw new Error('the decided-against block needs at least one entry');
  const lines = entries.map((e, i) => `${i + 1}. ${e.file}${e.symbol ? ` (\`${e.symbol}\`)` : ''}: ${e.claim} Declined because: ${e.reason}`);
  return `${DECIDED_OPEN}\nFindings on files of this neighbourhood that a person or a reviewer has already considered and declined. They are listed only while the code they are about is unchanged. Do not propose them again. Everything else in the neighbourhood is still open: report any other improvement you find.\n\n${lines.join('\n')}\n${DECIDED_CLOSE}`;
}

// ---- repeats, new findings ---------------------------------------------------------------------------------

const pathOf = (item) => { const i = item.indexOf(': '); return i > 0 ? item.slice(0, i) : item; };
export const entryMatches = (e, item) => new RegExp(e.match.file, 'i').test(pathOf(item)) && e.match.change.every((d) => new RegExp(d, 'i').test(item));
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// A cell's proposals against the list: `repeated` = the distinct entries of `listed` (ids) that at least one
// proposal repeats; `repeatProposals` = the proposals that repeat one; `fresh` = the distinct proposals that are
// beyond the expected and tolerated ones and repeat NO entry of the whole list (new findings). `c` is the case.
export function cellRepeats(c, items, entries, listed) {
  const mine = entries.filter((e) => listed.includes(e.id));
  const repeated = new Set();
  let repeatProposals = 0;
  for (const it of items) {
    if (classifyItem(c, it) !== 'rest') continue; // an expected or tolerated proposal is never a repeat of the list
    const hit = mine.filter((e) => entryMatches(e, it));
    if (hit.length) { repeatProposals++; for (const e of hit) repeated.add(e.id); }
  }
  const fresh = new Set();
  for (const it of items) if (classifyItem(c, it) === 'rest' && !entries.some((e) => entryMatches(e, it))) fresh.add(norm(it));
  return { repeated: repeated.size, repeatProposals, fresh: fresh.size };
}

// ---- verdict ---------------------------------------------------------------------------------------------

// Pre-registered thresholds (docs/evals.md, Ticket 073).
export const REPEAT_CUT = 0.5; // listed findings the arm repeats must fall by at least this share
export const RECALL_KEEP = 0.9; // expected improvements found must stay at least this share of the control's
export const NEW_KEEP = 0.5; // new findings must stay at least this share of the control's
export const MIN_CONTROL_REPEATS = 6; // under this many repeats in the control the cut cannot be read
export const PILOT_MIN_REPEATS = 5; // pilot stop rule: the control repeats at least this many listed entries over its cells

// ctl, arm: { repeated, found, planted, fresh, cost, cells }. Checked in order, first match wins.
export function decidedVerdict(ctl, arm) {
  if (ctl.cells !== arm.cells || !ctl.cells) return { v: 'not comparable', note: 'the two arms have different valid-cell counts' };
  if (ctl.repeated < MIN_CONTROL_REPEATS) return { v: 'inconclusive', note: `the plain scout repeated only ${ctl.repeated} listed entries over ${ctl.cells} cells (under ${MIN_CONTROL_REPEATS}): the cut cannot be read` };
  const cut = (ctl.repeated - arm.repeated) / ctl.repeated;
  const cutOk = cut >= REPEAT_CUT;
  const recallOk = ctl.found === 0 ? arm.found >= 0 : arm.found >= ctl.found * RECALL_KEEP;
  const newOk = ctl.fresh === 0 ? true : arm.fresh >= ctl.fresh * NEW_KEEP;
  const facts = `repeats ${ctl.repeated} -> ${arm.repeated} (${(cut * 100).toFixed(0)}% cut), expected found ${ctl.found} -> ${arm.found} of ${ctl.planted}, new findings ${ctl.fresh} -> ${arm.fresh}`;
  if (!cutOk) return { v: 'no cut shown', note: facts };
  if (!recallOk) return { v: 'cuts repeats but loses recall', note: facts };
  if (!newOk) return { v: 'cuts repeats but over-broad', note: `${facts}: the arm also lost unlisted findings` };
  return { v: 'cuts repeats and keeps recall', note: facts };
}

// ---- report ----------------------------------------------------------------------------------------------

const usd = (n) => `$${n.toFixed(3)}`;

// rows: runs.json rows; planned: the plan; cases: Map id -> case; entries: the list. One section for the two arms.
export function decidedReport(rows, planned, cases, entries) {
  const arms = [DECIDED_CONTROL, DECIDED_ARM];
  const only = (a) => a.filter((r) => arms.includes(r.arm));
  const paired = pairedRows(only(rows), planned ? only(planned) : undefined);
  const sum = () => ({ repeated: 0, repeatProposals: 0, found: 0, planted: 0, fresh: 0, cost: 0, cells: 0 });
  const t = { [DECIDED_CONTROL]: sum(), [DECIDED_ARM]: sum() };
  const L = ['', '## Decided-against list (073): the plain scout against the scout told what was declined', ''];
  L.push('| case | run | listed in the neighbourhood | injected | expired | arm | listed entries repeated | proposals repeating one | expected found | new findings |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const r of paired) {
    const c = cases.get(r.case);
    const listed = r.grade.decided?.listed || r.grade.decided?.injected || [];
    const cr = cellRepeats(c, r.grade.items || [], entries, listed);
    const x = t[r.arm];
    x.cells++; x.repeated += cr.repeated; x.repeatProposals += cr.repeatProposals; x.fresh += cr.fresh; x.found += r.grade.found; x.planted += r.grade.planted; x.cost += r.m?.cost || 0;
    L.push(`| ${r.case} | ${r.run} | ${listed.length} | ${r.grade.decided?.injected?.length ?? '-'} | ${r.grade.decided?.expired?.length ?? '-'} | ${r.arm} | ${cr.repeated} | ${cr.repeatProposals} | ${r.grade.found}/${r.grade.planted} | ${cr.fresh} |`);
  }
  if (!t[DECIDED_CONTROL].cells || !t[DECIDED_ARM].cells) return [...L, '', 'No paired valid cell for both arms.'].join('\n') + '\n';
  L.push('', '| arm | paired cells | listed entries repeated | proposals repeating one | expected found | new findings | cost per cell |', '|---|---|---|---|---|---|---|');
  for (const a of arms) L.push(`| ${a} | ${t[a].cells} | ${t[a].repeated} | ${t[a].repeatProposals} | ${t[a].found}/${t[a].planted} | ${t[a].fresh} | ${usd(t[a].cost / t[a].cells)} |`);
  const v = decidedVerdict(t[DECIDED_CONTROL], t[DECIDED_ARM]);
  L.push('', `Verdict (rule in docs/evals.md, Ticket 073): **${v.v}** (${v.note}).`);
  L.push(`Pilot screen (1-run pilot): the plain scout repeated ${t[DECIDED_CONTROL].repeated} listed entries over ${t[DECIDED_CONTROL].cells} cells; the plan stops under ${PILOT_MIN_REPEATS}${t[DECIDED_CONTROL].repeated < PILOT_MIN_REPEATS ? ': STOP, amend the plan before the paid run' : ': ok'}.`);
  const bad = only(rows).filter((r) => !isValidRow(r)).length;
  if (bad) L.push(`${bad} invalid run(s) are not counted.`);
  return L.join('\n') + '\n';
}
