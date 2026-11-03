# Report r004: 053-default-the-bench-s-maestro-path-to-one-that-exists-on-this-machine.md

- Task: 053-default-the-bench-s-maestro-path-to-one-that-exists-on-this-machine.md
- Written: 2026-10-30T02:06:06.071Z
- From session: haiku-subagents-with-graph-053

## Outcome
Ticket 053 done and reviewed in worktree /Users/samueldaigle/Documents/gits/code-graph-task-053 (branch task-053). Nothing committed or merged; that stays with the user.

## What landed
- New `bench/maestro-dir.mjs`: explicit MAESTRO_DIR wins; else first git checkout among ~/Documents/gits/maestro, ~/gits/maestro; else one line naming MAESTRO_DIR. `maestroFor(setup)` resolves lazily, only when a setup contains `{MAESTRO}`.
- `bench/run.mjs`, `bench/edit-check.mjs`, `bench/capture-oracle.mjs` use it; none hard-codes a path.
- `bench/maestro-dir.test.mjs` (6 tests); 94 tests pass across maestro-dir and lib tests.
- `bench/README.md`: how the path is found, the `--dry` condition, and the Node 25 test command.

## Findings
- `node --test bench/` errors on Node 25; the ticket criterion is met via `node --test bench/*.test.mjs`.
- `run.mjs` runs setup before the dry exit, so `--dry` needs a checkout only when a selected case uses `{MAESTRO}`.
- `docs/evals.md:656` still records the old default as 044 history; left as is.

## Post-mortem notes
Two reviewer FAIL loop-backs (eager lookup; README garble and overstated `--dry`), @backend omitted the handoff payload twice in the worktree run, and the `node --test bench/` criterion fails on Node 25.

## Suggested ticket changes
- Merge overlap with 051 in `bench/run.mjs` and `bench/README.md`: whichever lands second rebases. Reviewer noted `bench/README.md` appears as a new file against `main` in the worktree diff, so 051's README edits may need a manual merge.
- Consider changing future bench-test criteria from `node --test bench/` to `node --test bench/*.test.mjs`.
