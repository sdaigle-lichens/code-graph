# Report r010: 068-harden-the-reviewer-bench-cases-after-the-pilot-saturated-drop-the-sonnet-spawns-haiku-arm-and-spend-the-saving-on-more-sonnet-vs-haiku-runs.md

- Task: 068-harden-the-reviewer-bench-cases-after-the-pilot-saturated-drop-the-sonnet-spawns-haiku-arm-and-spend-the-saving-on-more-sonnet-vs-haiku-runs.md
- Written: 2026-11-05T17:31:01.120Z
- From session: haiku-subagents-with-graph-068

# Report: ticket 068 (harden the reviewer bench)

## Outcome
Done. 15 hardened cases (5 local, 5 cross-file, 5 clean) with a maestro-history source each; planned arms sonnet-nograph, sonnet-diff-primer, haiku-diff-primer, haiku-nograph (sonnet-spawns-haiku kept in code and tests, unplanned); 3 runs per cell. The user approved the caps: $13 total (pilot included), $1.10 pilot, $0.40 per run. docs/evals.md Ticket 066 holds the dated amendment; decision rule and stop rule text unchanged.

## Measured commit
The paid run is measured against **f214e33** (cases, graders including the path-token file match, arms). Not 550ca20: that commit added the amendment and cases, and f214e33 fixed a grader defect afterwards. Later commits (1a0b35f, a7eb910) are docs only. The full suite was green on it: `pnpm verify` 14 of 14 tasks, exit 0, and re-run green after the later doc commits; `node --test bench/*.test.mjs` 150 pass, 0 fail.

The uncommitted files that were already in the working tree before this task (.claude/epics, .claude/settings.json, .claude/maestro.json, pnpm-lock.yaml and the like) are untouched and not committed.

## Findings
- @test found a real grader defect: gradeReview matched the case file regex against the whole finding text, crediting wrong-file findings (inflating found counts). Fixed in f214e33 and recorded as a dated grader change in the amendment.
- r-x3 and r-x5 defects can be read off the changed line; their cross label rests on the twin script and on code outside the diff. Clean diffs are checked for count and category only.
- `--init-check` was not run by agents (it spawns the claude CLI). The user runs it.

## Post-mortem
- Round 1 manager redirect: the brief had no commit and no green suite, and the caps were not decided. Fixed by asking the user, writing the amendment and committing.
- My first sha commit used `git commit -am` and swept in unrelated modified files; undone locally (unpushed) and redone with only docs/evals.md.
- The backend agent could not run pnpm verify (Bash classifier fault); the orchestrator ran it.

## Suggested ticket changes
Ticket 067 stays blocked until the user runs the new preflight and pilot A, applies the stop rule, then runs the paid pass.

## Commands handed to the user
1. `node bench/review-run.mjs --init-check` ($0 preflight)
2. `node bench/review-run.mjs --runs 1 --budget 1.1 --run-budget 0.4 --arms sonnet-nograph --only r-l1,r-l4,r-x1,r-x4,r-c6` (new pilot A)
