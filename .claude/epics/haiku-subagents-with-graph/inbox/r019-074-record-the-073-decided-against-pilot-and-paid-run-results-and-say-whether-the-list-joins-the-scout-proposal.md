# Report r019: 074-record-the-073-decided-against-pilot-and-paid-run-results-and-say-whether-the-list-joins-the-scout-proposal.md

- Task: 074-record-the-073-decided-against-pilot-and-paid-run-results-and-say-whether-the-list-joins-the-scout-proposal.md
- Written: 2026-11-07T00:33:17.447Z
- From session: haiku-subagents-with-graph-074

Outcome: 074 done. docs/evals.md Ticket 073 section now has a Results (ticket 074) block. Docs only; no paid run, no bench, grader or list change, nothing in maestro changed, docs/report.md left untracked.

Verification: base commit 00c1949 (the docs/evals.md edit is uncommitted, awaiting the user's commit approval). Full suite pnpm test green on it: 718 pass, 0 fail, 5 of 5 turbo tasks.

Verdict (pre-registered rule, first match wins): cuts repeats but loses recall. Repeats 47 to 9 (81% cut, step 3 passes). Decided expected found 19 of control 26 = 73% (under 90%, step 4 fires). Step 5 not reached (would not fire: new findings 68 vs 50).

Cost: paid 0.760 of 1.50, pilot 0.123, study total 0.883 of 2. Control 0.370, decided 0.393 over 30 sessions each. Estimate miss vs pilot +3.0% in total (arms off -13% and +24%).

Confidence: moderate overall; high on the repeat cut, low-to-moderate on recall size.

Recommendation: the decided-against list does NOT join the workflow proposal. The proposal stays as 071 recommended (plain scout, haiku-metrics-primer, advisory list). No further paid run on this design without an amended list or recall bar and its own pre-registration.

Findings: the report's decided new-findings total is 68 but its per-cell column sums to 70; noted in the doc, no verdict change. Post hoc readings are labelled in the doc.

Post-mortem: none, clean session.
