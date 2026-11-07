Round 8

Round 7 was on-track. @test's confirmation of fe54e14 then found a regression in that fix; the user's standing bar (a bug that changes a result) applied. This round is that fix, not a manager redirect. No further grader wording work is planned.

## Goal
Unchanged: bench measuring a Haiku refactor scout filtered by a Sonnet reviewer against a Sonnet refactor pass.

## Done
Commit 9089120, only bench/refactor.mjs and bench/refactor.test.mjs:
- A bare marker on the PROPOSALS header line (`-`, `1.`, `•`, `*`, or `- ` with trailing spaces) is an empty bullet; the stray `-` item from findingsOf is dropped; the next dashless shaped line is that item's content. `PROPOSALS: -\n<T>` gives [T], allClear 0, credit once (6e7ad0c credited it; fe54e14 lost it).
- `PROPOSALS: -\n<T>\n<D>`, `...\n- <D>` and `...\n\n<D>` each give 2 items. A bare marker with no shaped line after it is still one all-clear. `PROPOSALS: - <T>` followed by `<D>` is still one item (D a continuation), keeping the fe54e14 rule.
- Two new tests: the five bare markers (items, allClear 0, scout count 1, one false finding, so no double credit, plus the two multi-line shapes) and a pin that D after `PROPOSALS: - <T>` is a continuation.
- Bulleted-only grading unchanged: 242 texts compared, 0 differ from 6e7ad0c and 0 from 0301d2e.

## Deviations
Caps remain placeholders; the measured commit is named in a docs-only follow-up after the user sets caps. pnpm-lock.yaml and docs/test-report.md are not committed. No docs changed.

## Decisions
The header-bullet test agrees with the scan. This is the last grader fix round unless a new result-changing edge appears and the user approves another.

## Touches
bench/refactor.mjs, bench/refactor.test.mjs. Nothing in the maestro repo.

## Sibling impact
Unchanged: ticket 069 shares the bench runner and docs/evals.md and starts after this merges.

## Verified
Commit 9089120. node --test bench/*.test.mjs run by me on it: 209 pass, 0 fail, 0 skipped, 0 todo. pnpm verify exit 0 (likely a cache replay; bench/ is outside turbo).

## Questions
None.
