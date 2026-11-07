# Report r014: 071-measure-whether-a-haiku-refactor-scout-with-a-batched-or-reviewer-inline-sonnet-filter-gives-more-useful-findings-per-dollar-than-a-sonnet-refactor-pass.md

- Task: 071-measure-whether-a-haiku-refactor-scout-with-a-batched-or-reviewer-inline-sonnet-filter-gives-more-useful-findings-per-dollar-than-a-sonnet-refactor-pass.md
- Written: 2026-11-06T20:08:59.728Z
- From session: haiku-subagents-with-graph-071

## Outcome
Updated report for 071 (replaces the commit-less r013). The build is committed. Measured commit is c850a00 (bench/ and docs/evals.md, not docs/report.md). f142006 is a docs-only follow-up that names c850a00 in docs/evals.md, as 067 did.

## Verified
Commit verified: c850a00. Full pnpm verify green on it (14/14 tasks, 718 code-graph tests, 0 fail; turbo replayed its cache because nothing in the packages changed since the earlier uncached run at HEAD 5323c6e plus this tree, which was 14/14 and 718 pass). node --test bench/*.test.mjs: 231 pass, 0 fail (run after the last doc and test-title edit). refactor-prep --check and the dry run ok.

## Remaining
The ticket's results criterion (AC5) stays open until the user runs the pilot and the paid run. No paid run was started by the agent; nothing changed in the maestro repo. Caps pre-registered: $0.60 per session, $3 pilot, $7 paid, $10 total.

## Findings
The 3-baseline-misses per-category condition is enforced only at set level by the pilot stop rule (manual per category). Pilot costs for review and batch stages are estimated from 070.

## Suggested ticket changes
A follow-up to record the results after the paid run, optionally enforcing the per-category miss check first.
