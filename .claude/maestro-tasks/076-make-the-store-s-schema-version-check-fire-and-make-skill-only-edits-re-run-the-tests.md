# Make the store's schema-version check fire, and make skill-only edits re-run the tests

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Two small fixes found while building ticket 075; this is code, tests, a regenerated bundle and a version bump.

First, the store schema version. Every store command opens the store through a shared start-up step that writes the current schema version before the version check reads it. The check therefore always sees its own number: the documented exit 3 for a store made by a newer code-graph can never happen, and a newer store is silently marked as version 1. Some write commands (apply, enrich, delete-concept) have no version check at all. Make every store command read the stored version first and refuse a newer store with exit 3 and a clear message, write the version only for a new or same-or-older store, and give each store command a test. Then remove the pinned todo test in the scout tests and the known-limitation notes about this in the usage doc and the scribe-pipeline skill.

Second, the turbo test cache. The test task does not count the plugin's skill files as inputs, so an edit to a skill file alone replays cached test results instead of running the tests that pin skill text. Add the plugin skill (and agent) files to the inputs of the task that runs those tests, so a skill-only edit re-runs them.

## Acceptance criteria

- [ ] Opening a store whose schema version is newer than the code's exits 3 with a clear message on every store command, and the stored version is left unchanged
- [ ] A new store and an older or same-version store still open and get the current version written
- [ ] apply, enrich and delete-concept check the version too; a test covers each store command
- [ ] The pinned todo for the exit 3 gap is removed and the known-limitation notes in docs/usage.md and the scribe-pipeline skill are gone
- [ ] An edit to a file under plugin/skills or plugin/agents alone makes the test task run again instead of replaying the cache
- [ ] The version is bumped in all three version files, the bundle is regenerated, `pnpm verify` is green and `just eval` stays 7/7

## Touched surfaces

- packages/code-graph/src/ (store open and schema check, store commands, tests)
- packages/code-graph/src/scout/scout-cli-exits.test.ts (remove the todo)
- turbo.json
- docs/usage.md, .claude/skills/scribe-pipeline/SKILL.md (remove the limitation notes)
- plugin/scripts/code-graph.cjs (generated)
- packages/code-graph/package.json, plugin/.claude-plugin/plugin.json, .claude-plugin/marketplace.json (version; this task bumps, after 075's 0.3.43)

## Blocked by

- `075-ship-the-haiku-refactor-scout-as-a-plugin-skill-a-maestro-project-can-run-at-epic-start-and-end.md`
