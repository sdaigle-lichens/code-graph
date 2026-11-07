# Report r013: 071-measure-whether-a-haiku-refactor-scout-with-a-batched-or-reviewer-inline-sonnet-filter-gives-more-useful-findings-per-dollar-than-a-sonnet-refactor-pass.md

- Task: 071-measure-whether-a-haiku-refactor-scout-with-a-batched-or-reviewer-inline-sonnet-filter-gives-more-useful-findings-per-dollar-than-a-sonnet-refactor-pass.md
- Written: 2026-11-06T19:55:41.343Z
- From session: haiku-subagents-with-graph-071

## Outcome
Ticket 071 build is complete: bench extended with the haiku-batched-filter and haiku-reviewer-inline arms (control arm sonnet-review-plain), 6 harder cases (3 latent cases added), a scriptable blinded usefulness audit (bench/refactor-audit.mjs), tests, README, and the "Ticket 071" pre-registration in docs/evals.md. Caps pre-registered with the user: $0.60 per session, $3 pilot, $7 paid, $10 total. Batch size 3.

## Verified
Verified at HEAD 5323c6e plus the uncommitted working tree (bench/, docs/evals.md). Full pnpm verify green (14/14, 718 code-graph tests, uncached); node --test bench/*.test.mjs 231 pass, 0 fail (rerun after the scribe edit); refactor-prep --check and the dry run ok. Nothing is committed yet, so the measured commit does not exist: it must be made (then pnpm verify green) before the pilot.

## Findings
- Decision rule in docs/evals.md was reworded to match usefulVerdict (overall ratio/recall/noise bars; categories only block on a loss of 3 or more).
- Gap: the 3-baseline-misses-per-category condition is enforced only at set level by the pilot stop rule; a per-category check is manual. Enforcing it would be a pre-registration change before the paid run.
- Pilot runs sonnet-plain only, so review and batch costs are estimated from 070 (0.46x factor); f-r5's 29 KB plant diff may make reviews cost more.
- Untracked docs/report.md is a stray 070-era log; do not commit.

## Remaining
AC5 (record results, confidence, recommendation) is open until the user runs the pilot and paid run. No paid run was started by the agent; nothing changed in the maestro repo.

## Post-mortem
Clean session; no problems.

## Suggested ticket changes
A follow-up ticket to record 071 results after the paid run, and optionally to enforce the per-category 3-miss check before it.
