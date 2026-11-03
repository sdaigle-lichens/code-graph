# Batch the per-concept stamp, extract, apply and drift steps

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Feedback from a session running `/code-graph:update-concept-skills` in the maestro repo (2026-10-29) on 11 concepts: every step runs once per concept, so it took about 44 separate calls (11 stamps, extracts, applies and drifts).

- 4 of 11 `skills stamp` calls exited 9 (EPERM) because the sandbox blocks writes to the project's own `.claude/skills`, and each printed its lines to apply by hand, discovered one by one.
- 9 of 11 concepts had never been applied, so `drift --json` listed every vertex as "new" (one report over 30 KB).

Build:
1. Batch forms: `skills stamp` taking several skills in one call (with `--bump`), and `extract` / `apply` / `drift` taking several concepts or `--all`. A blocked stamp in a batch must not stop the others, and the result returns every blocked skill's lines in one place, keeping exit 9 when any was blocked.
2. `drift` on a concept that was never applied says so in one line (text and `--json`) instead of listing every vertex.
3. Update the `update-concept-skills` plugin skill (and any other plugin skill that loops over these commands) to use the batch forms, and to warn up front that stamps under the project's `.claude/skills` may be blocked by the sandbox and offer to apply the printed lines with Edit.

This is code in the CLI commands with tests, plugin skill text, docs (`docs/usage.md`) and a regenerated plugin bundle (`pnpm bundle`).

Out of scope: changing what stamp, extract, apply or drift compute for one concept.

## Acceptance criteria

- [ ] `skills stamp` accepts several skills in one call; blocked ones don't stop the rest, all their lines come back in one result, and the exit code is 9 when any was blocked
- [ ] `extract`, `apply` and `drift` accept several concepts or `--all`; single-concept calls behave as today
- [ ] `drift` on a never-applied concept reports it in one line in text and `--json`
- [ ] The `update-concept-skills` skill uses the batch forms and warns about blocked stamps under `.claude/skills` before stamping
- [ ] `docs/usage.md` documents the new forms and exit codes; tests cover them; plugin bundle regenerated; `just eval` 7/7 and `pnpm check` green (or its parts, in the sandbox)

## Blocked by

None — can start immediately

## Post-Mortem

- **Problem:** Parallel worktree sessions share the main checkout's `.claude/channels`; @test was injected 045's `test/backend.1.md` instead of 049's backend payload and had to plan from the ticket and diff.
  **Fix:** none
- **Problem:** `isConceptApplied` (scribe/enrich.ts) was meant as the single shared "applied" helper, but `enrich targets` (`dbMap.size > 0`) and apply.ts (`conceptWasApplied`) still keep their own checks; its doc comment overstates its use. Left for the rebase onto 050.
  **Fix:** none
- **Problem:** @scribe could not refresh the graph (extract + apply) for the two revised project skills because the CLI reads config from cwd and `cd` is forbidden (ticket 056).
  **Fix:** none
