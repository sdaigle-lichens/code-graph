## Goal
Cut the per-concept loop in `update-concept-skills`: batch forms for `skills stamp`, `extract`, `apply`, `drift` (several names or `--all`); a one-line `drift` report for never-applied concepts; skill text that uses the batch forms and warns about sandbox-blocked stamps under `.claude/skills`.

## Done
- `skills stamp <skill>...`: one call, one `--bump` for the whole batch. Targets are resolved before any write; a blocked write (EPERM/EACCES/EROFS) doesn't stop the others. Every blocked skill's lines are printed together under one header (and as `blocked[]` in `--json`). Exits 9 if any write was blocked, 1 if any target failed (nothing written), else 0.
- `extract|apply|drift [concepts...] | --all`: a failing concept doesn't stop the rest. JSON is `{concepts:[...], failed:[...]}` and the exit code is 1 if any concept failed. A single concept behaves exactly as before.
- Never-applied drift: one text line, or `{concept, neverApplied:true, vertices:n}` in JSON.
- `update-concept-skills` and `create-concept-skills` plugin skills switched to the batch forms, with an up-front warning about stamps blocked under `.claude/skills` and an offer to apply the lines with Edit.
- Build passes and the bundle is regenerated; the 515 existing tests pass. New tests are @test's next step.

## Deviations
- `create-concept-skills` was also updated (the ticket allows "any other plugin skill that loops").
- apply/extract errors now throw a `ReportedError` instead of `process.exit`, so a batch can continue. Exit codes for a single concept are unchanged.
- The ts-morph Project is cached per tsconfig within one process, for batch speed.

## Decisions
- Per 050 coordination: `isConceptApplied(store, concept)` (live vertex OR docs row) was created in `scribe/enrich.ts`, because 050's version wasn't in this worktree yet. 050 should reuse it, not add a second one.
- Skill step 6 order unchanged, so 050 can still read `neverApplied` before any apply.
- No version bump.

## Touches
packages/code-graph/src: cli.ts, concept-batch.ts (new), skills/commands.ts, scribe/apply.ts, scribe/extract.ts, scribe/ast-output.ts, scribe/enrich.ts. plugin/skills: update-concept-skills/SKILL.md, create-concept-skills/SKILL.md. plugin/scripts/code-graph.cjs (generated). docs/usage.md is pending (@scribe).

## Sibling impact
050 shares cli.ts, scribe/enrich.ts (the `isConceptApplied` helper), update-concept-skills SKILL.md, docs/usage.md and the bundle. Whichever task commits second rebases and regenerates the bundle.

## Questions
Is it fine that `--bump` applies to the whole batch (mixed initial/minor stamps take two calls)?
