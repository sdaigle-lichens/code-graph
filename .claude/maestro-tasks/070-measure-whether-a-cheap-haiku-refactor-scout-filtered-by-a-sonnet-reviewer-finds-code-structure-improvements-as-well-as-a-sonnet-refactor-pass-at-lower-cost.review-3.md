Round 3

Round 2 was on-track. This round follows a reviewer loop-back (not a manager redirect): @reviewer returned FAIL because an answer with no PROPOSALS header graded as a valid run with 0 proposals and 0 false findings, invisible in the report, which would bias the headline false-finding metric.

## Goal
Unchanged: bench measuring a Haiku refactor scout filtered by a Sonnet reviewer against a Sonnet refactor pass.

## Done
- answerProblems(arm, grade) in bench/refactor.mjs flags a missing PROPOSALS section, and for the pipeline a missing VERDICTS section; refactor-run.mjs adds these to the run problems, so the run is invalid, not counted, and listed. `PROPOSALS: none` stays valid.
- The per-case report table has a `structured` column.
- The refactorReport todo test is now a passing test.
- docs/evals.md and bench/README.md pre-register that an unstructured run is invalid, rerun or reported as missing, and the pairing rule drops that (case, run) for every arm.
- Non-blocking items done: a test pins that an all-clear bullet counts as a false finding; docs say the reader applies "overall never overrides a category" from the two printed tables.
- @test's added tests are included in the commit.

## Deviations
Caps remain placeholders; the measured commit is named in a docs-only follow-up after the user sets caps. pnpm-lock.yaml and docs/test-report.md are not committed.

## Decisions
An unstructured answer makes the run invalid rather than scoring zero.

## Touches
bench/refactor.mjs, bench/refactor-run.mjs, bench/refactor.test.mjs, bench/refactor-cli.test.mjs, bench/README.md, docs/evals.md. Nothing in the maestro repo.

## Sibling impact
Unchanged: ticket 069 shares the bench runner and docs/evals.md and starts after this merges.

## Verified
Commit b0c30c5. pnpm verify exit 0 on it (backend's report). node --test bench/*.test.mjs run by me on it: 193 pass, 0 fail, 0 skipped, 0 todo.

## Questions
None.
