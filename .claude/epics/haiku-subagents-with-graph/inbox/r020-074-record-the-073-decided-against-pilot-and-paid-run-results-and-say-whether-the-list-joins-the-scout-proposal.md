# Report r020: 074-record-the-073-decided-against-pilot-and-paid-run-results-and-say-whether-the-list-joins-the-scout-proposal.md

- Task: 074-record-the-073-decided-against-pilot-and-paid-run-results-and-say-whether-the-list-joins-the-scout-proposal.md
- Written: 2026-11-07T00:36:26.118Z
- From session: haiku-subagents-with-graph-074

Update to r019 (round 2). Outcome: 074 done, committed as 68fcadc (docs/evals.md only; docs/report.md left untracked).

Verification: pnpm verify green on 68fcadc: 14 of 14 turbo tasks, 0 test failures; prettier clean on docs/evals.md.

Corrections since r019: the doc line claiming the decided arm's per-cell new findings sum to 70 was wrong. I re-summed the report's per-cell column: 68 over 30 cells for the decided arm and 50 for the control, matching the report totals. The discrepancy is removed from the doc and 68 stays.

Results unchanged: verdict cuts repeats but loses recall (repeats 47 to 9, 81% cut; expected found 26 to 19 of 48 = 73%, step 4 fires). Cost 0.760 of 1.50 paid, study total 0.883 of 2. Confidence moderate. The decided-against list does not join the workflow proposal; no further paid run on this design without an amended list or recall bar and its own pre-registration.

Post-mortem: the scribe miscounted the column sum; the manager caught it. Suggest scribe agents re-sum a table column rather than report an unresolved discrepancy against a report total.
