# Build a reviewer case set from reverted real maestro bug fixes in realistic-size diffs to test whether a diff primer helps a reviewer

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

DROPPED, not built (user, 2026-11-06): do not start. The reviewer stays on Sonnet; the text below is kept as a record. The reviewer stays on Sonnet (user, 2026-11-05, after 067): this ticket only asks whether a primer or Haiku delegation helps a Sonnet reviewer.

Two user-run pilot A screens of the review bench (066, 068) saturated: sonnet-nograph found every sampled seeded bug, so the bench cannot show whether a diff primer (impact, cross-concept relations, untested callers from the code-graph CLI) helps a reviewer. The seeded diffs were small, held one bug each, and were written by the same model family that reviews them.

Build a new review case set where the bug is one that actually got past review in maestro once: pick fix commits from maestro's history (fixes of cross-file breakage and of local logic), revert each fix onto a realistic-size diff that also carries several legitimate changes (or 2 bugs in some diffs), so the reviewer has to find a real defect among real noise. Each case names the fix commit it comes from. Keep clean diffs of realistic size (correct refactors) so false alarms stay measurable. Graders follow the existing review graders (finding must name the right file and the defect; unit-tested on known-good and known-bad review text). Regenerate stored diffs and primers; offline checks green.

Pre-register before any paid run in the evals doc (its own ticket section): the case set and sources, arms (sonnet-nograph, sonnet-diff-primer and sonnet-spawns-haiku, whose existing spawn-validity check applies; on realistic-size diffs Sonnet's exploration cost is where Haiku delegation could pay, so report its cost per run beside the baseline), runs per cell, the 051-style decision rule and the existing stop rule, and caps the user sets in the session. Hand the user the $0 preflight and pilot A commands; the stop rule applies to that pilot before any paid run. Bench code, bench tests, the bench README and the evals doc only; no change to the code-graph package or plugin bundle unless unavoidable (then pnpm build, which regenerates the bundle). Nothing in the maestro repo changes.

## Acceptance criteria

- [ ] Every bug case reverts a named maestro fix commit inside a realistic-size diff with legitimate changes; realistic-size clean diffs are included
- [ ] Graders are unit-tested against known-good and known-bad review text; review-prep --check, review-run --dry and node --test bench/*.test.mjs are green
- [ ] docs/evals.md pre-registers the set, arms, runs per cell, decision rule, stop rule and the user's caps in a commit with pnpm verify green, named as the measured commit
- [ ] The user has the preflight and pilot A commands; no paid run is started by the agent; nothing in the maestro repo changes

## Touched surfaces

- bench/review*.mjs, bench/review*.test.mjs, bench/review/ (generated)
- bench/README.md (review section)
- docs/evals.md (shared doc, new section)
- shares the bench runner and docs/evals.md with 070: blocked by 070, starts from the merged main

## Blocked by

- `067-record-the-reviewer-bench-pilot-and-paid-run-results-and-recommend-a-reviewer-setup.md`
- `070-measure-whether-a-cheap-haiku-refactor-scout-filtered-by-a-sonnet-reviewer-finds-code-structure-improvements-as-well-as-a-sonnet-refactor-pass-at-lower-cost.md`
