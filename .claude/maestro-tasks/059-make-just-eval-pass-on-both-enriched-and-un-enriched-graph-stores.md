# Make just eval pass on both enriched and un-enriched graph stores

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Found by the 058 worker: `just eval` scores 5/7 on a machine whose local graph store is enriched, while the committed gate is 7/7 on an un-enriched store. The failures are identical on untouched HEAD after `just regraph`, so they are not caused by 058. Failing: eval task 2 ("expand graph traversal impact": vertex expandDoc found at rank 9, wanted top 6) and task 6 ("docs-only concept skill resolution skillsDir": concept concept-skills-layer not in the top 3 clusters). Cause found: the local store is enriched for code-graph-search (67 purposes) and scribe-pipeline (84) but concept-skills-layer has no .enriched.json, so the enriched purposes of extractDocsOnly/extract outrank the un-enriched doc (task 6), and the expandDoc purpose carries fewer query words (task 2). The eval task file says task 2 was reworded in 0.3.28 to pass on an un-enriched store, and the .enriched.json files are gitignored, so the committed gate and a developer's local store disagree. Decide first, and record the decision in the report: either make the eval gate independent of enrichment (for example by measuring against a store built without the gitignored enriched files, and naming which kind of store it measured the way the `build:` line names the build), or fix retrieval ranking so both an enriched and an un-enriched store pass, or both. Then implement the choice, with tests where it touches the CLI or search code (including messages in source code), and update the docs that describe the gate: the root CLAUDE.md working rules and docs/evals.md. Regenerate the plugin bundle with `pnpm bundle` only if CLI or search source changes, and say who bumps the version (whoever merges bumps).

## Acceptance criteria

- [ ] The report states which fix was chosen (gate independent of enrichment, ranking change, or both) and why, with the two failing eval tasks reproduced first
- [ ] `just eval` is 7/7 on an un-enriched store and 7/7 on a store enriched for code-graph-search and scribe-pipeline but not concept-skills-layer
- [ ] The eval output names the kind of store it measured (enriched or not), so a pass or fail can't be misread
- [ ] If search ranking changed, the plugin bundle is regenerated and `check-versions.mjs` passes; search exit codes and `--json` shape are unchanged unless the report says otherwise
- [ ] The chosen behaviour is documented in CLAUDE.md's working rules and docs/evals.md; `pnpm check` and `pnpm test` are green on the committed result

## Touched surfaces

- eval/tasks.code-graph.json and the eval runner
- justfile (eval recipe)
- packages/code-graph/src/query/search.ts (only if ranking changes)
- CLAUDE.md (root working rules)
- docs/evals.md
- plugin/scripts/code-graph.cjs and the three version files (only if CLI source changes; whoever merges bumps)
- parallel OK with 056 but shares justfile/CLAUDE.md and possibly the bundle with 057, which is on hold; merge order 058, then 056, then this task, then 057; later ones rebase and regenerate the bundle

## Blocked by

- `058-one-applied-concept-check-safe-refresh-lock-and-shared-error-helper-after-045-049-050.md`
