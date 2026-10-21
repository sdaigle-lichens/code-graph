# Bring the scribe's default load back near its pre-merge size and stop budget leaks

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

From maestro's merge review (R4; `~/gits/maestro/.claude/epics/code-graph-cutover/merge-review.md`).

Measured on maestro:
- scribe agent body plus skill went from 13 273 to 25 165 B (~3.3k to ~6.3k tokens) on every scribe
  run; the enrichment sections alone are ~8.1 KB and load even when the run doesn't enrich;
- `skills status --json` is 32 128 B (~8k tokens) for 16 concepts;
- `search "design check" --json --max-tokens 400` returned 9 038 B: 0 hits plus a `gaps` block
  listing all 16 concepts twice.

Verified in code:
- `plugin/skills/scribe/SKILL.md` is 16 666 B.
- `cli.ts` (~L274-277) passes `{ strength, gaps }` as `extra` to `budgetSearchJson`, which "always
  keeps" extra (`query/search.ts` ~L550-564). It counts it but can only trim hits, so `gaps` is never
  cut and blows the budget.

**1. Scribe skill.** Move the enrichment procedure into a reference file beside the skill
(e.g. `plugin/skills/scribe/enrichment.md`) that the scribe reads only when it enriches. SKILL.md
keeps a short pointer saying when to read it. `code-graph:scribe` SKILL.md ≤ 9 KB. Keep the
gap-channel contract text verbatim (plugin/skills/CLAUDE.md).

**2. `search --json` budget.** `--max-tokens N` bounds the whole payload, `gaps` included: output
≤ ~4N bytes. Compact `gaps` before dropping it (one line per concept, no duplicate listing, only the
concepts relevant to the query or the top-k when trimming), add a `dropped.gaps` count when it trims,
and lower or document the floor. Figure out why the 16 concepts appear twice and fix that whatever
the budget.

**3. `skills status` compact JSON.** Add a compact form (e.g. `--summary`, matching `enrich targets
--summary`) ≤ 8 KB for 16 concepts: per concept id, version, last-update, commits/files since, graph
counts, and nothing else. Point the update flows at it where they don't need the full form.

**4. Stale search index after an upgrade (found verifying 023).** 0.3.16 indexes names split into
words (`nameIndexText`), but a store built earlier keeps its old FTS rows until `code-graph reindex`
or the next `apply`. Nothing tells a user who only upgraded the plugin, and their search silently
behaves like 0.3.15. Record the FTS row format (a constant, e.g. `FTS_FORMAT`, stored in the store's
meta) when the index is built. When `search` finds a missing or older format, rebuild the index once
(`rebuildSearchIndex` is cheap and needs no extract) or, if the store can't be written, print one
line saying to run `code-graph reindex`. No `SCHEMA_VERSION` bump.

Version 0.3.18 in all three files (next free patch if another task ships first), bundle regenerated.
Update docs/usage.md, the `code-graph-search` skill and packages/code-graph/CLAUDE.md
(`search --json` floor note).

## Acceptance criteria

- [ ] `plugin/skills/scribe/SKILL.md` ≤ 9 KB; the enrichment procedure lives in a reference file the skill reads only when enriching; the gap-channel contract text is unchanged
- [ ] `search --json --max-tokens N` output is ≤ ~4N bytes with `gaps` included, for N=400 on a 16-concept store (test); `gaps` no longer lists concepts twice
- [ ] `skills status` has a compact JSON form ≤ 8 KB for 16 concepts (test with a 16-concept fixture), and the update flows use it
- [ ] A store indexed before 0.3.16 is detected by `search`, which reindexes once (or says to run `code-graph reindex` when it can't write); a test covers an old-format store
- [ ] claude plugin validate, pnpm check, pnpm test and just eval (7/7) are green; version bumped in all three files, bundle regenerated

## Blocked by

- `023-keep-search-honest-while-most-concepts-are-un-enriched.md` (both edit `query/search.ts`)
