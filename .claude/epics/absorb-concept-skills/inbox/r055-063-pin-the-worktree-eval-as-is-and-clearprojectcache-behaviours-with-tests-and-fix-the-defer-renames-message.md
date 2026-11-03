# Report r055: 063-pin-the-worktree-eval-as-is-and-clearprojectcache-behaviours-with-tests-and-fix-the-defer-renames-message.md

- Task: 063-pin-the-worktree-eval-as-is-and-clearprojectcache-behaviours-with-tests-and-fix-the-defer-renames-message.md
- Written: 2026-11-02T17:07:58.327Z
- From session: absorb-concept-skills-063

## Outcome
Ticket 063 is done in worktree /home/superadmin/gits/code-graph-task-063 (branch task-063), UNCOMMITTED and UNMERGED. No commit hash exists yet.

## Verified
Not verified on a commit. On the uncommitted worktree: pnpm check green, code-graph package tests 712/712, root pnpm test 5/5 on re-run (first run failed only the desktop graph-canvas tests for lack of a gitignored graph.db in the fresh worktree), just eval 7/7. Reviewer re-ran only pnpm check (cached) and the package tests. The full suite must be re-run after rebase on e349289 (0.3.39) with version 0.3.40 and a regenerated bundle; I will do that at merge.

## Done
- apply --defer-renames message: "the store was not written." plus "The enriched file was updated (K orphaned entry/entries remapped in ...)" when a remap persisted; exit 10 and --json unchanged; `Deferred: N rename` prefix kept.
- Tests: orphans.test.ts, skill-refresh.test.ts, concept-batch.test.ts, eval-cli.test.ts (as-is exits 1, default 0), extract-cache.test.ts (clearProjectCache), worktree-root.test.ts (real git worktree, --root and CLAUDE_PROJECT_DIR). Mutation-checked.
- exit-codes.ts comment fixed. docs/usage.md (two places) and scribe-pipeline SKILL.md sentence updated.

## For the manager
- scribe-pipeline SKILL.md was NOT stamped, and extract + apply scribe-pipeline were not run (scribe rule requires them after a SKILL.md edit); yours to do.
- CHANGELOG not updated.
- Eval-regression fixture depends on NAME_HIT_FACTOR ranking.
- pnpm-lock.yaml left out.

## Post-mortem
Clean session, none.
