# Make the store's schema-version check fire, and make skill-only edits re-run the tests

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Two small fixes found while building ticket 075; this is code, tests, a regenerated bundle and a version bump.

First, the store schema version. Every store command opens the store through a shared start-up step that writes the current schema version before the version check reads it. The check therefore always sees its own number: the documented exit 3 for a store made by a newer code-graph can never happen, and a newer store is silently marked as version 1. Some write commands (apply, enrich, delete-concept) have no version check at all. Make every store command read the stored version first and refuse a newer store with exit 3 and a clear message, write the version only for a new or same-or-older store, and give each store command a test. Then remove the pinned todo test in the scout tests and the known-limitation notes about this in the usage doc and the scribe-pipeline skill.

Second, the turbo test cache. The test task does not count the plugin's skill files as inputs, so an edit to a skill file alone replays cached test results instead of running the tests that pin skill text. Add the plugin skill (and agent) files to the inputs of the task that runs those tests, so a skill-only edit re-runs them.

Third, one scout cleanup the refactor scout itself proposed in the user's smoke run. The scout's scope reader and its proposal-path normaliser each carry their own test of whether a path climbs out of its root, and only the normaliser's also treats an absolute path as outside. Keep one helper for that rule and use it in both places, with behaviour unchanged. The shared directory walker the scout also proposed is out of scope.

## Acceptance criteria

- [ ] Opening a store whose schema version is newer than the code's exits 3 with a clear message on every store command, and the stored version is left unchanged
- [ ] A new store and an older or same-version store still open and get the current version written
- [ ] apply, enrich and delete-concept check the version too; a test covers each store command
- [ ] The pinned todo for the exit 3 gap is removed and the known-limitation notes in docs/usage.md and the scribe-pipeline skill are gone
- [ ] An edit to a file under plugin/skills or plugin/agents alone makes the test task run again instead of replaying the cache
- [ ] The scout's scope reader and proposal-path normaliser share one "leaves the root" helper, and the existing scout tests pass unchanged
- [ ] The version is bumped in all three version files, the bundle is regenerated, `pnpm verify` is green and `just eval` stays 7/7

## Touched surfaces

- packages/code-graph/src/ (store open and schema check, store commands, tests)
- packages/code-graph/src/scout/scout-cli-exits.test.ts (remove the todo)
- packages/code-graph/src/scout/scope.ts, packages/code-graph/src/scout/proposals.ts (shared outside-root helper)
- turbo.json
- docs/usage.md, .claude/skills/scribe-pipeline/SKILL.md (remove the limitation notes)
- plugin/scripts/code-graph.cjs (generated)
- packages/code-graph/package.json, plugin/.claude-plugin/plugin.json, .claude-plugin/marketplace.json (version; this task bumps, after 075's 0.3.43)

## Base branch

Stacked on ticket 075, which is done and pushed but not merged yet: create this task's branch `076-schema-version` from `075-refactor-scout` (735751b or later), not from `main`. It already has 075's scout files, version 0.3.43 and the pinned todo this task removes. Merge order: 075 first, then this task; if 075's branch changes before it merges, rebase onto it.

## Blocked by

- None (stacked on 075's branch instead, see Base branch)
