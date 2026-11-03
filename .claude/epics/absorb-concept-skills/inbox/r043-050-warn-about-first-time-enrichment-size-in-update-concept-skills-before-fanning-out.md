# Report r043: 050-warn-about-first-time-enrichment-size-in-update-concept-skills-before-fanning-out.md

- Task: 050-warn-about-first-time-enrichment-size-in-update-concept-skills-before-fanning-out.md
- Written: 2026-10-31T01:21:32.797Z
- From session: absorb-concept-skills-050

# 050 report

## Outcome
Done in worktree code-graph-task-050 (branch task-050). Nothing is committed yet; that waits on the user. Path: backend → manager review (on-track, m001) → test → reviewer → scribe, each passed on the first try.

- **CLI:** `enrich targets --summary [--json] [--all]` with no concept now returns a roll-up across all concepts: { total, neverApplied, notExtracted, concepts[] }. The per-concept summary gains an `applied` field. Bundle regenerated.
- **Skill:** update-concept-skills step 6 reads neverApplied before any apply, gives never-applied concepts create-concept-skills' step-8 build (extract + apply, no enrichment), re-runs the roll-up, reports the total, then asks before any fan-out (default: incremental only).
- **Checks:** 524/524 package tests pass (enrich.test.ts 32/32, 9 new for the roll-up). pnpm check and typecheck are green. just eval is 7/7 on build 0.3.29.

## Findings
- **Total can read 0:** a never-applied concept whose SKILL.md names no vertices reports total 0, with its real size in core.leftOut. The skill states this, but its report instruction doesn't tell the session to print core.leftOut beside first-time builds. @reviewer rated it non-blocking.
- **Graph not refreshed:** after @scribe's edit to the scribe-pipeline SKILL.md, `extract` failed because the worktree has no ts-morph. Also, `extract` resolved to the main checkout even with CLAUDE_PROJECT_DIR set to the worktree, and it has no --root flag. Re-run `extract` and `apply` for scribe-pipeline after the merge.

## Reconcile with 049 at rebase
- Replace the private `conceptWasApplied` in enrich.ts with 049's `isConceptApplied`.
- Update the scribe-pipeline invariant, which currently names `conceptWasApplied` and says 049 reuses it.
- Expect conflicts in the update-concept-skills step-6 block, cli.ts, docs/usage.md and the bundle. Whichever lands second regenerates the bundle.
- No version bump in this task. It takes the next free patch when it lands.

## Post-mortem
None (clean session).

## Suggested ticket changes
- **Follow-up (small):** in update-concept-skills, print core.leftOut beside each first-time build.
- **Follow-up:** `extract` should honour the worktree root (a --root flag, or CLAUDE_PROJECT_DIR).
