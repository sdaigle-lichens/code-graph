Round 5

Round 4 was on-track (all-clear lines are their own count, excluded from false findings, phrase-list limit stated). @reviewer then returned FAIL: the embedded phrase lists swallowed real proposals asymmetrically ("good candidates for one shared helper", "the export is fine to delete", a path starting `none-`), a bullet on the PROPOSALS header line was dropped, and "Leave it as is" / "No issues found" bullets were false findings. This round is that loop-back fix, not a manager redirect.

## Goal
Unchanged: bench measuring a Haiku refactor scout filtered by a Sonnet reviewer against a Sonnet refactor pass.

## Done
Commit 0301d2e, all in bench/refactor.mjs unless noted:
- A line in the `<file>: <kind>: ` shape is always a proposal; isAllClear returns false for it before any phrase test. The embedded ABSENT_RE is deleted; matches() uses !isAllClear(item), so an expected improvement worded "is OK to keep, but duplicates" is still credited.
- `none` is whole-line only; `none-helpers.ts: dedupe: x` is a proposal.
- A bullet or numbered rest on the `PROPOSALS:` header line is the first item.
- Whole-line all-clear forms added (leave it as is, no issues/problems/findings found, not needed, nothing found, short "X is fine/ok/clean" lines without but/however/duplicat*/except).
- Header prose naming a file path is kept as one item; header prose naming no file is one all-clear (documented limit).
- docs/evals.md and bench/README.md no longer claim the effect is alike across arms: they list the residual limits and say they fall on the arm that phrased the text so.
- Tests: refactor.test.mjs now has 38 (3 new: shaped-line variants incl. none-helpers.ts, the "OK to keep, but duplicates" credit, header forms; the all-clear test gained the new forms). @test's runner tests in refactor-cli.test.mjs are included.

## Deviations
Caps remain placeholders; the measured commit is named in a docs-only follow-up after the user sets caps. pnpm-lock.yaml and docs/test-report.md are not committed. One older test that used a shaped "fine as written" line as an all-clear was changed to an unshaped line (a shaped one is now a false finding by design).

## Decisions
A shaped line is always a proposal, even if it says the code is fine; that is a false finding for the arm that wrote it. Residual limits: unusual unshaped all-clear wording counts as a false finding, and header prose naming a file is kept as an item.

## Touches
bench/refactor.mjs, bench/refactor.test.mjs, bench/refactor-cli.test.mjs, bench/README.md, docs/evals.md. Nothing in the maestro repo.

## Sibling impact
Unchanged: ticket 069 shares the bench runner and docs/evals.md and starts after this merges.

## Verified
Commit 0301d2e. node --test bench/*.test.mjs run by me on it: 202 pass, 0 fail, 0 skipped, 0 todo. pnpm verify exit 0 on it, but all 14 tasks were cache replays (bench/ is outside turbo); the bench result is the direct node --test run.

## Questions
None.
