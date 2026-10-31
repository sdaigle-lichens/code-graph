# Report r045: 049-batch-the-per-concept-stamp-extract-apply-and-drift-steps.md

- Task: 049-batch-the-per-concept-stamp-extract-apply-and-drift-steps.md
- Written: 2026-10-31T01:30:47.267Z
- From session: absorb-concept-skills-049

## 049 report: batch stamp/extract/apply/drift

**Outcome:** done in worktree code-graph-task-049 (branch task-049), not committed, no version bump. Path: backend → manager review (on-track, m003) → test → reviewer → scribe. 556/556 tests (41 new), typecheck clean, pnpm check green, just eval 7/7, bundle regenerated (reproducible hash).

**Delivered:**
- `skills stamp <skill>...`: one `--bump` for the batch. Every target is resolved first (exit 1, nothing written, if any fails). Blocked writes don't stop the rest and all blocked lines come back in one result. Exits 9 if any write was blocked, 1 on any other write error.
- `extract|apply|drift <concept>...|--all`: a failing concept doesn't stop the batch, and the command exits 1 with a summary line. Batch JSON is `{concepts, failed}`.
- Never-applied drift prints one line; JSON is `{concept, neverApplied:true, vertices}`.
- Plugin skills update-concept-skills and create-concept-skills use the batch forms and warn up front about blocked `.claude/skills` stamps. update-concept-skills keeps the step order: read neverApplied before any apply.
- docs/usage.md, plus the project skills scribe-pipeline and concept-skills-layer, are updated.

**Findings:**
- `isConceptApplied` (scribe/enrich.ts) exists, but only the dry-run never-applied check calls it. `enrich targets` (`dbMap.size > 0`) and apply.ts (`conceptWasApplied`) keep their own checks, and its doc comment overstates its use. Reconcile when rebasing onto 050 (3b43b6a); 045 should also use it.
- A cross-ticket channel payload happened: 049's @test got 045's test/backend.1.md.
- Graph refresh for the two revised project skills was not run (cwd/no-cd, ticket 056).

**Suggested follow-ups (non-blocking, from @reviewer):**
- Share a single print-then-throw `ReportedError` helper (it is duplicated in extract.ts ×2 and ast-output.ts; apply.ts has a local `fail()`).
- The per-process ts-morph Project cache in extract.ts would go stale for any long-lived caller.
- The stamp-batch `failed[]` path (a write error that isn't a sandbox block) is untested.

**Post-mortem:** see the 049 task file (channel crossing, isConceptApplied not yet single, graph refresh blocked by no-cd).
