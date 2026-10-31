# Manager review — 050 (round 1)

## Goal

Before any enrichment fan-out, `update-concept-skills` adds up the enrichment targets across all concepts, reports the total and the never-applied concepts, and asks before continuing. Never-applied concepts go to `create-concept-skills`' graph build.

## Done

- The CLI couldn't give a cross-concept total in one call, so `enrich targets --summary [--json] [--all]` with no concept is now a roll-up. In one call it returns the total, `neverApplied`, `notExtracted` and per-concept counts and core sizes. Per-concept `--summary` also gains an `applied` flag.
- Skill step 6:
  - Reads `neverApplied` before any `apply` (an apply would mark the concept as applied).
  - Gives never-applied concepts `create-concept-skills`' step-8 build (extract + apply, no enrichment).
  - Re-runs the roll-up after the applies and reports the total, per-concept counts and the first-time builds.
  - Asks with AskUserQuestion: incremental only (recommended), include first-time builds, or stop. Run as a subagent, it enriches only the incremental concepts and reports the rest.
- Bundle regenerated. `pnpm check`, typecheck and `just eval` (7/7) are green.

## Deviations

- No new tests yet; they are left to @test, which is next on the path. One existing test pins the summary keys and needs `applied` added.

## Decisions

- "Applied" means the concept has live vertices or a docs row, so docs-only concepts count as applied. This is used for reporting only; how targets are chosen is unchanged.
- A concept with no `.ast.json` reports `extracted: false` with 0 targets instead of failing the roll-up.
- The skill reuses `create-concept-skills`' step-8 build rather than invoking that skill, because that skill stops when a concept list already exists.

## Touches

- `packages/code-graph/src/scribe/enrich.ts` (the target-selection logic moved into a shared `collectTargets`, plus a new `enrichTargetsRollup`)
- `packages/code-graph/src/cli.ts`
- `plugin/skills/update-concept-skills/SKILL.md`
- `plugin/scripts/code-graph.cjs` (regenerated)
- `docs/usage.md`, `packages/code-graph/CLAUDE.md`

## Sibling impact

- Changes the `enrich targets` CLI surface: the concept argument is now optional with `--summary`, and the summary gains an `applied` field. Any sibling that reads the `--summary --json` keys or edits `update-concept-skills` step 6 should know.
- @scribe will update the `enrich.ts` row in `.claude/skills/scribe-pipeline/SKILL.md`.

## Questions

- Is "incremental only" the right recommended default for the ask?
