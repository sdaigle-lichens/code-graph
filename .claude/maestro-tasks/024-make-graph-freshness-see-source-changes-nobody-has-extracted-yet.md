# Make graph freshness see source changes nobody has extracted yet

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

From maestro's merge review (R3; `~/gits/maestro/.claude/epics/code-graph-cutover/merge-review.md`).

Measured on maestro: commit 204f013 changed `install.ts`, added `session-name.ts` and changed
`epics.ts`/`types.ts`, and no extract ran. Afterwards:
- the graph has `installRuntime` at line 683, the source at 705;
- `session-name.ts` has no vertices;
- `drift installing-maestro` says "unchanged 116";
- `skills status` prints `graph: 0 changed, 0 stale` next to `1 commit(s), 1 file(s)`.

Verified in code: `scribe/freshness.ts` `graphFreshness` (L59-64) counts `changed` by comparing the
`.ast.json` contentHash with the store. `drift` does the same (ast.json vs store). Neither looks at the
source, so they only see drift someone has already extracted. The git window in the same line does
flag the change; the graph column contradicts it.

**Detect unextracted changes cheaply.** For each concept, compare the files its globs match now with
what the last extract saw:
- a file whose content differs from what the extract recorded counts as changed;
- a new file matching the globs counts as changed (new);
- a file the extract saw that's gone counts as changed (removed).

Constraints:
- `skills status` is layer 1: no `typescript`/`ts-morph`/re-extract in that path (see "Layer 1 never
  loads the graph stack" in packages/code-graph/CLAUDE.md). Glob matching plus hashing is fine.
- Prefer content hashes over mtime (checkouts reset mtimes). If you record per-file hashes in
  `.ast.json` `meta`, keep the file byte-stable across re-extracts of unchanged code
  (`scribe/ast-stability.test.ts`); expect each committed ast.json to change once, and say so in the
  report and docs.
- Report it as a separate count from vertex-level `changed` (e.g. `unextracted: { changed, new,
  removed }` files), so nobody confuses "files touched since extract" with "vertices that differ".

Surface it in `skills status` (text and JSON), in `drift` (text and `--json`), and in the
update-concept-skills / update-single-concept-skill flows where they decide what to extract, so an
unextracted change leads to `extract` + `apply`.

Version 0.3.17 in all three files (take the next free patch if another task ships first), bundle
regenerated. Update the freshness gotcha in packages/code-graph/CLAUDE.md and the
`concept-skills-layer` / `scribe-pipeline` skills if their text goes stale (ask the user if a write
under `.claude/skills` is blocked).

## Acceptance criteria

- [ ] After editing a file in a concept's globs without running `extract`, `skills status` and `drift` report that concept as having unextracted changes; tests in code-graph's suite cover an edited, a new and a removed file
- [ ] The new detection adds no typescript/ts-morph import to the `skills status` path (an existing or new test guards it)
- [ ] `.ast.json` stays byte-stable across re-extracts of unchanged code; `ast-stability.test.ts` passes
- [ ] The update flows run extract + apply for a concept with unextracted changes
- [ ] claude plugin validate, pnpm check, pnpm test and just eval (7/7) are green; version bumped in all three files, bundle regenerated
