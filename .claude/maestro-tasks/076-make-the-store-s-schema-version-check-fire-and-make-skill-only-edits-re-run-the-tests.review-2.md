## Round 2

Redirect note: "Acceptance criterion 1 says a newer store exits 3 on every store command. Your first deviation leaves out `skills status` and `refresh-skills`... Aim for both commands refusing a newer store with exit 3, through the same open path, with a test each... The brief must name the commit it verified and say the full suite was green on that commit."

- Point 1 addressed: `skills status` (`graphFreshness` in scribe/freshness.ts) and `refresh-skills` (`changedSkillConcepts` in scribe/skill-refresh.ts) both read graph.db and now refuse a newer store with exit 3 through the shared `assertStoreNotNewer` / `exitOnNewerStore` helpers in scribe/bootstrap.ts, which `openStoreOrExit` is built on. Each has a test in scribe/schema-version.test.ts (exit 3, message, stored version still 999). The only exception: `refresh-skills --hook` (the Stop hook) still exits 0 and shows the upgrade message as a `systemMessage`; it has no test yet.
- Point 2 addressed: verified commit is 2d70eeb on branch 076-schema-version. `pnpm verify` ran 14/14 tasks green on it (the full test task executed, then replayed from cache on a second run). `just eval` was 7/7 on the same sources and bundle in the backend run just before the commit.

## Goal
Unchanged: exit 3 on a newer store on every store command, skill/agent edits re-run the turbo tests, one shared leavesRoot in the scout.

## Deviations
`status` no longer prints its old "schema vN is newer" line (exit 3 comes earlier); `docs/evals.md` historical mention of `checkSchemaVersion` left alone; version 0.3.44.

## Decisions
Unchanged from round 1.

## Touches
Round 1 files plus scribe/freshness.ts, scribe/skill-refresh.ts, cli.ts.

## Sibling impact
None known. Merge 075 first.

## Questions
None.
