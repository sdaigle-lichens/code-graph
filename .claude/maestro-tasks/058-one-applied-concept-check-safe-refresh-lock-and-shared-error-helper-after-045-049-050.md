# One applied-concept check, safe refresh lock, and shared error helper after 045/049/050

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Follow-up cleanups from the 045 and 049 reviews, to run once 045, 049 and 050 are merged. (1) 049 (merged as bde12b5) already made `isConceptApplied` the only applied check for drift, apply and the `enrich targets` roll-up. Make sure `refresh-skills` (045) uses it too rather than its own check, and that the helper's doc comment matches its callers. (2) Make `refresh-skills`' lock next to graph.db safe: atomic takeover of a stale lock (rename-based or owner-checked) and a cleanup that never deletes a lock another run has since taken. Also move the renames-deferred exit code out of the hook module into a shared module, so the apply write path no longer imports the hook. (3) Replace the duplicated print-then-throw error code in extract, ast-output and apply with one shared helper, test the stamp batch's `failed[]` path (a write error that isn't a sandbox block), and document or bound the per-process ts-morph Project cache so a long-lived caller can't read a stale project. (4) Found by 049's @test: `extract` fails on a code concept whose globs match nothing. Decide whether that should be a clear error that names the concept and its globs, or an empty extract that apply can handle. Implement the choice, test it, and document it in the scribe-pipeline skill (the skill doesn't mention this case). Code changes with tests, the package CLAUDE.md and scribe-pipeline skill text where they name these, and a regenerated plugin bundle. No user-visible behaviour change, so no new docs/usage.md section.

## Acceptance criteria

- [ ] `refresh-skills` uses `isConceptApplied` like drift, apply and the enrich roll-up, and its doc comment matches its callers; existing tests still pass unchanged
- [ ] Tests show that two concurrent refresh-skills runs never both apply, a stale lock is taken over atomically, and a run never deletes a lock it doesn't own
- [ ] The apply write path no longer imports the hook module
- [ ] One shared print-then-throw helper replaces the duplicates; the stamp batch `failed[]` path has a test; the ts-morph Project cache's lifetime is documented or bounded
- [ ] Extracting a code concept whose globs match nothing has a tested, documented outcome (a clear error or an empty extract) rather than an unexplained failure
- [ ] Plugin bundle regenerated; `pnpm check` green and `just eval` 7/7

## Blocked by

- `045-refresh-the-graph-automatically-after-skill-md-edits.md`
- `049-batch-the-per-concept-stamp-extract-apply-and-drift-steps.md`
