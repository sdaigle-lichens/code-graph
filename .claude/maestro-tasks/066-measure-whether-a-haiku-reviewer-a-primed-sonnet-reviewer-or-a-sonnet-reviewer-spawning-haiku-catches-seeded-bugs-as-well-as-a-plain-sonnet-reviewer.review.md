## Goal
Add a code-review mode to the user-run bench to compare sonnet-nograph, sonnet-diff-primer, haiku-diff-primer, sonnet-spawns-haiku (and optional haiku-nograph) on seeded-bug diffs, with a pre-registered decision rule, before any paid run.

## Done
- 8 cases: 3 local-logic bugs, 3 cross-file breakages, 2 clean diffs; a grader per case, unit-tested on known-good and known-bad text.
- Deterministic $0 diff-primer generator; per-case .diff and .primer.txt stored under bench/review/ and `review-prep.mjs --check` confirms they are reproducible.
- Runner with the arms; a sonnet-spawns-haiku run is invalid unless the transcript shows a Haiku subagent started.
- bench/README.md Review mode section; docs/evals.md "Ticket 066" pre-registration (task set, arms, cap, decision rule).

## Deviations
- $0 preflight (`--init-check`) and pilot NOT run: `claude` is not on PATH in the agent sandbox. They must be run by the user from a plain terminal, so acceptance criteria 5 and 6 (preflight/pilot recorded, paid-run results) are still open.
- Cap ($30, pilot $4, per-run $1) and 3 runs per cell are tentative, to be confirmed at pilot time.
- No commit yet; the pre-registration commit must land before the paid run.

## Decisions
- Primer lives in bench/, so the code-graph package source and plugin bundle are untouched (no pnpm build needed).
- Decision rule follows 051: an arm helps when it recovers at least a third of the baseline's missed bugs and at least 3; fewer than 3 missed is inconclusive; per category and overall, overall never overriding a category.

## Touches
bench/review.mjs, review-cases.mjs, review-prep.mjs, review-run.mjs, review.test.mjs, bench/review/ (generated), bench/README.md, docs/evals.md. Nothing in the maestro repo.

## Sibling impact
None expected; bench-only and docs. Shared doc docs/evals.md gained one section.

## Verified
Working tree not yet committed. `node --test bench/*.test.mjs`: 126 pass, 0 fail; `pnpm check` passes. Full-suite on a commit is not yet available (nothing committed).

## Questions
- OK to proceed to @test/@reviewer/@scribe now, with the user running preflight, pilot and the paid run afterwards?
- Are the cap and 3 runs per cell acceptable?
