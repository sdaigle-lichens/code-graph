Round 3 (loop-back after on-track m008: @test found four defects, @backend fixed them)

## Goal
Bench review mode comparing the four reviewer arms on seeded-bug diffs, with a pre-registered rule.

## Done
- Spawn validity: spawnEvidence now requires a Haiku model in the subagent messages (the Agent call's own model field counts only when no subagent message exists).
- Graders: "is fine/correct/no bug" findings are no longer credited; the r-l2 pattern is tightened so an r-l4 finding does not credit r-l2; a test checks no bug description credits another case's grader.
- review-run --dry on a broken maestro checkout now exits 3 with the reason.
- Code and doc agree: tally counts only paired cells (a case/run counts only if every planned arm has a valid run), so a cap stop or an invalid run drops that cell for all arms; the report prints "Counted N of M valid runs". This also answers the manager's m008 direction note (a cap stop leaves every arm with the same complete runs).
- @test added bench/review-cli.test.mjs (8 tests) and unit tests.

## Deviations
- This changes the pre-registered text (false-alarm count, grader and spawn-validity rules, paired-cell wording) after commit 0447717, so a new pre-registration commit is needed before the paid run.
- Preflight, pilot and paid run remain user-run (criteria 5 and 6 open). Cap $10, pilot $1.50, per-run $0.40, 2 runs per cell (user's choice).

## Decisions
- Paired-cell tally instead of comparing arms with unequal run counts.
- Primer stays in bench/; no package or bundle change.

## Touches
bench/review.mjs, review-cases.mjs, review-run.mjs, review.test.mjs, review-cli.test.mjs, docs/evals.md (Ticket 066). Nothing in the maestro repo.

## Sibling impact
None.

## Verified
Commit 1064e82 (made with the user's approval). `pnpm verify` from the root on it: exit 0, 14/14 tasks successful, code-graph tests 718 pass, 0 fail. `node --test bench/*.test.mjs`: 139 pass, 0 fail, 0 todo.

## Questions
None beyond the commit approval.
