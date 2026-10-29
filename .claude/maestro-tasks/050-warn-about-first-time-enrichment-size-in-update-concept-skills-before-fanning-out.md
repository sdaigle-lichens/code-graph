# Warn about first-time enrichment size in update-concept-skills before fanning out

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Feedback from a session running `/code-graph:update-concept-skills` in the maestro repo (2026-10-29): the skill presents itself as incremental, but for concepts that had never been applied, enrichment was a full first-time job (76 targets for the revised concepts alone, plus the never-enriched core vertices of the stamp-only ones), and nothing warned before the Haiku fan-out.

Change the `update-concept-skills` plugin skill so that, before any enrichment fan-out, it adds up the enrichment targets across all concepts (from `enrich targets --summary --json`), reports the total and which concepts have never been applied, and asks the user whether to go ahead. For never-applied concepts it should say they are a first-time build and point to `create-concept-skills`' graph build instead. If the CLI cannot give that total cheaply in one call, add what is needed (code in the enrich targets command, with tests, plus a regenerated plugin bundle via `pnpm bundle`). Follow the rules for editing plugin skills in `.claude/rules/plugin-skills.md`.

Out of scope: changing how targets are chosen (core, laziness) or the enrichment itself.

## Acceptance criteria

- [ ] Before fanning out, `update-concept-skills` reports the total enrichment target count and the never-applied concepts, and asks before continuing
- [ ] Never-applied concepts are routed to `create-concept-skills`' graph build
- [ ] Any CLI change needed for the count has tests and the plugin bundle is regenerated
- [ ] `pnpm check` green (or its parts, in the sandbox) and `just eval` 7/7

## Blocked by

None — can start immediately
