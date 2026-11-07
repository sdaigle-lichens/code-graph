Round 6

Round 5 was on-track. At the user's instruction, @reviewer made one last pass over the grader wording and returned FAIL on a single result-changing bug; this round is that fix, not a manager redirect. No further wording passes are planned.

## Goal
Unchanged: bench measuring a Haiku refactor scout filtered by a Sonnet reviewer against a Sonnet refactor pass.

## Done
Commit 6e7ad0c:
- Blocker: a `<file>: <kind>: <text>` line with no bullet under the last PROPOSALS header was dropped, so the run scored zero proposals silently and the pipeline filter never saw it. proposalsOf now adds such lines as items when the answer is structured. A shaped line directly after a bullet with no blank line stays that bullet's continuation; unbulleted non-shaped prose is still ignored.
- @test's three todo tests resolved: the dashless-line test is a real passing test (including gradePipeline counting it in anchor.scout); the "No changes needed in X, but ..." test pins the documented behaviour (it counts as an all-clear); the unshaped all-clear test passes after ALL_CLEAR_LINE_RE gained whole-line forms (`nothing to flag`, `none of the files/modules/... need changes`, `the files are all good`). No todo or failing test remains.
- docs/evals.md and bench/README.md: one sentence for the fix and three documented limits (an unshaped line opening with an all-clear phrase counts as an all-clear; header prose naming no file is one all-clear; unusual unshaped all-clear wordings count as false findings for the arm that wrote them).

## Deviations
Caps remain placeholders; the measured commit is named in a docs-only follow-up after the user sets caps. pnpm-lock.yaml and docs/test-report.md are not committed.

## Decisions
Dashless shaped lines are proposals. The remaining grader wording limits are documented, not fixed, at the user's instruction.

## Touches
bench/refactor.mjs, bench/refactor.test.mjs, bench/README.md, docs/evals.md. Nothing in the maestro repo.

## Sibling impact
Unchanged: ticket 069 shares the bench runner and docs/evals.md and starts after this merges.

## Verified
Commit 6e7ad0c. node --test bench/*.test.mjs run by me on it: 206 pass, 0 fail, 0 skipped, 0 todo. pnpm verify exit 0 (likely a cache replay; bench/ is outside turbo).

## Questions
None.
