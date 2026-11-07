## Goal
Part 1 of 067: before any paid run, record a dated post-pilot amendment in docs/evals.md (Ticket 066 section) and align the bench's default planned arms with it, so the user can run the Haiku-vs-Sonnet paid run.

## Done
- Amendment "Post-pilot amendment (2026-11-05, ticket 067, before any Haiku data exists)" in docs/evals.md: both pilot A results (066: sonnet-nograph 4/4, $0.335; 068: 4/4, 1 false alarm on r-c6, $0.467), double stop-rule outcome, planned arms sonnet-nograph / haiku-nograph / haiku-diff-primer, sonnet-diff-primer dropped, sonnet-spawns-haiku unplanned, "recovers" inconclusive in advance, only hurts / no-effect-shown decided per category and overall (overall never overriding a category), r-x3/r-x5 softer-cross note, 3 runs per cell, caps $13 total / $0.40 per run, cost estimate about $5.3 to $5.6 for the paid run.
- DEFAULT_REVIEW_ARMS in bench/review.mjs and the header of bench/review-run.mjs now name the three arms; dropped arms stay selectable via --arms; tests pin this; bench/README.md review section updated.
- Paid-run command for the user: node bench/review-run.mjs --runs 3 --budget 12.19 --run-budget 0.4 (optional preflight: --init-check).

## Deviations
- The measured-commit sha in the amendment is blank until the user approves the commit; it is filled in with the first results entry.
- The 068 amendment text is left as history (still says four arms).

## Decisions
- Used the backend workflow (needs a bench code change plus docs).
- Budget flag 12.19 is the $13 cap minus the $0.802 spent on both pilots.

## Touches
docs/evals.md, bench/review.mjs, bench/review-run.mjs, bench/review.test.mjs, bench/review-cli.test.mjs, bench/README.md. Nothing in the maestro repo.

## Sibling impact
None known; Part 2 (results recording) waits for the user's paid run.

## Verified
Working tree, not yet committed (the commit needs the user's approval): node --test bench/*.test.mjs 150/150 and pnpm verify green. Re-verification on the amendment commit follows once it exists.

## Questions
None.
