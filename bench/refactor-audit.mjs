#!/usr/bin/env node
// 071 usefulness metric and its FIXED blind audit (docs/evals.md, Ticket 071). Pure functions (unit-tested)
// plus a guarded CLI:
//   node bench/refactor-audit.mjs <results-dir> --pool    write audit-pool.json (every judged item, arm labels
//                                                         stripped, shuffled by a fixed hash) and audit-pool.txt
//                                                         (the items that need a hand verdict)
//   node bench/refactor-audit.mjs <results-dir> --score   read audit-verdicts.txt, write audit-report.md
// A useful finding is an expected improvement the arm kept, or a kept proposal the audit confirmed: by the
// registry of improvements the 070 audit confirmed (KNOWN_CONFIRMED), by a mechanical grep of the pinned tree
// (an "unused" claim whose name is mentioned only in barrels, a "copies" claim whose function is defined in
// two or more files), or by a hand verdict written on the blinded pool. A proposal that none of them
// confirms is noise; tolerated and repeated findings are neutral.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidRow, pairedRows } from './review.mjs';
import { CATEGORIES, REFACTOR_BASELINE, classifyItem, isControlArm, proposalCategory, rowCost } from './refactor.mjs';

// Improvements the 070 audit confirmed in the pinned tree (docs/evals.md, Ticket 070 results). `change`:
// every regex must match the proposal text.
export const KNOWN_CONFIRMED = [
  { key: 'readGlobalHandoff-copies', category: 'dedupe', change: ['readGlobalHandoff', '(copies|duplicat|same|identical|three|3|each|shared|helper|extract)'] },
  { key: 'tasks-ready-rule-twice', category: 'dedupe', change: ['(buildStatusMap|tasksFromFiles)', '(blockedBy\\.every|doneSet|ready|blocked)', '(twice|both|duplicat|repeat|same|shared|helper)'] },
  { key: 'tasks-section-slicing', category: 'extract', change: ['parseBlockedBy', 'extractPostMortemSection'] },
  { key: 'session-ref-interfaces', category: 'dedupe', change: ['SessionRef', 'SessionTitleRef'] },
  { key: 'sweep-removal-loop', category: 'extract', change: ['sweepStaleSessions', 'deleteSession', '(sessionDirsFor|rmSync|remov|delet)'] },
  { key: 'sweep-options-defaults', category: 'extract', change: ['(now|idleCapMs|options)', '(default|resolv)', '(sweepStaleSessions|deleteSession|listDeletableSessions)'] },
  { key: 'readSessionLog-barrel-only', category: 'unused', change: ['readSessionLog', '(unused|nothing|never|only|barrel|re-?export)'] },
];

export const registryKey = (item) => KNOWN_CONFIRMED.find((k) => k.change.every((d) => new RegExp(d, 'i').test(item))) || null;

const BARREL = /(^|\/)index\.ts$/;
const names = (item) => [...new Set([...item.matchAll(/`([A-Za-z_$][\w$]{3,})`/g)].map((m) => m[1]))];
const pathOf = (item) => { const i = item.indexOf(': '); return i > 0 ? item.slice(0, i) : item; };

// The mechanical checks, over an injected `ctx` ({ mentions(name) -> files, defs(name) -> files }, both a
// grep of the pinned tree). null when no check applies: the item goes to the hand list.
export function mechanicalCheck(item, ctx) {
  const ns = names(item);
  if (!ns.length) return null;
  if (proposalCategory(item) === 'unused') {
    for (const n of ns) {
      const files = ctx.mentions(n);
      if (!files.length) continue;
      const self = pathOf(item);
      const users = files.filter((f) => !BARREL.test(f) && !self.endsWith(f) && !f.endsWith(self));
      if (!users.length) return { status: 'confirmed', key: `unused:${n}`, category: 'unused', evidence: `grep: \`${n}\` is mentioned only in ${files.join(', ')}` };
      return { status: 'unconfirmed', evidence: `grep: \`${n}\` is used in ${users.slice(0, 3).join(', ')}` };
    }
    return null;
  }
  if (['dedupe', 'extract'].includes(proposalCategory(item))) {
    for (const n of ns) {
      const defs = ctx.defs(n);
      if (defs.length >= 2) return { status: 'confirmed', key: `copies:${n}`, category: proposalCategory(item), evidence: `grep: \`${n}\` is defined in ${defs.join(', ')}` };
    }
  }
  return null;
}

// Deterministic shuffle key: arm labels never enter it.
const hash = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// The blinded pool: every kept proposal beyond the expected and tolerated ones, once per (case, text).
// `cases`: a map id -> case. Returns [{ id, case, item, auto }] with auto = registry or mechanical result.
export function buildPool(rows, cases, ctx) {
  const seen = new Map();
  for (const r of rows) {
    if (isControlArm(r.arm) || !isValidRow(r)) continue;
    for (const item of r.grade.items || []) {
      if (classifyItem(cases.get(r.case), item) !== 'rest') continue;
      const k = `${r.case}\n${norm(item)}`;
      if (!seen.has(k)) seen.set(k, { case: r.case, item });
    }
  }
  const list = [...seen.entries()].sort((a, b) => hash(a[0]) - hash(b[0]) || (a[0] < b[0] ? -1 : 1));
  return list.map(([, e], i) => {
    const reg = registryKey(e.item);
    const auto = reg ? { status: 'confirmed', key: reg.key, category: reg.category, evidence: 'registry (confirmed by the 070 audit)' } : mechanicalCheck(e.item, ctx);
    return { id: `p${i + 1}`, case: e.case, item: e.item, auto };
  });
}

