# Report r006: 051-measure-concept-skills-and-graph-answers-on-harder-haiku-edit-tasks.md

- Task: 051-measure-concept-skills-and-graph-answers-on-harder-haiku-edit-tasks.md
- Written: 2026-10-30T17:07:11.236Z
- From session: haiku-subagents-with-graph-051

Outcome: ticket 051 is complete. The paid run is done, results and verdicts are in docs/evals.md "Ticket 051 -> Results (paid run)", committed as bdfb1d2 (bench side 72d2e18), on feat/integrate-concept-skills, nothing pushed.

Paid run: d2, t3, d3, d4; haiku-nograph, haiku-noskills, haiku-oracle; 4 runs per cell; 48 runs, all valid; $0.614 (pilot $0.818; $1.43 of the $8 cap). t4 dropped (saturated in the pilot); Sonnet dropped from the paid run (reasons in the doc).

Points (nograph / noskills / oracle): test (t3, max 24) 20 / 22 / 21; scribe (max 96) 80 / 22 (confounded) / 79; overall (max 120) 100 / 44 / 100.

Verdicts:
1. Skills help: not shown, not refuted. The only clean group (test) is inconclusive (saturated: noskills misses 2 of 24, under the floor of 3); nograph was 2 points lower and ~25% costlier. Scribe is confounded: the strip deletes the concept SKILL.md files the scribe tasks edit. Confidence low. A fair scribe-side skills test needs a strip that keeps those files on disk but hides them as loadable skills (candidate ticket).
2. Graph answers help: no gain measured. Oracle tied nograph overall (100 vs 100); per task d2 -2, t3 +1, d3 -1, d4 +2; ~11% costlier per run. DIRECTION FOR TICKET 052 (primer, gated on this): flat to slightly negative (test 21 vs 20, scribe 79 vs 80). The paid run gives no support for a primer on these tasks. Confidence: moderate that a large effect is absent, low for a small one.
3. Gap to Sonnet: no gap. Reference is the pilot (Haiku 33 vs Sonnet 31 of 36, n=1) and 044 (46 vs 44 of 52); Sonnet ~9x costlier per run. Low to moderate confidence (Sonnet n=1). No support for moving the test or scribe agent to Sonnet.

Hard case d2 (stale "up to 5 at once" in the maestro-manager SKILL.md frontmatter): fixed 0/5 nograph, 0/5 oracle, 0/1 Sonnet, 2/5 noskills across pilot and paid. Cause of the noskills difference unknown. herdr.md also missed in most runs of every arm.

Epic-level finding for the scribe side: docs outside every concept's globs (maestro-manager SKILL.md, tools-tasks-runtime.md, the log-view skill) never appear in graph output; search reaches concept SKILL.md files but not the stale lines inside them, and impact on a constant's reader does not reach docs. The scribe oracle is therefore thin by design and its null measures that limit.

What the set measures: mostly thoroughness in finding every mention of a changed fact. d3 saturates for nograph (36/36), t3 is near ceiling (83-92%); only d2 has headroom.

Other: I changed the 051 doc test in bench/lib.test.mjs so a Results heading is allowed but must come after the decision rule and the paid-run plan. Merge overlap with 053 (run.mjs, README.md, capture-oracle.mjs) still to reconcile with maestroFor: docs commands still set MAESTRO_DIR by hand and capture-oracle.mjs has the additive proxy_extra loop. The other modified files in git status (epic state, 053 files) are not mine and I did not stage them.

Post-mortem: no problems on the ticket beyond the one manager redirect already recorded (rule ceiling, per-group verdicts, oracle depth).
