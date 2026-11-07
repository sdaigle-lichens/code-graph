Round 2

Previous redirect: the verification gate was missing: no commit, no green suite on a commit; name the sha in the amendment before the paid run, in a docs-only follow-up commit; only the Touches files committed.
- Commit: the user approved it in this session; I committed only the six Touches files (git add by path, no -am) as 6fea03c. The unrelated working-tree changes stay uncommitted.
- Green suite on it: pnpm verify on 6fea03c: 14 of 14 turbo tasks successful, code-graph tests 718 pass, 0 fail. node --test bench/*.test.mjs was 150/150 before the commit.
- Sha named before the paid run: docs-only follow-up commit 1b9c6ae changes one line in the amendment to name 6fea03c as the measured commit (the same pattern 068 used).

## Goal
Part 1 of 067: dated post-pilot amendment in docs/evals.md and bench default arms aligned with it, so the user can run the Haiku-vs-Sonnet paid run.

## Done
Amendment, default arms sonnet-nograph / haiku-nograph / haiku-diff-primer, tests and README updated (details as in round 1). Paid-run command: node bench/review-run.mjs --runs 3 --budget 12.19 --run-budget 0.4.

## Deviations
None beyond round 1 (068 amendment text kept as history).

## Decisions
Backend workflow; budget 12.19 = $13 minus $0.802 for the two pilots.

## Touches
docs/evals.md, bench/review.mjs, bench/review-run.mjs, bench/review.test.mjs, bench/review-cli.test.mjs, bench/README.md.

## Sibling impact
None; Part 2 waits for the user's paid run.

## Verified
Commit 6fea03c, full pnpm verify green on it (14/14 tasks, 718 tests pass). 1b9c6ae is a one-line docs change recording the sha.

## Questions
None.
