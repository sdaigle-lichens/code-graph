## Goal
Make `code-graph search` rank partly enriched stores as well as un-enriched ones, so `just eval` and `just eval-as-is` are both 7/7 (tasks 2 and 6 currently fail on the partly enriched store). The ticket requires a manager review of the diagnosis and approach BEFORE any change to search ranking. This round is that pre-build check.

## Done
Phase 1 only (diagnosis, no source changes). Full text: `.claude/maestro-tasks/061-diagnosis.md`.
- Reproduced 5/7 with `just eval-as-is` (150 of 235 vertices enriched). Task 2: `expandDoc` at rank 9, target top 6. Task 6: concept-skills-layer absent from clusters.
- Task 6 cause: seeds are `LIMIT 10` over mixed vertices and docs. Enrichment in two concepts adds purpose matches (weight 2.0), pushing the concept-skills-layer doc to raw rank 12, outside the seed window.
- Task 2 cause: `expandDoc` matches only through its name; its purpose has none of the query words. Enriched peers also match through purposes and outscore it (bm25 8.84, 8.31 and 7.45 against 6.69).

## Deviations
The workflow places manager review after @backend. Because the ticket demands review before building the ranking change, @backend was stopped after diagnosis. It will be resumed for the build after this verdict.

## Decisions
Proposed, pending the manager:
- A (task 6, recommended): after the top 10 seeds, also seed the best 2 docs. Query-time only, no `FTS_FORMAT` bump, no reindex, cannot change vertex hits, no change to confidence, exit-7 wording or `--json` shape.
- B (task 2): lower the purpose weight in `FTS_WEIGHTS`. Proxy: at 0.5 `expandDoc` stays 8th, at 0.25 it reaches 5th, but `collectEdges` drops from 4th to 10th.
- C (fallback to B): cap the purpose contribution at the name contribution. Not measured.
- Plan: A plus a measured B or C, sweeping all seven tasks on the stripped and the partly enriched store. Keep the lightest change under which no task ranks worse.
- Rejected: raising the seed limit, always adding docs-only concepts as clusters, raising the `body_md` weight, loosening the eval tasks.

## Touches
`packages/code-graph/src/query/search.ts` and `FTS_WEIGHTS` (wherever defined); search ranking and eval tests; later docs (code-graph-search skill, `docs/evals.md`, root and package CLAUDE.md) and the plugin bundle. Nothing is changed yet.

## Sibling impact
Ticket 060 (blocked-by) shares root CLAUDE.md, the bundle and the version files; 060 merges first and this task regenerates the bundle. Lowering the purpose weight lowers raw scores, so more searches could exit 7. `confidence.test.ts` and `search-exit.test.ts` need checking.

## Verified
No code changed in this round. The working tree has the epic's pre-existing uncommitted state only. The 5/7 reproduction is from `just eval-as-is` on the local store. The full suite is not yet run for this task, since there is nothing to verify before the build. The build phase will verify `pnpm check`, `pnpm test`, `just eval` and `just eval-as-is` on the committed result.

## Questions
1. Is A plus a measured B or C acceptable, or do you prefer a different route for task 2 (for example a purpose-vs-name cap, option C, first)?
2. Is a small drop in enrichment recall (lower purpose weight) acceptable if all seven tasks hold their rank or better on both stores?
