#!/usr/bin/env node
// $0 check of the 044 edit cases' graders, no claude call: for each edit case it builds the no-graph
// workspace (bench/maestro-setup.sh), prepares it as run.mjs would (plants, removals, resolve hook) and
// grades it twice:
//   untouched   test: no test file -> 0 points. scribe: the planted docs as they are -> 0 points
//               (every `must` misses, every `must_not` still matches the stale text).
//   reference   test: bench/edit/ref/<id>.test.ts copied in, plus a stray edit to a protected file ->
//               full points (green on the original, every mutant killed) and the stray edit undone.
//               scribe: bench/edit/ref/<id>.json applied -> full points.
// Every plant, removal and mutant must apply exactly once on the pinned tree, or the check fails.
// Usage: node bench/edit-check.mjs [--only <substring>] [--set 044] [--keep-ws]
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { editCaseProblems, isEditCase, replaceOnce, selectCases } from './lib.mjs';
import { gradeEdit, prepareEdit, systemPromptFor } from './edit.mjs';
import { maestroFor } from './maestro-dir.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const opts = { only: '', set: '044' };
let keep = false;
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i].replace(/^--/, '');
  if (k === 'keep-ws') keep = true;
  else if (k in opts) opts[k] = process.argv[++i];
  else { console.error(`unknown option ${process.argv[i]}`); process.exit(2); }
}
const cases = selectCases(JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8')).cases, opts).filter(isEditCase);
if (!cases.length) { console.error(`edit-check: no edit case matches --only "${opts.only}" --set "${opts.set}"`); process.exit(2); }

const work = process.env.TMPDIR || tmpdir();
let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) bad++; };

function workspace(c) {
  const ws = mkdtempSync(join(work, 'bench-edit-check-'));
  const cmd = c.setup.replaceAll('{REPO}', repo).replaceAll('{ARM}', 'nograph').replaceAll('{MAESTRO}', maestroFor(c.setup));
  const sc = spawnSync('bash', ['-c', cmd], { cwd: ws, encoding: 'utf8', timeout: 180000 });
  if (sc.status !== 0) throw new Error(`setup failed: ${sc.stderr || sc.stdout}`);
  return ws;
}

for (const c of cases) {
  console.log(`[${c.id}] (${c.kind})`);
  const shape = editCaseProblems(c);
  check(!shape.length, `case shape${shape.length ? `: ${shape.join('; ')}` : ''}`);
  for (const pass of ['untouched', 'reference']) {
    let ws;
    try {
      ws = workspace(c);
      const pristine = prepareEdit(ws, c);
      check(systemPromptFor(ws, c).length > 200, `${pass}: agent file .claude/agents/${c.agent}.md has a body`);
      if (pass === 'reference') {
        if (c.kind === 'test') {
          const dest = join(ws, c.edit.test);
          mkdirSync(dirname(dest), { recursive: true });
          copyFileSync(join(here, 'edit', 'ref', `${c.id}.test.ts`), dest);
          // a stray edit to protected code: grading must undo it and report it
          const stray = join(ws, c.edit.mutants[0].file);
          writeFileSync(stray, `${readFileSync(stray, 'utf8')}\n// stray edit\n`);
        } else {
          for (const e of JSON.parse(readFileSync(join(here, 'edit', 'ref', `${c.id}.json`), 'utf8')).edits) {
            const f = join(ws, e.file);
            writeFileSync(f, replaceOnce(readFileSync(f, 'utf8'), e.from, e.to, `ref ${e.file}`));
          }
        }
      }
      const g = gradeEdit(ws, c, pristine);
      const want = pass === 'untouched' ? 0 : g.of;
      check(g.hits === want, `${pass}: ${g.hits}/${g.of} points, want ${want} (${g.detail})`);
      if (pass === 'reference' && c.kind === 'test') check(g.restored.includes(c.edit.mutants[0].file), `reference: the stray protected edit was undone (${g.restored.join(', ') || 'nothing'})`);
      if (pass === 'untouched') check(!g.restored.length, `untouched: nothing to restore (${g.restored.join(', ') || 'nothing'})`);
      if (g.runs) for (const m of g.runs.mutants) if (m.status === 0) console.log(`       survived ${m.id}:\n${m.tail.slice(-1500)}`);
      if (g.runs?.original && g.runs.original.status !== 0) console.log(g.runs.original.tail.slice(-3000));
    } catch (e) {
      check(false, `${pass}: ${e.message}`);
    } finally {
      if (ws && existsSync(ws)) { if (keep) console.log(`  kept ${ws}`); else rmSync(ws, { recursive: true, force: true }); }
    }
  }
}
console.log(bad ? `edit-check: ${bad} FAIL` : 'edit-check: all graders behave');
process.exit(bad ? 1 : 0);
