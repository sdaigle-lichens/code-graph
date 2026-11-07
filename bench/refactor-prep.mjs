#!/usr/bin/env node
// 070: generate, at $0 and deterministically, the neighbourhood scope and the metrics primer of each
// refactor case, and store them for the run: bench/refactor/<id>.scope.txt and bench/refactor/<id>.primer.txt.
// No model call. Everything comes from the code-graph CLI run on the pinned maestro tree:
//   scope  = the touched files (the files the planted change edits, or the case's `touched` list) plus the
//            direct import-graph neighbours the change mentions (a neighbour's file name or one of its
//            exports appears in the planted text; else the least imported non-hub neighbours), plus the
//            case's `extra` files the index does not cover (the .cjs plugin scripts); at most 12 files.
//            Neighbours are looked up in the tree before AND after the planted change.
//   primer = fan-in and fan-out, hubs, import cycles (SCC of the catalog's import edges), exports no other
//            source file mentions (a text scan: the CLI exposes fan-in per file, not per export),
//            cross-concept import edges and `query cross`, all on the tree AFTER the planted change, so a
//            seeded cycle or a seeded unused export is visible to the primer arms.
// It reads only the plants and the index, never the expected-improvement list.
// Everything the CLI already exposes was enough: no package source changes, no pnpm build needed.
// Usage: node bench/refactor-prep.mjs [--only <substring>] [--check]
//   --check: build in memory and exit 1 if a stored file differs (nothing is written).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaceOnce, setupArm } from './lib.mjs';
import { maestroFor } from './maestro-dir.mjs';
import { buildMetricsPrimer, buildScope, findCycles, neighbourFiles, unusedExports } from './refactor.mjs';
import { selectRefactorCases } from './refactor-cases.mjs';
import { parseFileVertices } from './review.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const cli = join(repo, 'plugin', 'scripts', 'code-graph.cjs');
export const refactorFile = (id, ext) => join(here, 'refactor', `${id}.${ext}`);
export const MAX_SCOPE = 12;
const SRC_RE = /\.(ts|tsx|cjs|mjs)$/;

function walkSources(root, dir, out) {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'scribe-output' || e.name === 'dist') continue;
    const rel = `${dir}/${e.name}`.replace(/^\//, '');
    if (e.isDirectory()) walkSources(root, rel, out);
    else if (SRC_RE.test(e.name) && statSync(join(root, rel)).size < 2e6) out.push({ file: rel, text: readFileSync(join(root, rel), 'utf8') });
  }
  return out;
}

