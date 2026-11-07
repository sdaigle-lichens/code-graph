Round 2

Previous redirect (m007): (1) commit and green full suite, (2) saturation guard.

## Goal
Bench review mode comparing sonnet-nograph, sonnet-diff-primer, haiku-diff-primer, sonnet-spawns-haiku (and haiku-nograph) on seeded-bug diffs, with a pre-registered decision rule.

## Done
- Point 2a (why the baseline should miss >= 3 per category): docs/evals.md Ticket 066 has a per-category "Saturation guard" (5 bugs x 2 runs = 10 planted per category, 3 misses = 30%), stated as a prior. Cases hardened/added: now 5 local, 5 cross-file (including a caller two hops away and untested callers), 5 clean.
- Point 2b (stop rule): "Stop rule before the paid run" in the same section: if the pilot baseline misses, extrapolated, are under 3 in a category, harden or add cases and re-pilot before spending on the paid run.
- Point 2c (false alarms): 5 clean diffs; the figure rests on valid runs x 5 clean diffs (2 x 5 = 10 reviews per arm), the count printed beside the number.
- Point 1 (commit + green suite): done. Commit 0447717, full suite green on it (see Verified).

## Deviations
- Preflight, pilot and paid run stay user-run (claude not on PATH in the sandbox); criteria 5 and 6 remain open.
- Cap now $10 total, pilot $1.50, per-run $0.40, 2 runs per cell, set by the user. Full paid pass is about $11, so the second pass may hit the cap; the pilot is split in two parts to fit $1.50.

## Decisions
- Primer stays in bench/; no change to the code-graph package or plugin bundle.
- Arms with unequal valid runs are not compared.

## Touches
bench/review.mjs, review-cases.mjs, review-prep.mjs, review-run.mjs, review.test.mjs, bench/review/ (15 diffs, 15 primers), bench/README.md, docs/evals.md. Nothing in the maestro repo.

## Sibling impact
None; bench and one shared doc section.

## Verified
Commit 0447717 (the pre-registration commit, made with the user's approval). `pnpm verify` from the root on it: 14/14 tasks successful, code-graph tests 718 pass, 0 fail. `node --test bench/*.test.mjs`: 126 pass. Preflight, pilot and paid run remain open (user-run).

## Questions
- The user chose to keep the $10 cap and 2 runs per cell, knowing the second pass may stop at the cap.
