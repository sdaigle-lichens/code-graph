#!/usr/bin/env node
// The noskills arm (042): remove every concept skill from a bench workspace, keep every other skill.
// A concept skill is a `.claude/skills/<dir>/SKILL.md` (at any depth, e.g. apps/maestro/.claude/skills)
// whose frontmatter carries `metadata.type: concept-skill`; its whole <dir> is removed.
// Usage: node bench/strip-concept-skills.mjs <workspace>
// Prints the removed skills as JSON. Exits 1 when the workspace has no concept skill (the arm would
// measure nothing), 2 when the workspace is not a directory or sits inside a git work tree (this
// deletes files, so it only ever runs on a fresh bench workspace; maestro-setup.sh calls it).
import { readdirSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isConceptSkillMd, skillNameOf } from './lib.mjs';

const SKIP = new Set(['node_modules', '.git']);

// Every skill dir under any `.claude/skills` below root: { dir, rel, name, concept }. Symlinks are
// not followed.
export function listSkills(root) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory() || SKIP.has(e.name)) continue;
      const p = join(d, e.name);
      if (e.name === 'skills' && basename(d) === '.claude') {
        for (const s of readdirSync(p, { withFileTypes: true })) {
          const md = join(p, s.name, 'SKILL.md');
          if (!s.isDirectory() || !existsSync(md)) continue;
          const text = readFileSync(md, 'utf8');
          out.push({ dir: join(p, s.name), rel: relative(root, join(p, s.name)), name: skillNameOf(text, s.name), concept: isConceptSkillMd(text) });
        }
        continue;
      }
      walk(p);
    }
  };
  walk(root);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

// Removes the concept skills; returns { removed, kept } (both lists of { rel, name }).
export function stripConceptSkills(root) {
  const all = listSkills(root);
  for (const s of all) if (s.concept) rmSync(s.dir, { recursive: true, force: true });
  const pick = (x) => ({ rel: x.rel, name: x.name });
  return { removed: all.filter((s) => s.concept).map(pick), kept: all.filter((s) => !s.concept).map(pick) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] || '');
  const die = (code, msg) => { console.error(`strip-concept-skills: ${msg}`); process.exit(code); };
  if (!process.argv[2] || !existsSync(root) || !statSync(root).isDirectory()) die(2, `not a directory: ${process.argv[2] || '(none given)'}`);
  const env = { ...process.env };
  delete env.GIT_DIR; delete env.GIT_WORK_TREE;
  if (spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, env, encoding: 'utf8' }).status === 0) {
    die(2, `refusing, ${root} is inside a git work tree (run it only on a fresh bench workspace)`);
  }
  const r = stripConceptSkills(root);
  console.log(JSON.stringify(r));
  if (!r.removed.length) die(1, `no concept skill found under ${root}`);
}