// Scope text and primer text of one case; `post` is the catalog of the tree after the planted change,
// `pre` the one before it (the same object for a case that plants nothing).
export function buildCaseArtifacts(c, { pre, post, sources, cg }) {
  const plant = c.refactor.plant || [];
  const touched = [...new Set([...plant.map((x) => x.file), ...(c.refactor.touched || [])])].sort();
  const extra = (c.refactor.extra || []).filter((f) => !touched.includes(f));
  const exportsOf = {};
  for (const cat of [pre, post]) for (const f of cat.files) exportsOf[f.path] = f.exports || [];
  const text = plant.map((x) => `${x.from}\n${x.to}`).join('\n');
  const edges = [...pre.imports, ...post.imports];
  const neigh = neighbourFiles({ touched, edges, exportsOf, text, hubs: post.hubs, fanIn: post.fanIn })
    .filter((f) => !extra.includes(f))
    .slice(0, Math.max(0, MAX_SCOPE - touched.length - extra.length));
  const files = [...new Set([...touched, ...neigh, ...extra])].sort();

  const conceptMemo = cg.memo;
  const conceptOf = (f) => {
    if (!(f in conceptMemo)) {
      const r = cg(['query', 'file', f]);
      conceptMemo[f] = r.status === 0 ? parseFileVertices(r.stdout)[0]?.concept || '' : '';
    }
    return conceptMemo[f];
  };
  const entries = files.map((f) => ({ file: f, concept: conceptOf(f) }));
  const inScope = new Set(files);
  const catFile = new Map(post.files.map((f) => [f.path, f]));

  const metricFiles = files.map((f) => ({ file: f, concept: conceptOf(f), indexed: catFile.has(f), fanIn: post.fanIn[f] ?? 0, fanOut: post.fanOut[f] ?? 0, exports: (catFile.get(f)?.exports || []).length }));
  const hubs = files.filter((f) => post.hubs.includes(f));
  const cycles = findCycles(post.imports).filter((comp) => comp.some((f) => inScope.has(f)));
  const unused = unusedExports(files.filter((f) => catFile.has(f)).map((f) => ({ file: f, exports: catFile.get(f).exports || [] })), sources);
  const seenEdge = new Set();
  const crossEdges = [];
  for (const e of post.imports) {
    if (!inScope.has(e.from) || !inScope.has(e.to) || seenEdge.has(`${e.from}>${e.to}`)) continue;
    seenEdge.add(`${e.from}>${e.to}`);
    const a = conceptOf(e.from);
    const b = conceptOf(e.to);
    if (a && b && a !== b) crossEdges.push({ from: e.from, fromConcept: a, to: e.to, toConcept: b });
  }
  crossEdges.sort((x, y) => (`${x.from}>${x.to}` < `${y.from}>${y.to}` ? -1 : 1));
  const concepts = [...new Set(entries.map((e) => e.concept).filter(Boolean))].sort();
  const cross = [];
  for (let i = 0; i < concepts.length; i++) for (let j = i + 1; j < concepts.length && cross.length < 4; j++) {
    const r = cg(['query', 'cross', concepts[i], concepts[j]]);
    if (r.status === 0 && r.stdout.trim()) cross.push({ a: concepts[i], b: concepts[j], text: r.stdout });
  }
  return { scope: buildScope(entries), primer: buildMetricsPrimer({ files: metricFiles, hubs, cycles, unused, crossEdges, cross }) };
}

function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
  const check = args.includes('--check');
  const cases = selectRefactorCases(only);
  if (!cases.length) { console.error('refactor-prep: no case matches'); process.exit(2); }
  const setup = cases[0].setup.replaceAll('{REPO}', repo).replaceAll('{ARM}', setupArm('graph')).replaceAll('{MAESTRO}', maestroFor(cases[0].setup));
  const ws = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'bench-refactor-'));
  let bad = 0;
  try {
    const sc = spawnSync('bash', ['-c', setup], { cwd: ws, encoding: 'utf8', timeout: 180000 });
    if (sc.status !== 0) { console.error(`setup failed: ${sc.stderr || sc.stdout}`); process.exit(2); }
    const cg = (argv) => spawnSync('node', [cli, ...argv], { cwd: ws, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, CLAUDE_PROJECT_DIR: ws } });
    cg.memo = {};
    const catalog = () => {
      const r = cg(['catalog', '--json', '--tsconfig', 'tsconfig.code-graph.json']);
      if (r.status !== 0) { console.error(`catalog failed: ${r.stderr || r.stdout}`); process.exit(2); }
      return JSON.parse(r.stdout);
    };
    const pre = catalog();
    const pristine = walkSources(ws, '', []);
    for (const c of cases) {
      const plant = c.refactor.plant || [];
      const saved = {};
      let post = pre;
      let sources = pristine;
      try {
        if (plant.length) {
          for (const x of plant) {
            saved[x.file] ??= readFileSync(join(ws, x.file), 'utf8');
            writeFileSync(join(ws, x.file), replaceOnce(readFileSync(join(ws, x.file), 'utf8'), x.from, x.to, `${c.id} plant ${x.file}`));
          }
          post = catalog();
          sources = pristine.map((s) => (s.file in saved ? { file: s.file, text: readFileSync(join(ws, s.file), 'utf8') } : s));
        }
        const art = buildCaseArtifacts(c, { pre, post, sources, cg });
        for (const [ext, text] of [['scope.txt', art.scope], ['primer.txt', art.primer]]) {
          const f = refactorFile(c.id, ext);
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
      } finally {
        for (const [f, t] of Object.entries(saved)) writeFileSync(join(ws, f), t);
      }
    }
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
