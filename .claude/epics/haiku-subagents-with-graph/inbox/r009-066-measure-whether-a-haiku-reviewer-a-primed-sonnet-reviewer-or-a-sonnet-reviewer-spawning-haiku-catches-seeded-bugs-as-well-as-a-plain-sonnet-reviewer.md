# Report r009: 066-measure-whether-a-haiku-reviewer-a-primed-sonnet-reviewer-or-a-sonnet-reviewer-spawning-haiku-catches-seeded-bugs-as-well-as-a-plain-sonnet-reviewer.md

- Task: 066-measure-whether-a-haiku-reviewer-a-primed-sonnet-reviewer-or-a-sonnet-reviewer-spawning-haiku-catches-seeded-bugs-as-well-as-a-plain-sonnet-reviewer.md
- Written: 2026-11-05T15:55:29.822Z
- From session: haiku-subagents-with-graph-066

Outcome: bench review mode built, tested, reviewed and pre-registered. Acceptance criteria 5 and 6 (preflight, pilot, paid run, results and recommendation) are OPEN on purpose: they are user-run from a plain terminal (claude is not on PATH in the agent sandbox).

Verified: commit 9aa30b7 (the pre-registration commit the paid run is measured against; earlier 0447717 and 1064e82). `pnpm verify` from the root on it: exit 0, 14/14 tasks, code-graph tests 718 pass, 0 fail. node --test bench/*.test.mjs: 141 pass, 0 fail, 0 todo. No change to packages/ or plugin/, so no rebuild. Maestro repo untouched by this work (reviewer saw 3 unrelated pre-existing changes there from before the first bench commit; user to confirm).

Built: 15 cases (5 local, 5 cross-file, 5 clean) with graders; deterministic $0 primer (bench/review/, checked by review-prep --check); arms sonnet-nograph, sonnet-diff-primer, haiku-diff-primer, sonnet-spawns-haiku, optional haiku-nograph; spawn runs invalid unless a Haiku subagent shows in the transcript; paired-cell tally; stop rule; cap $10, pilot $1.50 split in two parts, per-run $0.40, 2 runs per cell (user's choice; the second pass may hit the cap).

Findings: manager redirect m007 (commit + suite, saturation guard) fixed. @test found 4 defects (spawn validity too lax, grader cross-credit and absent-defect credit, silent --dry on broken checkout, doc/code mismatch on partial passes), all fixed. @reviewer warnings (pilot budget, unimplemented rule bullet, x5 grader leak) fixed.

Post-mortem notes: the first @backend pass and its first test verification left several defects and a mid-task rework of pre-registration text; three manager rounds were needed (one redirect).

Suggested ticket changes: the paid run needs a follow-up ticket for results and the reviewer recommendation once the user has run preflight, pilot (check the r-x3 transcript shows subagent messages in stream-json; the spawn check fallback is unverified without it) and paid run. A graph skill gap (no output-format docs for query file/impact/cross) was left for a later scribe run.
