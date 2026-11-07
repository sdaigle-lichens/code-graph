Round 4

Round 3 was on-track and carried a note for @reviewer: an all-clear bullet counted as a false finding would penalise arms that write "- nothing to change here", inflating Haiku's false findings through formatting; either ask for `PROPOSALS: none` and nothing else, or report all-clear bullets as their own count. @reviewer then returned FAIL on exactly that (plus header-line variants such as `PROPOSALS: no proposals`). This round is the loop-back fix, not a manager redirect.

## Goal
Unchanged: bench measuring a Haiku refactor scout filtered by a Sonnet reviewer against a Sonnet refactor pass.

## Done
Both fixes the manager named, in commit 20d6745:
- Prompt: FORMAT in bench/refactor.mjs asks for `PROPOSALS: none` and nothing else (no bullet, no sentence, no all-clear line); a test pins the wording.
- All-clear is its own count: isAllClear classifies header-line text (`no proposals`, `nothing to do`, `No refactor is warranted`), all-clear bullets and "fine as written" bullets. An all-clear line is never credited, never a proposal, never a false finding. gradeItems reports `allClear`; the report has an "all-clear lines" column per case and per arm; tally sums it.
- Pipeline: proposalsOf removes all-clear text from the scout's list before the filter sees it; refactor-run.mjs builds the filter's list from proposalsOf; gradePipeline carries the scout's all-clear count.
- Pre-registration (docs/evals.md, bench/README.md): all-clear lines do not count toward false findings; the classifier is a phrase list, and a real proposal containing an all-clear phrase such as "not worth" would be read as all-clear, which lowers every arm's false findings alike (stated limitation).
- `PROPOSALS:` followed by prose only counts as one all-clear: like `none` on a clean case, a legitimate zero on a case with expected improvements.
- The old "all-clear counts as a false finding" test is replaced by one covering six forms, `none`, a mixed answer and the pipeline; @test's two runner tests are included.

## Deviations
Caps remain placeholders; the measured commit is named in a docs-only follow-up after the user sets caps. pnpm-lock.yaml and docs/test-report.md are not committed. The earlier rule that all-clear bullets are false findings (round 3 text) is reversed.

## Decisions
All-clear text is reported separately and excluded from false findings. Known cost: phrase-list classification can swallow a real proposal that contains an all-clear phrase, which lowers every arm alike.

## Touches
bench/refactor.mjs, bench/refactor-run.mjs, bench/refactor.test.mjs, bench/refactor-cli.test.mjs, bench/README.md, docs/evals.md. Nothing in the maestro repo.

## Sibling impact
Unchanged: ticket 069 shares the bench runner and docs/evals.md and starts after this merges.

## Verified
Commit 20d6745. pnpm verify exit 0 on it (backend's report). node --test bench/*.test.mjs run by me on it: 197 pass, 0 fail, 0 skipped, 0 todo.

## Questions
Is excluding all-clear lines from false findings acceptable, given the phrase-list limitation that can hide a real proposal?
