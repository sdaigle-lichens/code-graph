# Report r042: 043-measure-whether-graph-context-lets-haiku-match-opus.md

- Task: 043-measure-whether-graph-context-lets-haiku-match-opus.md
- Written: 2026-10-28T14:55:09.086Z
- From session: absorb-concept-skills-043

# Report: ticket 043 (Haiku vs Opus with graph context)

Outcome: done. Clean session, no loop-backs.

## What landed
- bench/lib.mjs: a non-zero exit from a read-only grep/egrep/fgrep/rg/sed/cat/head/tail/ls/find (alone or chained) is recorded in readOnlyFailures and no longer invalidates a run. Seccomp, code-graph exits outside 0/4/6/7 and any other failing command still invalidate. Unit tests cover both sides; bench/lib.test.mjs is 60/60 and pnpm check is green.
- bench/cases.json: m1-m7 tagged with set "043" (m2 and m4 are ["042","043"]); no question or grader changed.
- docs/evals.md "Ticket 043": decision rule written before the paid run, run commands, then the results and verdict.

## Paid run (user-run, Haiku 5.5, 42 runs, $0.335 of $4)
All 42 runs valid, no 429s, check PASS.
- Pass: nograph 91/108, oracle 108/108, graph 107/108.
- Cost per run: nograph $0.0092, oracle $0.0066, graph $0.0081.
- Graph context helps Haiku: oracle is 17 must hits above nograph and never below it in any run pair.
- It matters: holds as written (oracle 100% against Opus 94%, about 3% of Opus cost per question). Caveats stated in the doc: not a paired comparison, most of the cost gap is model price, and Opus is near ceiling.
- The graph arm loaded code-graph-retrieval and called the CLI in all 14 runs, unlike Opus. It cost 24% more than oracle (+62% on cross questions, because of 10-15k-char CLI output).
- Confidence is low to moderate at n=2, with the selection-bias note.

## Findings and suggested ticket changes
- The primer follow-up is the user's call (not built here). If pursued, cross questions m4/m5 are where graph output size costs the most.
- isReadOnly is token-based: sed w/e commands and rg --pre count as read-only. Documented in bench/README.md; the only effect is a failing one is tolerated.
- The Opus reference comes from the sums in the 039/041 sections of docs/evals.md; the 039 result dirs only have report.md, so it was not recomputed from raw runs.
- stash@{0} is a stray duplicate from the backend agent's baseline check; drop it if unwanted.
