# Report r015: 072-record-the-071-refactor-scout-pilot-and-paid-run-results-and-recommend-which-form-joins-the-workflow.md

- Task: 072-record-the-071-refactor-scout-pilot-and-paid-run-results-and-recommend-which-form-joins-the-workflow.md
- Written: 2026-11-06T21:02:27.213Z
- From session: haiku-subagents-with-graph-072

# Report: ticket 072

Outcome: done. The Ticket 071 Results section of docs/evals.md is written. The pre-registered audit was run with --pool, then hand verdicts, then --score. The verdicts are in audit-verdicts.txt in the gitignored paid-run folder (22 confirmed, 0 unconfirmed).

Verified: docs-only change, nothing committed. No commit was verified and the full test suite was NOT run, because no code changed. This report is therefore incomplete on those two points.

Findings (paid run, 12 cells per arm, useful per dollar):
- baseline 17.1 (noise 0%)
- haiku-metrics-primer 286 (noise 2%): better per dollar
- haiku-reviewer-inline 33.1: no gain shown
- haiku-batched-filter 24.3 (noise 5%): no gain shown

Per-category recall verdicts are all inconclusive (pilot baseline misses: dedupe 2, extract 1, align 2). The baseline cost ran 27% above the pilot estimate. Confidence is low to moderate. Recommendation: the scout alone may join the workflow as an advisory list, and neither filter joins. The 070 figures are recorded beside these. Post hoc readings are labelled and change no verdict.

Caveat: the audit confirms any true claim, so noise is near zero for every arm.

Process: the scribe ended without a HANDOFF line, and I routed it as success. No paid run was started. Nothing in the maestro repo changed. docs/report.md is untracked and was not committed.

Suggested ticket changes: a maestro-repo ticket to add the scout to the workflow, if wanted.
