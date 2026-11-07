#!/usr/bin/env node
// 066: generate, at $0 and deterministically, the diff and the diff primer of each review case, and
// store them for review: bench/review/<id>.diff and bench/review/<id>.primer.txt. No model call.
// The primer comes from the code-graph CLI run on the graph store of the pinned maestro tree BEFORE the
// change: impact of each changed symbol, untested callers, new cross-concept edges, cross-concept
// relations of the touched concepts. It reads only the diff and the index, never the case's bug list.
// Usage: node bench/review-prep.mjs [--only <substring>] [--check]
//   --check: build in memory and exit 1 if a stored file differs (nothing is written).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupArm } from './lib.mjs';
import { maestroFor } from './maestro-dir.mjs';
import {
  addedImports, buildPrimer, changedSymbols, diffForPlants, importCandidates, parseFileVertices, parseImpact, untestedCallers,
} from './review.mjs';
import { selectReviewCases } from './review-cases.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const cli = join(repo, 'plugin', 'scripts', 'code-graph.cjs');
export const reviewFile = (id, ext) => join(here, 'review', `${id}.${ext}`);

function walkTests(root, dir, out) {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'scribe-output') continue;
    const rel = `${dir}/${e.name}`.replace(/^\//, '');
    if (e.isDirectory()) walkTests(root, rel, out);
    else if (/\.test\.tsx?$/.test(e.name) && statSync(join(root, rel)).size < 2e6) out.push(readFileSync(join(root, rel), 'utf8'));
  }
  return out;
}

export function buildCaseArtifacts(ws, c, cg, concepts, testCorpus) {
  const { diff, changes } = diffForPlants((f) => readFileSync(join(ws, f), 'utf8'), c.review.plant, c.id);
  const files = [];
  const untested = [];
  const touched = new Set();
  for (const ch of changes) {
    const fv = cg(['query', 'file', ch.file]);
    const verts = fv.status === 0 ? parseFileVertices(fv.stdout) : [];
    const concept = verts[0]?.concept || '';
    if (concept) touched.add(concept);
    const symbols = [];
    for (const v of changedSymbols(verts, ch.lo, ch.hi)) {
      let r = cg(['query', 'impact', `${ch.file}:${v.name}`, '--direction', 'in']);
      if (r.status !== 0) r = cg(['query', 'impact', v.name, '--direction', 'in']);
      const impact = r.status === 0 ? r.stdout : `(impact unavailable: code-graph exit ${r.status})`;
      symbols.push({ name: v.name, start: v.start, end: v.end, impact });
      untested.push({ symbol: v.name, callers: untestedCallers(parseImpact(impact).direct, testCorpus) });
    }
    const newEdges = [];
    for (const spec of addedImports(ch)) {
      const target = importCandidates(ch.file, spec).find((p) => existsSync(join(ws, p)));
      if (!target) continue;
      const tv = cg(['query', 'file', target]);
      newEdges.push({ spec, target, targetConcept: tv.status === 0 ? parseFileVertices(tv.stdout)[0]?.concept || '' : '' });
    }
    files.push({ file: ch.file, concept, symbols, newEdges });
  }
  const cross = [];
  const seen = new Set();
  for (const a of [...touched].sort()) for (const b of concepts) {
    if (a === b) continue;
    const k = [a, b].sort().join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    const r = cg(['query', 'cross', a, b]);
    if (r.status === 0 && r.stdout.trim()) cross.push({ a, b, text: r.stdout });
  }
  return { diff, primer: buildPrimer({ files, untested, cross }) };
}

function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
  const check = args.includes('--check');
  const cases = selectReviewCases(only);
  if (!cases.length) { console.error('review-prep: no case matches'); process.exit(2); }
  const setup = cases[0].setup.replaceAll('{REPO}', repo).replaceAll('{ARM}', setupArm('graph')).replaceAll('{MAESTRO}', maestroFor(cases[0].setup));
  const ws = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'bench-review-'));
  let bad = 0;
  try {
    const sc = spawnSync('bash', ['-c', setup], { cwd: ws, encoding: 'utf8', timeout: 180000 });
    if (sc.status !== 0) { console.error(`setup failed: ${sc.stderr || sc.stdout}`); process.exit(2); }
    const cg = (argv) => spawnSync('node', [cli, ...argv], { cwd: ws, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: ws } });
    const concepts = Object.keys(JSON.parse(readFileSync(join(ws, 'scribe.config.json'), 'utf8')).concepts);
    const testCorpus = walkTests(ws, '', []).join('\n');
    for (const c of cases) {
      const art = buildCaseArtifacts(ws, c, cg, concepts, testCorpus);
      for (const [ext, text] of [['diff', art.diff], ['primer.txt', art.primer]]) {
        const f = reviewFile(c.id, ext);
        if (check) {
          const same = existsSync(f) && readFileSync(f, 'utf8') === text;
          console.log(`${c.id}.${ext}: ${same ? 'unchanged' : 'DIFFERS'} (${text.length} chars)`);
          if (!same) bad++;
        } else {
          mkdirSync(dirname(f), { recursive: true });
          writeFileSync(f, text);
          console.log(`${c.id}.${ext}: wrote ${text.length} chars`);
        }
      }
    }
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
