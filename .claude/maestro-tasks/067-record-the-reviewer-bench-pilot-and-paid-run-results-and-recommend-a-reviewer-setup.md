# Record the reviewer bench pilot and paid-run results and recommend a reviewer setup

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Ticket 066 built and pre-registered the reviewer seeded-bug bench; 068 hardened the cases (measured commit f214e33). Both user-run pilot A screens saturated, so the stop rule fired twice:
- 066 pilot A (results review-2026-11-05T16-16-04-363Z, $0.335): sonnet-nograph 4/4 (2/2 local, 2/2 cross), 0 false alarms; that grader later turned out to credit wrong-file findings (fixed in f214e33).
- 068 pilot A (results review-2026-11-05T18-12-18-331Z, $0.467, user-run preflight passed): sonnet-nograph 4/4 (2/2 local, 2/2 cross) on r-l1, r-l4, r-x1, r-x4, 1 false alarm on r-c6, 6 extra findings, 3 to 8 turns, $0.093 per run.

The user chose (2026-11-05) to stop hardening and answer only whether a Haiku reviewer misses clearly more than Sonnet. With the baseline at the ceiling no arm can show it helps, but the rule's "hurts" line (an arm missing at least 3 more than the baseline in a category) still decides.

Part 1, before any paid run: write a dated post-pilot amendment into the evals doc Ticket 066 section, before any Haiku data exists. It records both pilot A results and the double stop-rule outcome. Planned arms become sonnet-nograph (baseline), haiku-nograph and haiku-diff-primer; sonnet-diff-primer is dropped (a primer cannot lift a baseline at the ceiling) and sonnet-spawns-haiku stays unplanned (code and tests kept). The "recovers" verdicts are declared inconclusive in advance. Only "hurts" or "no effect shown" per category and overall (overall never overriding a category) is decided, with false alarms and cost per run beside each verdict, as the committed rule says. Note that r-x3 and r-x5 can be read off the changed line, so the cross category is softer than intended. Keep 3 runs per cell and the user's caps ($13 total including both pilots, $0.40 per run). Estimate the cost from the pilot per-run figures (about $0.093 Sonnet, Haiku from 051) and the money left under the cap. Change the bench's default planned arms to match. Commit with the user's approval, run pnpm verify green on that commit, name it as the measured commit, and hand the user the paid-run command for a plain terminal. Then wait for the user to report the paid run.

Part 2, after the user's paid run: record per category (local logic, cross-file) and overall the bugs found, false alarms on clean diffs, cost per run and the paired-cell count (Counted N of M valid runs), then the verdict for each Haiku arm against sonnet-nograph under the amended rule (name the commit). State Haiku vs Sonnet with and without the primer, and the primer's effect on Haiku (haiku-diff-primer vs haiku-nograph, reported descriptively). Any further change is another dated amendment with its reason. End with a confidence level (small n: say so) and a recommendation for the reviewer agent: Sonnet plain, Haiku plain or Haiku plus primer. Sonnet plus primer and Sonnet spawning Haiku were not measured, so say so. Docs and bench result analysis only; a reviewer model or workflow change in the maestro repo is out of scope (its own ticket in that repo). Update the epic's background summary in the evals doc if it summarises the epic's findings.

## Acceptance criteria

- [ ] docs/evals.md holds a dated amendment, committed before the paid run, recording both pilot A results, the double stop-rule outcome, the arms sonnet-nograph / haiku-nograph / haiku-diff-primer, "recovers" declared inconclusive in advance, the softer r-x3/r-x5 note, and a cost estimate within the user's cap
- [ ] The bench's default planned arms match the amendment; pnpm verify is green on the amendment commit, which is named as the measured commit
- [ ] The user has the paid-run command; no paid run is started by the agent
- [ ] After the paid run, docs/evals.md records per-category and overall bugs found, false alarms, cost per run, the paired-cell count, hurts / no-effect verdicts for each Haiku arm under the amended rule, the primer's effect on Haiku, a confidence level, and a reviewer recommendation that names the unmeasured options
- [ ] node --test bench/*.test.mjs stays green; nothing in the maestro repo changes

## Touched surfaces

- docs/evals.md (shared doc, Ticket 066 section)
- bench/review-run.mjs or bench/review.mjs (default planned arms) and their tests
- bench/README.md (review section, arms)

## Blocked by

- `066-measure-whether-a-haiku-reviewer-a-primed-sonnet-reviewer-or-a-sonnet-reviewer-spawning-haiku-catches-seeded-bugs-as-well-as-a-plain-sonnet-reviewer.md`
- `068-harden-the-reviewer-bench-cases-after-the-pilot-saturated-drop-the-sonnet-spawns-haiku-arm-and-spend-the-saving-on-more-sonnet-vs-haiku-runs.md`
