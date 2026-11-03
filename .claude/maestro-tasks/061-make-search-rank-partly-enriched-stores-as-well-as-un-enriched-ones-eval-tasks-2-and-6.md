# Make search rank partly enriched stores as well as un-enriched ones (eval tasks 2 and 6)

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Ticket 059 made `just eval` gate on a stripped, un-enriched copy of the store and added `just eval-as-is` (informational). On a store that is only partly enriched, which is the steady state under the lazy-enrichment decision, search still ranks worse: `eval-as-is` scores 5/7. Task 2 ("expand graph traversal impact") finds vertex expandDoc at rank 9 instead of the top 6, because its enriched purpose carries fewer of the query words than other enriched vertices. Task 6 ("docs-only concept skill resolution skillsDir") does not put concept-skills-layer in the top 3 clusters, because the enriched purposes of extractDocsOnly/extract in other concepts outrank a docs-only concept that has no enrichment. Reproduce both first on the local partly enriched store (enriched for code-graph-search and scribe-pipeline, not concept-skills-layer). Diagnose what in the ranking lets enrichment in one concept push down hits from an un-enriched concept: for example purpose text weighting against name and doc body, how docs-only concepts and doc-seeded clusters are scored, or the seed limit. Decide, and record the decision in the report, the smallest change that makes both a stripped store and the partly enriched store pass, without hurting the other five eval tasks and without loosening the eval tasks themselves. Before building the change in search ranking (src/query/search.ts, the index text or weights in scribe/rows.ts), send a manager review request with the diagnosis, the options and the risk. Include messages in source code if exit-7 low-confidence wording changes. If the indexed text changes, bump FTS_FORMAT and say that a `code-graph reindex` is needed. Add tests that pin the two cases, covering a partly enriched fixture store, and update the docs that describe search ranking and the eval (the code-graph-search skill, docs/evals.md, the root and package CLAUDE.md where they name the 5/7). Regenerate the plugin bundle with `pnpm bundle`; whoever merges bumps the version.

## Acceptance criteria

- [ ] The report reproduces the 5/7 on the partly enriched local store first (tasks 2 and 6, with their ranks) and states the diagnosed cause and the chosen change, with the alternatives rejected
- [ ] `just eval` is 7/7 and `just eval-as-is` is 7/7 on a store enriched for code-graph-search and scribe-pipeline but not concept-skills-layer; the other five tasks keep their rank or better, shown in the report
- [ ] A test pins both failing cases against a partly enriched fixture store, so a ranking regression on partly enriched stores fails `pnpm test`, not only the informational eval
- [ ] Exit codes and the `--json` shape of search are unchanged unless the report says otherwise; if the indexed text changed, FTS_FORMAT is bumped and the reindex need is documented
- [ ] The docs and skills that describe ranking, the eval and the 5/7 caveat are updated; the plugin bundle is regenerated; `pnpm check`, `pnpm test` and `just eval` are green on the committed result

## Touched surfaces

- packages/code-graph/src/query/search.ts, and scribe/rows.ts or scribe/bootstrap.ts (FTS_FORMAT) only if the indexed text changes
- packages/code-graph tests for search ranking and the eval fixture store
- eval/tasks.code-graph.json only if the report shows a task wording problem (not to loosen it)
- code-graph-search skill, docs/evals.md, root CLAUDE.md (eval working rule), packages/code-graph/CLAUDE.md
- plugin/scripts/code-graph.cjs and the three version files (whoever merges bumps)
- blocked by 060: shares root CLAUDE.md, the bundle and the version files; 060 merges first, this task rebases and regenerates the bundle

## Blocked by

- `060-stop-orphaned-enriched-entries-from-warning-forever-remap-prune-or-report-them-once.md`
