## Goal
Make the store schema-version check fire (exit 3 on a newer store, version left unchanged) on every store command, make skill/agent edits invalidate the turbo test cache, and share one "leaves the root" helper in the scout.

## Deviations
- `skills status` and `refresh-skills` read through `getStore`, not `bootstrapStore`: they never write the version, so a newer store stays unchanged, but they do not exit 3.
- `status` no longer prints its old "schema vN is newer" line; a newer store exits 3 earlier.
- `docs/evals.md` still mentions `checkSchemaVersion` in a historical table; left alone.
- Version bumped to 0.3.44.

## Decisions
- `bootstrapStore` reads `user_version` first and throws `NewerStoreError`; `openStoreOrExit` turns it into exit 3 with a message. `checkSchemaVersion` removed.
- `enrich merge` opens the store first, so a refused merge writes no enriched file.
- turbo test inputs: `$TURBO_DEFAULT$` plus plugin/skills and plugin/agents globs.
- `leavesRoot` in new `scout/root.ts`, used by `scope.ts` and `proposals.ts`.

## Touches
- packages/code-graph/src/scribe: bootstrap.ts, apply.ts, enrich.ts, delete-concept.ts, new schema-version.test.ts
- packages/code-graph/src/query/preflight.ts, cli.ts
- packages/code-graph/src/scout: root.ts (new), scope.ts, proposals.ts, scout-cli-exits.test.ts (todo removed)
- turbo.json, docs/usage.md, .claude/skills/scribe-pipeline/SKILL.md
- three version files, plugin/scripts/code-graph.cjs (generated)

## Sibling impact
None known. Ticket 075's branch is the base; merge 075 first.

## Questions
None.
