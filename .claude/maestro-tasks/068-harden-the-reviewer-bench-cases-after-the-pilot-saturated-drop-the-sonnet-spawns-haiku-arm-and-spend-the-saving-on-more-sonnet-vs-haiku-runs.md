# Harden the reviewer bench cases after the pilot saturated, drop the sonnet-spawns-haiku arm and spend the saving on more Sonnet vs Haiku runs

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

User-run pilot A of the 066 review bench (results bench/results/review-2026-11-05T16-16-04-363Z, $0.335) had sonnet-nograph find 4 of 4 sampled bugs (2 of 2 local, 2 of 2 cross-file) and raise no false alarm on the clean diff, mostly in 2 turns at about $0.07 per run. The pre-registered stop rule in the evals doc (Ticket 066) fired for both categories: no paid run on these cases. The user chose to harden the cases (2026-11-05).

Harden the seeded-bug cases so the baseline has room to miss: cross-file bugs whose breakage shows only outside the diff (a caller two hops away, a caller with no test reaching it, a contract stated in another concept or file the diff does not touch), and subtler local bugs (a boundary condition, an ordering or async mistake, a wrong default) rather than ones visible on the changed line. Prefer bug kinds maestro has actually had (its git history and fixes) over bugs built only to defeat Sonnet; say for each new or changed case where its kind comes from. Keep the clean diffs (add plausible-looking but correct refactors if needed so false alarms stay measurable). Regenerate the stored diffs and primers, keep the graders unit-tested against a known-good and known-bad review text, and keep the offline checks green.

Arms, by the user's decision: drop sonnet-spawns-haiku for now (keep its code and spawn-validity check, just leave it out of the planned arms). Planned arms: sonnet-nograph (baseline), sonnet-diff-primer, haiku-diff-primer, and haiku-nograph promoted from optional to planned, so the Sonnet vs Haiku comparison is made with and without the primer. Spend what the dropped arm saved on more runs per cell (at least 3 if the budget allows) to sharpen Sonnet vs Haiku.

Record all of this in the evals doc Ticket 066 section as a dated post-pilot amendment with its reasons (pilot A numbers, stop rule fired, cases hardened, arm dropped, runs per cell changed), keeping the decision rule itself (051 style, per category, overall never overriding a category, false alarms and cost beside each verdict) and the stop rule unchanged. Propose a new spend cap, pilot cap and per-run cap from the 051 and pilot A per-run costs; the user said the budget may go up a little and decides the numbers in the session. Update the bench README review section. Then hand the user the commands for a new $0 preflight and a new pilot A (sonnet-nograph on the sampled hardened cases); the stop rule is applied again to that pilot before any paid run. Bench code, bench tests, the bench README and the evals doc only; no change to the code-graph package or plugin bundle unless unavoidable (then pnpm build, which regenerates the bundle). Nothing in the maestro repo changes.

## Acceptance criteria

- [ ] Cross-file cases break only outside the diff and local cases are subtler; each new or changed case states where its bug kind comes from
- [ ] Stored diffs and primers are regenerated; node bench/review-prep.mjs --check, node bench/review-run.mjs --dry and node --test bench/*.test.mjs are green, with graders tested against known-good and known-bad review text
- [ ] Planned arms are sonnet-nograph, sonnet-diff-primer, haiku-diff-primer and haiku-nograph; sonnet-spawns-haiku is left out of the plan but its code and validity check still pass their tests
- [ ] docs/evals.md Ticket 066 holds a dated post-pilot amendment with the pilot A numbers, the stop rule outcome, the hardened cases, the dropped arm, the runs per cell and the cap the user approved; the decision rule and stop rule text are unchanged
- [ ] The amendment is committed with pnpm verify green on that commit, and the commit sha is named as the one the paid run is measured against
- [ ] The user has the commands for a new $0 preflight and new pilot A; no paid run is started by the agent

## Touched surfaces

- bench/review*.mjs, bench/review*.test.mjs, bench/review/ (regenerated diffs and primers)
- bench/README.md (review section)
- docs/evals.md (shared doc, Ticket 066 section)

## Blocked by

- `066-measure-whether-a-haiku-reviewer-a-primed-sonnet-reviewer-or-a-sonnet-reviewer-spawning-haiku-catches-seeded-bugs-as-well-as-a-plain-sonnet-reviewer.md`
