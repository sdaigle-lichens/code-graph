# Report r012: 070-measure-whether-a-cheap-haiku-refactor-scout-filtered-by-a-sonnet-reviewer-finds-code-structure-improvements-as-well-as-a-sonnet-refactor-pass-at-lower-cost.md

- Task: 070-measure-whether-a-cheap-haiku-refactor-scout-filtered-by-a-sonnet-reviewer-finds-code-structure-improvements-as-well-as-a-sonnet-refactor-pass-at-lower-cost.md
- Written: 2026-11-06T13:15:29.586Z
- From session: haiku-refactor-agent

Ticket 070: outcome

The Haiku refactor scout filtered by a Sonnet reviewer is NOT recommended in its pre-registered form. Confidence: low. Results are in docs/evals.md, section "Results (pilot rerun and paid run, 2026-11-06)".

Commit verified: 5323c6e on main (not pushed). Graders and runner were measured at 9089120, the reworked cases and design at a449c7b, caps at 655be90. The full suite was green on it: node --test bench/*.test.mjs passed 209/209 on 9089120 and 210/210 on a449c7b (code unchanged in 5323c6e), refactor-prep --check unchanged, pnpm verify 14/14 (a cache replay; bench/ is outside turbo).

Findings (paid run, 36/36 valid, 12 paired runs per arm, $3.198; total study spend about $5.57 of a $10 ceiling):
- sonnet-plain: 6/10 expected kept, 23 false findings, $0.139 per run.
- haiku-metrics-primer: 7/10, 38 false findings (more than baseline overall and in dedupe, extract, unused), $0.015 per run (-89%).
- haiku-scout-sonnet-filter: 6/10, 18 false findings (fewer), $0.112 per run (-19%). It fails the "at least 20% cheaper" condition by one point; the other three "worth adding" conditions pass. Anchoring 51% (31 of 61), 0 lists unchanged, 0 expected improvements lost, 30 false findings removed. The saving rests largely on one case (f-c1); without it the pipeline is about 6% dearer.
- Every improvements category is inconclusive (the baseline missed under 3 in each), so recall could not separate the arms.
- Fixed blind audit of the 79 false findings: 68 confirmed (86%): plain 22/23, primer 31/38, pipeline 15/18. The metric mostly counts extra proposals, not wrong ones. Real unplanted duplicates in the maestro tree were found (readGlobalHandoff copied in three plugin scripts, repeated code in tasks.ts, an unused readSessionLog); five examples are in the docs if you want to act on them.
- The spawn arm (sonnet-spawns-haiku-scouts) was not run; it is opt-in and untested at paid cost.

Post-mortem notes: six grader fix rounds (each a result-changing bug found by review or test); the first case set was saturated (baseline 8/8) and cost a $1.525 pilot; the original pilot gate was unusable at 5 expected improvements; cost per session was unknown when caps were set, forcing a cut from 132 to 36 cells.

Suggested ticket changes:
- Ticket 069 shares the bench runner and docs/evals.md and may start now; it should read the 070 amendment before changing the pilot gate or the default arms.
- Any follow-up that wants a verdict on recall needs harder cases (a baseline that misses at least 3 per category) and more runs; at about $0.14 per Sonnet session that is a new budget decision for the user.
- The docs-only change to act on: consider the confirmed real duplicates from the audit as candidate refactor tickets for the maestro repo.