export const poolText = (pool) => pool.filter((p) => !p.auto).map((p) => `${p.id} [${p.case}] ${p.item}`).join('\n') + '\n';

// `<id>: confirmed <issue-key>: <evidence>` or `<id>: unconfirmed: <reason>`.
export function parseVerdicts(text) {
  const out = new Map();
  for (const line of String(text ?? '').split('\n')) {
    const m = /^\s*(p\d+)\s*:\s*(confirmed|unconfirmed)\b\s*([^:]*?)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const confirmed = m[2].toLowerCase() === 'confirmed';
    out.set(m[1], confirmed ? { status: 'confirmed', key: m[3] || m[1], evidence: m[4] } : { status: 'unconfirmed', evidence: `${m[3]} ${m[4]}`.trim() });
  }
  return out;
}

const judgeOf = (entry, manual) => entry.auto || manual.get(entry.id) || { status: 'unjudged' };

// Useful findings per arm over the paired valid cells. Per row: each found expected improvement is one
// useful finding; each pool item confirmed counts once per distinct key per row; unconfirmed and unjudged
// items are noise; tolerated and repeated items are neutral.
export function scoreUseful(rows, planned, cases, pool, manual = new Map()) {
  const by = new Map(pool.map((p) => [`${p.case}\n${norm(p.item)}`, p]));
  const arow = rows.filter((r) => !isControlArm(r.arm));
  const out = {};
  for (const r of pairedRows(arow, planned?.filter((p) => !isControlArm(p.arm)))) {
    const t = (out[r.arm] ||= { runs: 0, cost: 0, useful: 0, noise: 0, unjudged: 0, neutral: 0, byCat: Object.fromEntries(CATEGORIES.map((k) => [k, 0])), expected: 0, audited: 0 });
    t.runs++;
    t.cost += rowCost(r);
    const keys = new Set();
    for (const e of r.grade.expected || []) if (e.found) { t.useful++; t.expected++; t.byCat[e.category] = (t.byCat[e.category] || 0) + 1; keys.add(e.id); }
    for (const item of r.grade.items || []) {
      const cls = classifyItem(cases.get(r.case), item);
      if (cls.startsWith('expected:')) { if (keys.has(cls.slice(9))) t.neutral++; continue; }
      if (cls === 'tolerated') { t.neutral++; continue; }
      if (cls === 'allclear') continue;
      const j = judgeOf(by.get(`${r.case}\n${norm(item)}`) || { id: '' }, manual);
      if (j.status === 'confirmed') {
        const key = j.key;
        if (keys.has(key)) { t.neutral++; continue; }
        keys.add(key); t.useful++; t.audited++;
        const cat = j.category || proposalCategory(item);
        t.byCat[cat] = (t.byCat[cat] || 0) + 1;
      } else { t.noise++; if (j.status === 'unjudged') t.unjudged++; }
    }
  }
  for (const t of Object.values(out)) { t.perDollar = t.cost > 0 ? t.useful / t.cost : null; t.noiseShare = t.useful + t.noise ? t.noise / (t.useful + t.noise) : null; }
  return out;
}

// The pre-registered rule for one arm against the baseline (docs/evals.md, Ticket 071): better per dollar
// when its useful-per-dollar is at least 1.5 times the baseline's, it keeps at least 70% of the baseline's
// useful findings, its noise share is at most the baseline's plus 10 points, and no category loses 3 or
// more useful findings. The overall never overrides a category: a losing category blocks it.
export function usefulVerdict(base, x) {
  const losing = CATEGORIES.filter((k) => (base.byCat[k] || 0) - (x.byCat[k] || 0) >= 3);
  const ratio = base.perDollar && x.perDollar != null ? x.perDollar / base.perDollar : null;
  const recall = base.useful ? x.useful / base.useful : null;
  const noiseOk = base.noiseShare == null || x.noiseShare == null || x.noiseShare <= base.noiseShare + 0.1;
  const comparable = base.runs === x.runs;
  let v;
  if (!comparable) v = 'not comparable (different numbers of valid runs)';
  else if (ratio == null || recall == null) v = 'inconclusive (no cost or no useful finding in the baseline)';
  else if (losing.length) v = `blocked: loses ${losing.join(', ')}`;
  else if (ratio >= 1.5 && recall >= 0.7 && noiseOk) v = 'better per dollar';
  else if (ratio >= 1.5 && recall >= 0.7) v = 'cheaper per useful finding but noisier than the bar allows';
  else if (ratio < 1) v = 'worse per dollar';
  else v = 'no gain shown';
  return { v, ratio, recall, losing, noiseOk };
}

