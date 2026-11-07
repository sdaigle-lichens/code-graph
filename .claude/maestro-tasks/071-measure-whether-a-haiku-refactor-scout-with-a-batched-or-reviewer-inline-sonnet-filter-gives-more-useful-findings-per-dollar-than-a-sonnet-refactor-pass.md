# Measure whether a Haiku refactor scout with a batched or reviewer-inline Sonnet filter gives more useful findings per dollar than a Sonnet refactor pass

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Follows ticket 070 (read its results and amendment in the evals doc first). The user wants a cheap Haiku refactor scout on every task. In 070 the pipeline missed the required saving by one point (-19% against 20%, about +6% without one case) because the separate Sonnet filter session is most of its cost ($0.112 per run against $0.015 for Haiku alone and $0.139 for plain Sonnet). The audit also showed the false-finding figure mostly counts real, unplanted improvements (68 of 79 confirmed), so it was the wrong headline, and recall was inconclusive in every category because the baseline missed too little. This ticket tests the cheaper forms of the idea with a better metric, harder cases and more runs.

Direction, not to be reopened without the user: extend the 070 refactor bench rather than building a new one. The headline is useful findings per dollar. A useful finding is an expected improvement or a proposal confirmed by a fixed blind audit (arm labels stripped, grep of the pinned tree), with unconfirmed proposals reported as noise. Fix the audit procedure before any paid run and make it scriptable where possible, so it is not a hand judgement after the fact. Report the old kept-improvement and false-finding figures beside it for comparison with 070.

Arms: sonnet-plain (baseline); haiku-metrics-primer (the scout alone, its list going unfiltered to a backlog); haiku-batched-filter (one Haiku scout per case, then one Sonnet session filtering the combined backlog of several cases into file-it or drop-it, its cost shared across those cases, and the batch size pre-registered); haiku-reviewer-inline (the scout's list handed to a normal Sonnet review of the same change, which marks each suggestion file-it or drop-it as part of that review, never in the merge verdict, and costed as the extra spend over the same review without the list; report whether the list changes the review's own verdict). The Sonnet-spawns-Haiku arm stays out.

Cases: harder cases where the baseline can plausibly miss (at least 3 misses per category is what a recall verdict needs), keeping clean neighbourhoods, reverted real refactors naming their source commit, and seeded problems. Pilot the baseline first and apply the existing stop rule. Use the pilot's real cost per session to set runs per cell before the paid run, so cells are not cut after the caps are set as happened in 070.

The user's total cap is $10 for this ticket, pilot included, and the per-session caps are set with the user in the session. Pre-register in the evals doc (its own section): cases and sources, arms, runs per cell, the metric, the audit, a 051-style decision rule per category with overall never overriding a category, the stop rule and the caps, in a commit named as the measured commit. Hand the user the $0 preflight, pilot and paid-run commands for a plain terminal, then record the results, a confidence level and a recommendation: which form, if any, should join the workflow.

Keep grader work small: do not harden the parser against imagined wording. After the first working grader, change it only for a bug that real pilot or paid output shows changes a result. Bench code, bench tests, the bench README and the evals doc only; no change to the code-graph package or plugin bundle unless a metric needs it (then pnpm build, which regenerates the bundle). Any change in the maestro repo, such as adding the agent or the step to the workflow, is its own ticket there.

## Acceptance criteria

- [ ] Arms sonnet-plain, haiku-metrics-primer, haiku-batched-filter and haiku-reviewer-inline run on the harder case set; shared filter cost is split across its cases and the inline arm is costed as extra spend over the same review without the list
- [ ] Useful findings per dollar is the headline, built from expected improvements plus a blind audit fixed before any paid run; unconfirmed proposals are reported as noise and the 070 figures are shown beside it
- [ ] Graders are unit-tested against known-good and known-bad output; refactor-prep --check, the dry run and node --test bench/*.test.mjs are green
- [ ] docs/evals.md pre-registers cases, arms, runs per cell, metric, audit, decision rule, stop rule and the user's caps (total $10 including the pilot) in a commit with pnpm verify green, named as the measured commit
- [ ] After the user's paid run, docs/evals.md records the results, verdicts, a confidence level and a recommendation on which form, if any, joins the workflow
- [ ] No paid run is started by the agent; nothing in the maestro repo changes

## Touched surfaces

- bench/refactor*.mjs, bench/refactor*.test.mjs, bench/refactor/ (generated)
- bench/README.md
- docs/evals.md (shared doc, new section)

## Blocked by

- `070-measure-whether-a-cheap-haiku-refactor-scout-filtered-by-a-sonnet-reviewer-finds-code-structure-improvements-as-well-as-a-sonnet-refactor-pass-at-lower-cost.md`
