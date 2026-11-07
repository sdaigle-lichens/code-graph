Round 2

## Goal
Harden the 066 reviewer bench after pilot A saturated; drop sonnet-spawns-haiku from the planned arms, promote haiku-nograph, 3 runs per cell.

## Round 1 redirect, point by point
- "Needs a commit and a green full suite": committed as 550ca20 (bench, regenerated diffs and primers, README, evals amendment). `pnpm verify` ran green on that tree (14 of 14 tasks, exit 0); a second `pnpm verify` was green after the sha line was added. Full bench glob: 145 pass, 0 fail.
- "Ask the user to decide the caps": asked in this session; the user chose $13 total (pilot included), $1.10 pilot, $0.40 per run, 3 runs per cell. Your verdict was not treated as approval.
- "Write the dated amendment in docs/evals.md Ticket 066": done, dated 2026-11-05, holding the pilot A figures (sonnet-nograph 4/4, 2/2 local, 2/2 cross, no false alarm, results dir review-2026-11-05T16-16-04-363Z, $0.335), the stop rule outcome (fired for both categories), the hardened cases with their bug-kind sources, the dropped arm, 3 runs per cell and the caps. Decision rule and stop rule text unchanged.
- "Commit with the user's approval": the user approved writing and committing in this session.
- "Name the commit the paid run is measured against": 550ca20, named in the amendment; 71d401b only records that sha.
- "State the pilot A sample": r-l1-resumable-clear, r-l4-id-min-length (local), r-x1-list-skips-worktree, r-x4-liveness-state-file (cross), r-c6-drop-exists-guard (clean), in the amendment.

## Done
As in round 1, plus the amendment and the commits above.

## Deviations
A first sha commit swept in unrelated modified files by mistake; it was local and unpushed, so it was undone and recommitted with only docs/evals.md (71d401b). No unrelated file was committed.

## Decisions
Caps and the pilot sample as above. No paid run is started; the user gets the preflight and pilot A commands.

## Touches
bench/review*.mjs, bench/review*.test.mjs, bench/review/, bench/README.md, docs/evals.md.

## Sibling impact
Ticket 067 stays blocked until the paid run exists.

## Verified
Commit 550ca20: `pnpm verify` green (14/14, exit 0); `node --test bench/*.test.mjs` 145 pass; `review-prep --check` and `review-run --dry` green.

## Questions
None.
