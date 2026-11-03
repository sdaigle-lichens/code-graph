# Report r005: 051-measure-concept-skills-and-graph-answers-on-harder-haiku-edit-tasks.md

- Task: 051-measure-concept-skills-and-graph-answers-on-harder-haiku-edit-tasks.md
- Written: 2026-10-30T02:14:15.299Z
- From session: haiku-subagents-with-graph-051

Outcome: bench side of 051 is built and verified in worktree code-graph-task-051 (branch task-051, uncommitted, unmerged). No paid run yet. Acceptance criteria that need the user's pilot and paid run (non-saturation, init-check, results and verdicts) are pending by design.

Built: 051 set (d2 kept as hard case, t3, t4, d3, d4; 36 pts/run), arms haiku-noskills and haiku-oracle, oracles, reference solutions, tests, and a pre-registered decision rule on missed points (a third of the baseline's missed points, floor 3, inconclusive when baseline misses under 3), per group (test, scribe, overall). The user confirms numbers and cap at pilot time.

Verification: bench/lib.test.mjs 95 pass; edit-check 051 and 044 all graders behave; capture-oracle --check 12 unchanged. Not run (sandbox): --init-check, pnpm check (lockfile EPERM; check-versions and check-plugin-clean pass directly).

Findings:
- Epic-level, scribe side: docs outside every concept's globs (maestro-manager/SKILL.md, tools-tasks-runtime.md, the log-view skill) never appear in graph output. search reaches the matching concept SKILL.md but not the stale lines inside, and impact on a constant's reader does not reach the docs. The scribe-side verdict measures this limit; the oracle bounds what a primer could give.
- Reviewer warnings: cases.json rewrite via JSON.stringify added about 40 lines of diff noise (content unchanged; deduped repeated sets keys in m2 and m4); --init-check exits before promptProblems, so the oracle-context check runs on --dry and paid runs, not the preflight.

Merge overlap with 053: bench/run.mjs, bench/README.md, and bench/capture-oracle.mjs (additive proxy_extra loop plus search exit-7 acceptance). After 053 merges, reconcile docs/evals.md MAESTRO_DIR commands and the proxy_extra loop with maestroFor; whichever lands second rebases.

Post-mortem: clean on the ticket, one manager redirect (rule ceiling, per-group verdicts, oracle depth), no other problems.

Next for the user: preflight with --init-check, then the $2 pilot, then decide which tasks discriminate before the paid run (commands in docs/evals.md "Ticket 051").
