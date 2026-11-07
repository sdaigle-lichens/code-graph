Round 2

Previous redirect (round 1), each point followed by how it was addressed:

1. "Extra proposals on non-clean cases are reported but not scored false" was off course; count every proposal beyond the expected ones as a false finding on every case, per arm and per category, in the decision rule; for the pipeline, kept false findings after the filter; possibly-real extras as a pre-registered limitation or fixed hand-audit, never post hoc.
   Addressed: gradeItems in bench/refactor.mjs counts every proposal beyond expected/tolerated as a false finding on all 11 cases (the `extra` field is removed) and returns falseByCat via proposalCategory. gradePipeline counts false findings on survivors only (scout.falseFindings and falseRemoved still reported). The report has a by-category false-finding table. The decision rule in docs/evals.md counts false findings on all 33 case-runs per arm, overall and per category; the pipeline recommendation requires false findings not above baseline overall or in any category. Limit 3 pre-registers a fixed audit written before the run: pool all kept false findings across arms and runs, strip arm labels, mark confirmed only if a grep of the pinned tree confirms the duplicate, cycle or unused export; confirmed counts are reported beside the verdict and lower its confidence if uneven; the verdict is never recomputed. No clean cases added; stored scope and primer files unchanged, 22-file drift check still passes.
2. State that 4 real refactors with a seeded-only cycle category is accepted; say if the two 05d5b76 cases are distinct.
   Addressed: Limit 1 in docs/evals.md states it; f-r3 (duplicated readLogLines in maestro-resume-target.cjs, dedupe) and f-r4 (inlined staleness rule instead of runtimeNeedsRefresh in maestro-check-runtime.cjs, align) are stated as two distinct changes in that one commit.
3. Pre-register that 3 planted per category at 3 runs is likely inconclusive per category under the 051 rule.
   Addressed: Limit 4 states it (cycle and unused fire only if the baseline misses all 3; the other three categories need at least 3 of 6 missed) and expects mostly inconclusive or no-effect category verdicts, with false-finding figures the likely separator.

## Goal
Unchanged: bench measuring a Haiku refactor scout filtered by a Sonnet reviewer against a Sonnet refactor pass, at lower cost.

## Done
Round-1 redirect addressed in full (above). Refactor tests updated and extended; 37 pass in refactor.test.mjs and refactor-cli.test.mjs.

## Deviations
Caps remain placeholders ([USER TO SET: ...]); the measured commit is named in a docs-only follow-up after the user sets caps, as in 067. No clean neighbourhoods added.

## Decisions
False findings are the verdict-bearing metric; the hand-audit rule is fixed before any paid run.

## Touches
bench/refactor.mjs, bench/refactor.test.mjs, bench/refactor-cli.test.mjs, bench/README.md, docs/evals.md. Nothing in the maestro repo.

## Sibling impact
Unchanged: ticket 069 shares the bench runner and docs/evals.md and starts after this merges.

## Verified
Commit 04746a3 (earlier 762f584); pnpm verify green on 04746a3 per the agent's report; refactor tests green.

## Questions
None.
