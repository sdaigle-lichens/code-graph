---
name: concept-skills-layer
description: How the code-graph skills command group (layer 1) stamps versioned concept-skill markers, tracks git freshness, and resolves a concept's SKILL.md. Read before changing packages/code-graph/src/skills.
metadata:
  type: concept-skill
  version: "1.0"
  last-update: 6a3c88c2fbdc9c5431facca80c5251b4610c9e01
---

# Concept skills layer

Layer 1 of code-graph is the `code-graph skills` command group. It needs no graph, no TypeScript
and no node_modules: it works from SKILL.md frontmatter, `scribe.config.json` and git alone.

## Markers

A concept skill is an ordinary `.claude/skills/<id>/SKILL.md` whose `metadata:` map carries
`type: concept-skill`, a `major.minor` version and the `last-update` commit sha. Stamping rewrites
those lines in place and preserves the file's own line endings.

## Freshness

`skills status` counts commits and changed files since a skill's `last-update` over the concept's
globs. An unknown or malformed sha reports unknown freshness instead of failing. When a graph
store exists the report also carries per-concept graph freshness: changed and stale vertex counts
and whether the concept was extracted and enriched. `changed` compares `<concept>.ast.json` with the
store, so it reflects source edits only after `extract`; same for `drift --json`. Source edits nobody
has extracted are counted separately as `unextracted {changed,new,removed}` **files**
(`concepts[].unextracted` in `skills status`, `unextracted` in `drift --json`; text `unextracted: N
changed, N new, N removed file(s)`): `scribe/unextracted.ts` rescans the globs and diffs against
`.ast.json` `meta.files`. Null for an ast.json without `meta.files` (written before 0.3.17). It must
stay layer-1 safe (fs/crypto/minimatch only; `skills/unextracted-imports.test.ts` guards it). A malformed or
unknown sha sets `unknownFreshness` (reasons `malformed-sha`, `unknown-commit`).

`skills status --summary` (implies JSON) is the compact form the update flows read: `summarizeStatus`
in `skills/report.ts` keeps only `head`, `list {v, at, commits}` and per concept `id, v, at, commits,
files, graph? {vertices, enriched, changed, stale}`; `commits: null` = window not countable.

## Skill resolution

A concept's SKILL.md is its explicit `skill` path (taken as declared, even if missing), else the
marked skill whose id or directory name equals the concept key, else `skillsDir/<concept>/SKILL.md`
(`resolveConceptSkillPath`). `tsconfig` is optional.

## Docs-only concepts

A concept with no tsconfig, or whose globs name no TypeScript files, extracts to zero vertices
plus its skill block. Applying it stores the doc row so the SKILL.md body is searchable. Detection is `isDocsOnly` in
`scribe/ast-output.ts`, checked before `extract.ts` loads so ts-morph is never needed.