const usd = (n) => (n == null ? 'n/a' : `$${n.toFixed(3)}`);
const pct = (n) => (n == null ? 'n/a' : `${(n * 100).toFixed(0)}%`);

export function usefulReport(res, old = {}) {
  const arms = Object.keys(res);
  const L = ['## Useful findings per dollar (Ticket 071 headline)', '', `| arm | valid runs | useful | of which expected | of which audited | noise | noise share | unjudged | cost | useful per $ | ${CATEGORIES.join(' | ')} |`, `|---|---|---|---|---|---|---|---|---|---|${CATEGORIES.map(() => '---').join('|')}|`];
  for (const a of arms) { const t = res[a]; L.push(`| ${a} | ${t.runs} | ${t.useful} | ${t.expected} | ${t.audited} | ${t.noise} | ${pct(t.noiseShare)} | ${t.unjudged} | ${usd(t.cost)} | ${t.perDollar == null ? 'n/a' : t.perDollar.toFixed(1)} | ${CATEGORIES.map((k) => t.byCat[k] || 0).join(' | ')} |`); }
  const B = res[REFACTOR_BASELINE];
  if (B) {
    L.push('', `Verdicts against ${REFACTOR_BASELINE}:`, '');
    for (const a of arms) if (a !== REFACTOR_BASELINE) { const v = usefulVerdict(B, res[a]); L.push(`- ${a}: ${v.v} (per-dollar ratio ${v.ratio == null ? 'n/a' : v.ratio.toFixed(2)}, useful kept ${pct(v.recall)}, noise share within +10 points: ${v.noiseOk ? 'yes' : 'no'})`); }
  }
  if (Object.keys(old).length) {
    L.push('', 'Beside it, the 070 figures (kept expected improvements, false findings kept):', '');
    for (const a of arms) if (old[a]) L.push(`- ${a}: kept ${old[a].found}/${old[a].planted}, false findings ${old[a].falseFindings}`);
  }
  if (arms.some((a) => res[a].unjudged)) L.push('', 'Some proposals are unjudged and counted as noise: finish audit-verdicts.txt and score again.');
  return L.join('\n') + '\n';
}

// ---- CLI ------------------------------------------------------------------------------------------------

function gitCtx(maestro, commit) {
  const grep = (args) => { try { return execFileSync('git', ['-C', maestro, 'grep', '-l', ...args, commit, '--', 'apps', 'packages', 'plugin', 'scripts'], { encoding: 'utf8' }).split('\n').filter(Boolean).map((f) => f.slice(commit.length + 1)); } catch { return []; } };
  return {
    mentions: (n) => grep(['-w', '-e', n]),
    defs: (n) => grep(['-E', '-e', `(function|const|let|class|interface|type) ${n}\\b`]),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { REFACTOR_CASES } = await import('./refactor-cases.mjs');
  const { resolveMaestroDir } = await import('./maestro-dir.mjs');
  const { tally } = await import('./refactor.mjs');
  const dir = process.argv[2];
  const mode = process.argv[3];
  if (!dir || !['--pool', '--score'].includes(mode)) { console.error('usage: node bench/refactor-audit.mjs <results-dir> --pool|--score'); process.exit(2); }
  const runs = JSON.parse(readFileSync(join(resolve(dir), 'runs.json'), 'utf8'));
  const cases = new Map(REFACTOR_CASES.map((c) => [c.id, c]));
  const poolFile = join(resolve(dir), 'audit-pool.json');
  if (mode === '--pool') {
    const commit = /maestro-setup\.sh \S+ \S+ (\w+)/.exec(REFACTOR_CASES[0].setup)?.[1];
    const pool = buildPool(runs.rows, cases, gitCtx(resolveMaestroDir(), commit));
    writeFileSync(poolFile, JSON.stringify(pool, null, 1));
    writeFileSync(join(resolve(dir), 'audit-pool.txt'), poolText(pool));
    console.log(`pool: ${pool.length} distinct proposals, ${pool.filter((p) => p.auto).length} judged by registry or grep, ${pool.filter((p) => !p.auto).length} for a hand verdict in audit-pool.txt.\nWrite audit-verdicts.txt (one line per id: "<id>: confirmed <issue-key>: <evidence>" or "<id>: unconfirmed: <reason>"), then --score.`);
  } else {
    if (!existsSync(poolFile)) { console.error('no audit-pool.json: run --pool first'); process.exit(2); }
    const vf = join(resolve(dir), 'audit-verdicts.txt');
    const manual = parseVerdicts(existsSync(vf) ? readFileSync(vf, 'utf8') : '');
    const res = scoreUseful(runs.rows, runs.planned, cases, JSON.parse(readFileSync(poolFile, 'utf8')), manual);
    const t = tally(runs.rows, runs.planned);
    const old = Object.fromEntries(Object.entries(t).map(([a, x]) => [a, { found: x.overall.found, planted: x.overall.planted, falseFindings: x.falseFindings }]));
    const md = usefulReport(res, old);
    writeFileSync(join(resolve(dir), 'audit-report.md'), md);
    console.log(md);
  }
}
