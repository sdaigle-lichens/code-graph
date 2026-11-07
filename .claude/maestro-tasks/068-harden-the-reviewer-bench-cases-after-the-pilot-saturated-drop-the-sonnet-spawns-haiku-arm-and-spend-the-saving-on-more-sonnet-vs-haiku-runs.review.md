## Goal
Harden the 066 reviewer bench after pilot A saturated (sonnet-nograph 4/4, no false alarm): cross-file bugs that break only outside the diff, subtler local bugs, clean diffs kept. Drop sonnet-spawns-haiku from the planned arms, promote haiku-nograph, raise runs per cell to 3.

## Done
- 15 cases (5 local, 5 cross-file, 5 clean); stored diffs and primers regenerated (30 files; 22 files of 11 obsolete ids deleted).
- Each case carries a `review.source` naming where its bug kind comes from (maestro history: 077/bf86ba8 resumable reasons, 074 worktree pointers, 084 optional claim session_name, twin-parity fixes 809e023/161b91c, 064 session-id validation, the 066 liveness rule, a733966 ordering).
- Cross-file cases break only outside the diff (e.g. r-x1 breaks liveRunIds/pendingLanes/sweep/session-log, none in the diff; r-x5 deleteTask loses its mainCheckoutRoot mapping).
- Planned arms: sonnet-nograph, sonnet-diff-primer, haiku-diff-primer, haiku-nograph. sonnet-spawns-haiku code and spawn-validity check kept, selectable via --arms, tests pass.
- Default runs per cell 3; default budget 13 (a proposal, not decided).
- Graders unit-tested against known-good and known-bad review text. Bench README review section updated.

## Deviations
- None from the ticket. docs/evals.md amendment and the commit are NOT done yet; they follow after the user decides the caps (scribe step).

## Decisions
- Proposed caps for the user: per run $0.40 (unchanged), pilot $1.10 (5 sonnet-nograph runs), spend $13 including pilot (expected about $10.7 for 15 cases x 4 arms x 3 runs).
- Run number is the outermost loop, so if the cap binds, passes 1 and 2 (about $7.1) still complete.

## Touches
bench/review-cases.mjs, bench/review.mjs, bench/review-run.mjs, bench/review.test.mjs, bench/review-cli.test.mjs, bench/README.md, bench/review/ (diffs and primers). No change to packages/code-graph or the plugin bundle. Nothing in the maestro repo.

## Sibling impact
Ticket 067 (record results, recommend a setup) stays blocked on the paid run, which uses these cases and arms.

## Verified
Uncommitted working tree on top of 9aa30b7. `node bench/review-prep.mjs --check` (30 files unchanged), `node bench/review-run.mjs --dry --runs 1` (60 runs), `node --test bench/*.test.mjs` 145 pass, 0 fail. `pnpm verify` has NOT been run on a commit yet; it runs at the commit after the evals amendment.

## Questions
None for direction.
