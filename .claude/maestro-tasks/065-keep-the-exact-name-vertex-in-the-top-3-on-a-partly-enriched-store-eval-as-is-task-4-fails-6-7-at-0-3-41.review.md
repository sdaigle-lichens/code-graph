## Goal

Ticket 065: on the partly enriched real store, `just eval-as-is` task-4 (`scribe apply drift detection`) must rank vertex `apply` in the top 3. At 0.3.41 it ranked 4th (6/7).

## Done

- Cause was the ranking, not the enrichment text. `apply` (bm25 3.12) already carried `NAME_HIT_FACTOR` 3. `NeverAppliedDrift`, `DriftJson` and `isConceptApplied` are also name hits through the porter stems (`applied`, `drift`), and their purposes repeat several query words.
- Added a structural signal, `NAME_EQUALS_TOKEN_FACTOR = 3`, in `query/search.ts`. A seed vertex gets its blended-score bm25 multiplied by 3 more when its lowercased whole name equals a query token, it is not a `type-def`, and it is not already an exact whole-query hit.
- The boost is left out of the `maxBm25` normaliser. Without that exclusion eval task-3 failed, because `preflight` squashed the others.
- Reported `bm25`, the low-confidence threshold, the `search --json` shape and `FTS_FORMAT` are unchanged.
- `queryTokens` is a new export in `scribe/rows.ts`, split out of `toMatchExpr`.
- Pinned test in `query/search-partly-enriched.test.ts`. Mutation evidence: with the factor at 1 it fails with `apply at 4, want top 3`; at 3 it passes.
- Real store, task-4 top 3: before NeverAppliedDrift, DriftJson, isConceptApplied. After: apply, NeverAppliedDrift, DriftJson.
- Real store, task-3 top 3: before checkSchemaVersion, preflight, loadConfigOrExit. After: preflight, checkSchemaVersion, loadConfigOrExit.
- Stripped store, task-3 top 3: before checkSchemaVersion, preflight, applySchema. After: preflight, checkSchemaVersion, Config.
- Stripped store, task-4 top 3: before NeverAppliedDrift, apply, DriftJson. After: apply, NeverAppliedDrift, DriftJson.
- Tasks 1, 2 and 6: identical top 3 on both stores. Tasks 5 and 7: same hits, scores changed.

## Deviations

- The blended `score` of a boosted vertex can now exceed 1 (for example 2.4 for `formatConcept`), because it is no longer normalised against the boosted maximum. The reported `bm25` is unchanged.
- On the stripped store, eval task-3 now ranks `Config` third where it was `applySchema` before.
- The SKILL.md stamp was applied by Edit (version 1.3, last-update 482276d), because `skills stamp --bump minor --reviewed` exited 9. It is not stamped through the CLI.
- The store was refreshed by the user running `apply code-graph-search` and `extract` + `apply scribe-pipeline` by hand, since the classifier denied the agent's `apply`.

## Decisions

- Structural whole-name-equals-query-token signal instead of weight tuning, which failed in 061.
- `type-def` is excluded from the signal, so a type-def named like a query word (`Config`) is not boosted and a function wins a tie.
- The boost is kept out of the normaliser.

## Touches

- `packages/code-graph/src/query/search.ts`
- `packages/code-graph/src/query/search-partly-enriched.test.ts`
- `packages/code-graph/src/scribe/rows.ts`
- `CLAUDE.md` (eval-as-is sentence)
- `packages/code-graph/CLAUDE.md` (Search ranking bullet)
- `.claude/skills/code-graph-search/SKILL.md`
- `plugin/scripts/code-graph.cjs` (generated)

## Sibling impact

- `searchStore` now calls `queryTokens` in `scribe/rows.ts`, a cross-concept `calls` edge into `scribe-pipeline`. Until that concept is re-applied, the desktop real-store canvas suite is red (23 skipped edges against 24), so a consumer store needs `just regraph`.
- Other tickets that touch `search.ts` ranking or the blended score will see scores above 1.

## Verified

- HEAD is 482276d and the changes are uncommitted in the working tree.
- On that tree, `pnpm check` passes and `pnpm test` is fully green (code-graph 716/716, desktop green, 5/5 tasks) after the store was refreshed.
- `just eval` is 7/7 with `store: un-enriched (stripped copy ...; 163 of 236 vertices carry a purpose in the real store)`.
- `just eval-as-is` is 7/7 with `store: enriched (as-is, not stripped; 163 of 237 vertices carry a purpose in the real store; verdict depends on local enrichment)`.
- `pnpm-lock.yaml` was already modified before the task and is not to be committed.

## Questions

- Is a blended `score` above 1 acceptable, or should scores be re-normalised?
