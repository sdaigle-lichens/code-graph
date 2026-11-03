// 044 edit cases: workspace preparation before the model runs and outcome grading after it, for
// bench/run.mjs and bench/edit-check.mjs. The pure rules (replaceOnce, gradeTestRun, gradeDocs) live in
// lib.mjs; this file does the filesystem and child-process side.
//
// Case shape (cases.json, `edit` field):
//   test     (kind test)   workspace path of the test file the model must write (*.node.test.ts)
//   remove   paths deleted before the run (existing tests that would hand the model the answer)
//   plant    [{ file, from, to }] code changes applied before the run (kind scribe: the change to document)
//   protect  paths (files or directories) the model must not change; any change is undone before grading
//            and listed in the report (test: application code; scribe: the planted code)
//   mutants  [{ id, file, from, to }] (kind test) planted bugs; the suite must fail on each
//   docs     { file: { must: [regex], must_not: [regex] } } (kind scribe) the graded documentation
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentBody, gradeDocs, gradeTestRun, nodeTestSummary, replaceOnce } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const RESOLVE_HOOK = '.bench/ts-resolve.mjs';
export const TEST_TIMEOUT_MS = 120000;

// A case path must stay inside the workspace.
function inWs(ws, p) {
  const abs = resolve(ws, p);
  if (abs !== resolve(ws) && !abs.startsWith(resolve(ws) + sep)) throw new Error(`path escapes the workspace: ${p}`);
  return abs;
}

function walk(abs, out = []) {
  if (!existsSync(abs)) return out;
  if (statSync(abs).isDirectory()) for (const e of readdirSync(abs)) walk(join(abs, e), out);
  else out.push(abs);
  return out;
}

// Contents of every protected file, keyed by workspace-relative path.
function snapshot(ws, paths = []) {
  const snap = {};
  for (const p of paths) for (const f of walk(inWs(ws, p))) snap[relative(ws, f)] = readFileSync(f, 'utf8');
  return snap;
}

export function applyReplacements(ws, list = [], label = 'plant') {
  for (const x of list) {
    const f = inWs(ws, x.file);
    writeFileSync(f, replaceOnce(readFileSync(f, 'utf8'), x.from, x.to, `${label} ${x.id || x.file}`));
  }
}

// Before the run: the resolve hook (test cases), the removals, the planted change, then the snapshot of
// the protected paths (taken after planting, so the plant is what gets protected). Throws on any
// mismatch: a case whose plant does not apply must not be run.
export function prepareEdit(ws, c) {
  const e = c.edit;
  if (c.kind === 'test') {
    mkdirSync(join(ws, '.bench'), { recursive: true });
    copyFileSync(join(here, 'edit', 'ts-resolve.mjs'), join(ws, RESOLVE_HOOK));
  }
  for (const p of e.remove || []) {
    const abs = inWs(ws, p);
    if (!existsSync(abs)) throw new Error(`${c.id}: edit.remove names a missing path: ${p}`);
    rmSync(abs, { recursive: true, force: true });
  }
  applyReplacements(ws, e.plant, `${c.id} plant`);
  return { protected: snapshot(ws, e.protect) };
}

// Undo every change to a protected path (edited, deleted or added files) and list what was undone.
function restoreProtected(ws, c, pristine) {
  const now = snapshot(ws, c.edit.protect);
  const restored = [];
  for (const [rel, text] of Object.entries(pristine.protected)) {
    if (now[rel] !== text) { mkdirSync(dirname(join(ws, rel)), { recursive: true }); writeFileSync(join(ws, rel), text); restored.push(rel); }
  }
  for (const rel of Object.keys(now)) if (!(rel in pristine.protected)) { rmSync(join(ws, rel), { force: true }); restored.push(rel); }
  return restored;
}

// One `node --test` run of the case's test file, from the workspace root.
export function runTestFile(ws, testPath) {
  // A clean env: NODE_TEST_CONTEXT (set when this runs under `node --test`) would make the child report
  // to a parent test runner instead of printing its own summary.
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--import', `./${RESOLVE_HOOK}`, '--test', testPath], {
    cwd: ws, encoding: 'utf8', timeout: TEST_TIMEOUT_MS, maxBuffer: 1 << 26, env,
  });
  const timedOut = r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM';
  return { status: timedOut ? null : r.status, timedOut, ...nodeTestSummary(r.stdout), tail: String(r.stdout || '').slice(-4000) + String(r.stderr || '').slice(-2000) };
}

// After the run: restore protected paths, then grade. Test cases run the suite on the original code
// and once per mutant (each mutant applied alone, then undone). Scribe cases read the graded docs.
export function gradeEdit(ws, c, pristine) {
  const restored = restoreProtected(ws, c, pristine);
  const e = c.edit;
  if (c.kind === 'test') {
    const testAbs = inWs(ws, e.test);
    const exists = existsSync(testAbs);
    const original = exists ? runTestFile(ws, e.test) : null;
    const mutants = [];
    if (exists && original && original.status === 0) {
      for (const mu of e.mutants) {
        const f = inWs(ws, mu.file);
        const before = readFileSync(f, 'utf8');
        writeFileSync(f, replaceOnce(before, mu.from, mu.to, `${c.id} mutant ${mu.id}`));
        try { mutants.push({ id: mu.id, ...runTestFile(ws, e.test) }); } finally { writeFileSync(f, before); }
      }
    }
    const g = gradeTestRun({ exists, original, mutants: mutants.length ? mutants : e.mutants.map((mu) => ({ id: mu.id })) });
    return { hits: g.hits, of: g.of, detail: g.detail, restored, runs: { original, mutants } };
  }
  const docs = Object.fromEntries(Object.keys(e.docs).map((f) => { const a = inWs(ws, f); return [f, existsSync(a) ? readFileSync(a, 'utf8') : null]; }));
  const g = gradeDocs(e.docs, docs);
  return { hits: g.hits, of: g.of, detail: g.detail, restored };
}

// The maestro agent the case runs as: its file's body is appended to the system prompt.
export function systemPromptFor(ws, c) {
  const f = join(ws, '.claude', 'agents', `${c.agent}.md`);
  if (!existsSync(f)) throw new Error(`${c.id}: no agent file .claude/agents/${c.agent}.md in the workspace`);
  return agentBody(readFileSync(f, 'utf8'));
}

// What the run produced, kept next to its transcript: the test file and its test output, or the docs.
export function saveArtifacts(ws, c, dir, base, grade) {
  const keep = c.kind === 'test' ? [c.edit.test] : Object.keys(c.edit.docs);
  for (const p of keep) {
    const a = inWs(ws, p);
    if (existsSync(a)) writeFileSync(join(dir, `${base}.${p.replace(/[\\/]/g, '__')}`), readFileSync(a, 'utf8'));
  }
  if (grade.runs) {
    const t = [`# original: ${JSON.stringify({ ...grade.runs.original, tail: undefined })}`, grade.runs.original?.tail || '',
      ...grade.runs.mutants.map((m) => `# mutant ${m.id}: ${JSON.stringify({ ...m, tail: undefined })}\n${m.tail}`)];
    writeFileSync(join(dir, `${base}.test-output.txt`), t.join('\n'));
  }
}
