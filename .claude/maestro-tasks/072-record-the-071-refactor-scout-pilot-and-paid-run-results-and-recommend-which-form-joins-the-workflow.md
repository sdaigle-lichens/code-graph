# Record the 071 refactor scout pilot and paid-run results and recommend which form joins the workflow

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Released (user, 2026-11-06): the 071 paid run is done. Result folders (gitignored): pilot `bench/results/refactor-2026-11-06T20-21-18-673Z` ($0.812, 6/6 valid, mean $0.135 per session, r = 2), paid run `bench/results/refactor-2026-11-06T20-32-24-067Z` ($4.713 of $7, 48/48 valid). The full paid-run log is the untracked `docs/report.md`: read it, do not commit it. This ticket also makes the audit's hand verdicts: run `--pool`, write `audit-verdicts.txt` in the paid run's folder as the pre-registration says, then run `--score`.

Ticket 071 built and pre-registered the bench (measured commit c850a00, named in f142006), but its results criterion could only be met after the user's own run. This ticket does that step and nothing else. Take the pilot and paid-run outputs and result files the user names, run the fixed blind audit as pre-registered, and record in the Ticket 071 section of the evals doc: useful findings per dollar and noise per arm, the 070 figures beside them, the verdicts from the pre-registered decision rule, which categories had fewer than 3 baseline misses (so their recall verdict is inconclusive), any cost-estimate miss against the pilot, a confidence level, and a recommendation on which form of the Haiku scout, if any, joins the workflow.

Apply the pre-registered rule as written: any reading beyond it is labelled as post hoc and never changes a verdict. Docs only, plus running the existing audit tool; no bench, grader or case changes unless a bug in the audit tool stops it running, and no new paid run. Any change in the maestro repo, such as adding the agent or the step to the workflow, is its own ticket there.

## Acceptance criteria

- [ ] docs/evals.md records useful findings per dollar, noise, the 070 comparison, verdicts, categories with fewer than 3 baseline misses, a confidence level and a recommendation
- [ ] The audit ran as pre-registered and the verdicts follow the pre-registered rule; any further reading is labelled post hoc
- [ ] No paid run is started by the agent; nothing in the maestro repo changes

## Touched surfaces

- docs/evals.md (Ticket 071 section)

## Blocked by

- `071-measure-whether-a-haiku-refactor-scout-with-a-batched-or-reviewer-inline-sonnet-filter-gives-more-useful-findings-per-dollar-than-a-sonnet-refactor-pass.md`
