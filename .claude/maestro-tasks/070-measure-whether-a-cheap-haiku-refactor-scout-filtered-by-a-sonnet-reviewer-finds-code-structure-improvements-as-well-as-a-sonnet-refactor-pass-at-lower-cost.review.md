## Goal
Bench that measures whether a Haiku refactor scout, filtered by a Sonnet reviewer, finds code-structure improvements as well as a Sonnet refactor pass, at lower cost. Bench code, tests, README and docs/evals.md only.

## Done
- Refactor mode on the review bench runner: 11 cases (4 reverted real refactors from maestro history: 58eb91f, 71569fd, 05d5b76 twice; 4 seeded structural problems; 3 clean neighbourhoods).
- Graders per case, unit-tested on known-good and known-bad output.
- Deterministic $0 metrics primer and neighbourhood scope per case, stored (22 files in bench/refactor/) and drift-checked offline.
- Four arms: sonnet-plain, haiku-metrics-primer, haiku-scout-sonnet-filter (scored on survivors, both stages' cost, anchoring), sonnet-spawns-haiku-scouts (invalid without a Haiku subagent in the transcript).
- docs/evals.md "Ticket 070" pre-registration section.
- No paid run made.

## Deviations
- Caps are placeholders in docs/evals.md ([USER TO SET: ...]); the runner refuses a paid run without --budget and --run-budget.
- No real cycle-removal refactor exists in the pinned history, so the cycle category is seeded only.
- Measured-commit naming needs a follow-up docs-only commit once caps are set.
- Small findingsOf change in bench/review.mjs.

## Decisions
- Extra proposals on non-clean cases are reported but not scored false.
- Primer does not measure duplication or drift; unused-export scan is text-based. No package source change was needed.

## Touches
bench/refactor.mjs, refactor-cases.mjs, refactor-prep.mjs, refactor-run.mjs, two test files, bench/refactor/ (22 stored files), bench/review.mjs, bench/README.md, docs/evals.md. Nothing in the maestro repo.

## Sibling impact
Ticket 069 shares the bench runner and docs/evals.md; it starts after this one merges. The review.mjs change is small and backward compatible as far as the agent reports.

## Verified
Commit 762f584; pnpm verify green on it (agent's report, exit 0); node --test bench/*.test.mjs green.

## Questions
- Is a 4-case reverted-real set acceptable with the cycle category seeded only?
- Cycle and unused categories have only 3 planted per 3 runs; accept?
