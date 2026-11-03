## Goal
Follow-ups from the 045/049 reviews: one applied check (`isConceptApplied`) everywhere, a safe refresh-skills lock, one shared print-then-throw helper, and a defined outcome for extracting a code concept whose globs match nothing.

## Done
- `changedSkillConcepts` (scribe/skill-refresh.ts) now uses `isConceptApplied`; the helper's doc comment lists refresh-skills as a caller.
- Lock: `takeLock` returns an owner token and takes over a stale lock by atomic rename; `releaseLock` deletes only a lock holding the caller's token.
- `EXIT_RENAMES_DEFERRED` moved to new `scribe/exit-codes.ts` (skill-refresh re-exports it); apply no longer imports the hook.
- `reportAndThrow` in concept-batch.ts replaces the duplicates in extract, ast-output and apply.
- ts-morph Project cache lifetime documented; `clearProjectCache()` exported.
- `stampBatch` exported with an injectable writer; new test covers the `failed[]` path (ENOSPC).
- Unmatched globs: clear error `no source files matched concept "<name>" (globs: ...)`, exit 1, no `.ast.json` written.
- Bundle regenerated; scribe-pipeline skill and packages/code-graph/CLAUDE.md updated.

## Deviations
- Chose an error over an empty extract, because an empty `.ast.json` would make apply archive every vertex of the concept.
- Behaviour difference: a concept with only archived vertices and no doc row is no longer refreshed (consequence of using `isConceptApplied`).
- `just eval` is 5/7 on the local enriched store (tasks 2 and 6), identical on untouched HEAD; 7/7 on an un-enriched store. Acceptance criterion says 7/7.

## Decisions
- Error over empty extract (above). Lock ownership via token file content plus rename takeover.

## Touches
packages/code-graph: concept-batch, scribe/{apply,ast-output,enrich,extract,skill-refresh,exit-codes}, skills/commands, tests (skill-refresh.test, stamp-batch-failed.test); scribe-pipeline SKILL.md; package CLAUDE.md; plugin bundle.

## Sibling impact
None known; bundle diff limited to these modules.

## Verified
Uncommitted working tree (no commit yet). `pnpm build` and `pnpm check` green; package suite 612/612 reported by @backend. `just eval` NOT 7/7 on the enriched local store (5/7, pre-existing on HEAD). @test and @reviewer have not yet run.

## Questions
- Is the pre-existing 5/7 eval on the enriched local store acceptable for this ticket, or should it be handled in a separate ticket?
