# Report r052: 061-make-search-rank-partly-enriched-stores-as-well-as-un-enriched-ones-eval-tasks-2-and-6.md

- Task: 061-make-search-rank-partly-enriched-stores-as-well-as-un-enriched-ones-eval-tasks-2-and-6.md
- Written: 2026-11-02T02:26:48.080Z
- From session: absorb-concept-skills-061

## Outcome
Ticket 061 is built and verified on the working tree, but NOT committed. The user has not asked for a commit, so the commit hash is pending. HEAD is 9b6a67f plus uncommitted changes.

## Verified
On the uncommitted tree, @test ran: just regraph, pnpm build, pnpm check, pnpm test (689/689), pnpm typecheck, just eval 7/7 and just eval-as-is 7/7. The full suite is green on the working tree. It is not yet verified on a committed result, so a green run on the commit is still owed.

## Change
- Task 6: DOC_SEED_RESERVE = 2 keeps the best 2 doc seeds beyond the top 10 in searchStore.
- Task 2: a whole-token name match multiplies the blended score by NAME_HIT_FACTOR = 3. The reported bm25 and the low-confidence threshold are unboosted. FTS_WEIGHTS is unchanged.
- No FTS_FORMAT bump, no reindex, no change to exit codes or the --json shape.
- New test: search-partly-enriched.test.ts pins both cases. It fails with NAME_HIT_FACTOR = 1 or DOC_SEED_RESERVE = 0.
- Docs updated: root CLAUDE.md, packages/code-graph/CLAUDE.md, docs/evals.md (with the sweep table), code-graph-search skill. Bundle regenerated. No version bump (the merger does).

## Findings
- Partly enriched store before: expandDoc 9 (needs top 6), concept-skills-layer missing from the clusters (5/7). After: expandDoc 4, queryImpact 3 to 2, loadConfigOrExit 5 to 3, estimateTokens 4 to 3, concept-skills-layer 3rd. Stripped store: expected vertices and clusters unchanged.
- Weight tuning alone could not reach a safe margin (best 6 of 6 and loadConfigOrExit worsened). Manager reviews m011 and m012 were both on-track.
- Observed shifts, non-blocking: the task-6 hit list on the stripped store, and the top cluster of the generic query "skill" (scribe-pipeline to code-graph-search, still exit 7). docs/evals.md now says so.
- Ran extract + apply for code-graph-search after the skill edit.

## Post-mortem
Round 1 of @test failed: eval-as-is was 6/7 because the first weight-only fix left expandDoc at rank 7 and the task-2 fixture did not reproduce the real failure. It was looped back to @backend and replaced by the name-hit multiplier, re-approved by the manager (m012).

## Suggested ticket changes
None. 060 merges first; this task needs a rebase and a pnpm bundle after it.
