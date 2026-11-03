# Report r046: 045-refresh-the-graph-automatically-after-skill-md-edits.md

- Task: 045-refresh-the-graph-automatically-after-skill-md-edits.md
- Written: 2026-10-31T01:31:39.847Z
- From session: absorb-concept-skills-045

# 045: auto-refresh the graph after SKILL.md edits — report

## Outcome

All steps are done in worktree code-graph-task-045 (branch task-045). Nothing is committed or merged yet; that waits for the user's approval.

- `apply <c> --defer-renames`: non-interactive. If there are rename candidates it writes nothing and exits 10. Interactive apply is unchanged.
- `refresh-skills [--hook] [--json]`: extracts and applies each applied concept whose SKILL.md hash differs from its store doc row.
- `plugin/hooks/hooks.json`: runs the command on Stop and SubagentStop with a 120 s timeout. It reports through systemMessage and always exits 0.
- Measured runtime: 0.07 s with no change, and about 15 s to refresh 11 concepts on a copy of maestro.
- The version is now 0.3.30 and the bundle is regenerated.
- 25 new tests. The code-graph suite passes 540/540, build, check and typecheck pass, and eval is 7/7.
- Docs updated: the plugin scribe skill, docs/usage.md, development.md, the package CLAUDE.md (refresh-skills as the STORE_COMMANDS exception) and the scribe-pipeline skill.

## Findings

- Reviewer: every apply write sits in one transaction, so the timeout can't leave a half-applied store. If the hook is killed between extract and apply, the next stop retries the concept.
- Lock edge cases (not blocking):
  - taking over a stale lock is not atomic
  - the `finally` cleanup can delete a lock another run has since taken
  - a terminal run longer than 120 s can overlap with a hook run
- apply.ts imports EXIT_RENAMES_DEFERRED from skill-refresh.ts, so the core write path depends on the hook module. Moving the constant to a shared module would fix the direction.
- Not yet aligned with the shared `isConceptApplied` from 049: this worktree predates it. Use it after a rebase.

## Post-mortem notes

- Shared `.claude/channels/` across worktrees: @backend overwrote `test/backend.1.md`, so 048 received 045's payload. 045's scribe payloads ended up with the `.2` suffix.
- @backend made one edit with a python rewrite script, against the guardrails; the reviewer found no damage.
- @scribe ran `refresh-skills` from the main checkout (no cd, ticket 056). That ran against the main store, and the worktree's graph was never refreshed.
- `.claude/rules/plugin-skills.md` still says `plugin/hooks/` must not exist. @scribe's edit was refused (self-modification), so it needs the user.
- A false "no HANDOFF" flag on @test's interim stop while it waited on background work.

## Suggested ticket changes

- New ticket: make lock takeover atomic (rename-based, or an owner check before rmSync), and move EXIT_RENAMES_DEFERRED to a shared module.
- 045 follow-up after the rebase onto 049: switch to `isConceptApplied`.
- Channel isolation per worktree or per ticket (maestro runtime).
