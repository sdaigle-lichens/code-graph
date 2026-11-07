Round 7

Round 6 was on-track. @test's confirmation of 6e7ad0c then found two result-changing defects in the new dashless-line scan; the user approved a small fix. This round is that fix, not a manager redirect. No further grader wording work is planned.

## Goal
Unchanged: bench measuring a Haiku refactor scout filtered by a Sonnet reviewer against a Sonnet refactor pass.

## Done
Commit fe54e14, only bench/refactor.mjs and bench/refactor.test.mjs:
- The unbulleted-line scan in proposalsOf now tests bullets on the raw line with the same regex as findingsOf, so an empty `- ` is a bullet: `PROPOSALS:\n- \nsrc/a.ts: dedupe: x` is one item, gradePipeline gives scout count 1 and false findings 1, nothing doubled.
- A bullet on the PROPOSALS header line opens an item; a shaped line directly after it is a continuation (`PROPOSALS: - a.ts: dedupe: x\nb.ts: dedupe: y` is one item; with a blank line between them it is two). The leftover segment of the header line is dropped from the scan.
- One new test, "the unbulleted-line scan agrees with findingsOf", covers both cases. Bulleted-only answers grade exactly as before.

## Deviations
Caps remain placeholders; the measured commit is named in a docs-only follow-up after the user sets caps. pnpm-lock.yaml and docs/test-report.md are not committed. The continuation line after a header-line bullet is not appended to that item's text, matching findingsOf.

## Decisions
The scan must agree with findingsOf on what a bullet is. No docs change, because no sentence became wrong.

## Touches
bench/refactor.mjs, bench/refactor.test.mjs. Nothing in the maestro repo.

## Sibling impact
Unchanged: ticket 069 shares the bench runner and docs/evals.md and starts after this merges.

## Verified
Commit fe54e14. node --test bench/*.test.mjs run by me on it: 207 pass, 0 fail, 0 skipped, 0 todo. pnpm verify exit 0 (likely a cache replay; bench/ is outside turbo).

## Questions
None.
