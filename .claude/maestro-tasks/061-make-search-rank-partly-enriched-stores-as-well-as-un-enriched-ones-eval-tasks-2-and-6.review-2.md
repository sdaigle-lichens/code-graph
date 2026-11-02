Round 2

Previous redirect note: none (round 1 was on-track: "A plus a measured B or C; keep the lightest change; every task equal or better on BOTH stores; no weight that drops collectEdges; stop and re-request if FTS_FORMAT or the --json shape changes"). The build deviated from the approved task-2 route, so this is a direction re-check.

## Goal
Make `code-graph search` rank partly enriched stores as well as stripped ones, so `just eval` and `just eval-as-is` are both 7/7.

## Done
- Task 6 (option A, as approved): `DOC_SEED_RESERVE = 2` keeps the best 2 doc seeds beyond the top 10 in `searchStore`. Query-time.
- Task 2 (changed): a vertex whose name matches a query word gets its seed score multiplied by `NAME_HIT_FACTOR = 3` in the blended ranking `score` only. The reported `bm25` and the low-confidence threshold stay unboosted.
- `FTS_WEIGHTS` is back to its original values.
- Tests: `search-partly-enriched.test.ts` pins both cases on a partly enriched fixture. The task-2 test fails with `NAME_HIT_FACTOR = 1` (expandDoc at 11), the task-6 test fails with `DOC_SEED_RESERVE = 0`.
- Docs (root and package CLAUDE.md, `docs/evals.md`, code-graph-search skill) say 7/7 on both stores; bundle regenerated.

## Deviations
- The approved route for task 2 was a lighter purpose/tags weight (B or C). `@test` failed that build: `eval-as-is` was 6/7 with expandDoc at rank 7, and the earlier fixture did not reproduce the real failure. Weight tuning could not reach a safe margin (best case 6 of 6, with loadConfigOrExit pushed from 5th to 6th or 7th), so `@backend` added a multiplicative name-hit factor instead.
- This adds a new scoring concept to `search.ts`. A first attempt raised the reported bm25 and broke 3 confidence tests; it was fixed by feeding the factor only into the blended score.

## Decisions
- The multiplier beat an additive name bonus because the additive one moves stripped `expandVertex` from 2 to 3 (not equal-or-better). The multiplier leaves the stripped store identical.
- Factor sweep: x1.3 and x1.5 give expandDoc 6, x2 gives 5, x3 gives 4 (chosen, with margin), x5 the same as x3.
- No `FTS_FORMAT` bump (still 2), no reindex, no exit-7 wording change, same `--json` shape and exit codes.

## Touches
`packages/code-graph/src/query/search.ts`; `packages/code-graph/src/query/search-partly-enriched.test.ts` (new); root `CLAUDE.md`, `packages/code-graph/CLAUDE.md`, `docs/evals.md`, `.claude/skills/code-graph-search/SKILL.md`; `plugin/scripts/code-graph.cjs` (generated). `scribe/bootstrap.ts` is back to its original `FTS_WEIGHTS`.

## Sibling impact
Ticket 060 merges first and this task rebases and regenerates the bundle. No version bump here. The local store needs `just regraph` for the real-store numbers, since the code-graph-search doc row was stale.

## Verified
Base commit 9b6a67f plus uncommitted changes; nothing is committed yet. On the working tree, `@backend` reports `pnpm build`, `pnpm check` and `pnpm test` (689/689, incl. `confidence.test.ts` and `search-exit.test.ts`), `just regraph`, `just eval` 7/7 and `just eval-as-is` 7/7. The independent `@test` re-run of this final change is still pending after this review, and the full suite is not yet verified on a committed result.

Per-task ranks (expected vertex / limit), partly enriched store, before then after:
- Task 1: truncate 1 then 1, applyTokenBudget 2 then 2, estimateTokens 4 then 3.
- Task 2: expandVertex 1 then 1, expandDoc 9 then 4, queryImpact 3 then 2.
- Task 3: preflight 2 then 2, checkSchemaVersion 1 then 1, loadConfigOrExit 5 then 3.
- Tasks 4 to 7 unchanged and passing. Task 6: concept-skills-layer absent then 3rd.
Stripped store: all ranks identical before and after.

## Questions
1. Is a name-hit multiplier in the blended score acceptable as the task-2 fix instead of the approved weight route? Weights alone could not meet "equal or better on both stores" with margin.
2. Any objection to the factor being 3, or to a name match boosting only the blended score and not the reported bm25 or confidence?
