# Report r008: 052-primer-from-the-task-text-at-haiku-subagent-start.md

- Task: 052-primer-from-the-task-text-at-haiku-subagent-start.md
- Written: 2026-11-01T01:05:12.079Z
- From session: maestro-733e9d42

## Outcome

Ticket 052 closed without building anything. Its gate (build the primer only if `haiku-oracle` beats `haiku-nograph` on edit tasks) failed: the 051 paid run shows no gain.

## Evidence (051 paid run, 4 runs per cell, Sonnet not run)

- Overall: oracle 100 vs nograph 100 of 120, about 11% dearer per run.
- Scribe: oracle 79 vs nograph 80 of 96.
- Test (t3 alone): oracle 21 vs nograph 20 of 24.

## Done

`docs/evals.md` gained a section "Ticket 052: primer ... (not built)" with the gate, the numbers, the reopen condition and the confidence (low to moderate). No primer, no `haiku-primer` arm, no plugin, bundle or version change.

## Verified

Docs-only change, uncommitted in the working tree (no commit was made). No code changed, so no build, `just eval` or `pnpm check` was run. I cannot claim a commit verified or a green full suite on it.

## Findings and suggested ticket changes

- Reopen only if a future measurement shows graph answers beating nograph on edit tasks, e.g. harder tasks or a graph that reaches the stale docs outside concept globs.
- Suggest the manager treat the primer track as closed for now.
