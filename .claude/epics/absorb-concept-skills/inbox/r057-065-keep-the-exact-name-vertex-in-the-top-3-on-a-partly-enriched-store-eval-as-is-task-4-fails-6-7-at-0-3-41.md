# Report r057: 065-keep-the-exact-name-vertex-in-the-top-3-on-a-partly-enriched-store-eval-as-is-task-4-fails-6-7-at-0-3-41.md

- Task: 065-keep-the-exact-name-vertex-in-the-top-3-on-a-partly-enriched-store-eval-as-is-task-4-fails-6-7-at-0-3-41.md
- Written: 2026-11-03T01:41:49.442Z
- From session: absorb-concept-skills-065

# Report: ticket 065 (absorb-concept-skills)

## Outcome

Done and NOT committed. The work is in the working tree on top of HEAD 482276d. The manager asked for a commit, but a manager message is not the user's approval, so I will ask the user before committing. `pnpm-lock.yaml` stays out and the version is not bumped.

`just eval-as-is` is 7/7 on the real store (task-4: `apply` is first), and `just eval` is 7/7.

## Verified

- Verified on HEAD 482276d plus the uncommitted working tree (not a committed tree). `@test` ran the full suite uncached: `pnpm check` 6/6, code-graph 718/718, desktop 115/115.
- The scribe step afterwards changed only markdown files (prettier --check clean), so the suite was not re-run after it.
- `just eval`: `store: un-enriched (stripped copy, purposes and tags removed, index rebuilt; 163 of 237 vertices carry a purpose in the real store)`.
- `just eval-as-is`: `store: enriched (as-is, not stripped; 163 of 237 vertices carry a purpose in the real store; verdict depends on local enrichment)`.

## Cause and fix

- Cause: the ranking, not the enrichment text. `apply` (bm25 3.12) already carried `NAME_HIT_FACTOR` 3, but `NeverAppliedDrift`, `DriftJson` and `isConceptApplied` are also name hits through the porter stems and their purposes repeat several query words.
- Fix: `NAME_EQUALS_TOKEN_FACTOR = 3` in `query/search.ts`. It applies to the blended score only, when a non-type-def's lowercased whole name equals a query token and it is not an exact whole-query hit. It is kept out of the `maxBm25` normaliser. Without that exclusion, eval task-3 failed.
- Reported `bm25`, the low-confidence threshold (4), the `search --json` shape and `FTS_FORMAT` are unchanged.
- `queryTokens` was split out of `toMatchExpr` in `scribe/rows.ts`; the reviewer confirmed it preserves behaviour.
- Tests are in `query/search-partly-enriched.test.ts`. Mutation evidence: with the factor at 1 the ticket-065 test fails (`apply at 4, want top 3`); with the type-def exclusion removed the type-def test fails. Both were restored.

## Score above 1 (manager's condition)

The blended `score` of a boosted vertex can exceed 1 (for example 2.4 for `formatConcept`). I grepped every consumer. Only `search.ts` reads `score`, in sorts and the cluster max (lines 455, 472-473, 736). `apps/desktop`, `docs/usage.md` and the skills do not use it. None assumes at most 1. I did not re-normalise it, since that failed eval task 3.

## Top 3 on both stores, after the change

Before-change lists are from `@backend` (real store at 0.3.41); unchanged queries are not repeated.

| Task | Stripped (`just eval`) | As-is (`just eval-as-is`) |
| --- | --- | --- |
| 1 token budget | applyTokenBudget, truncate, budgetSearchJson | same |
| 2 traversal expansion | expandDoc, expandVertex, queryImpact | expandVertex, queryImpact, formatImpact |
| 3 preflight | preflight, checkSchemaVersion, applySchema | preflight, checkSchemaVersion, loadConfigOrExit |
| 4 apply drift | apply, NeverAppliedDrift, DriftJson | same |
| 5 exact symbol | formatConcept, ConceptResult, truncate | same |
| 6 docs-only | skillDoc, isDocsOnly, extractDocsOnly | extractDocsOnly, docKey, conceptEnrichable |
| 7 marker-stamped skill | apply, fail, storedFtsFormat | apply, IndexFormatCheck, ensureSearchIndexFormat |

Before, on the real store: task-3 was checkSchemaVersion, preflight, loadConfigOrExit; task-4 was NeverAppliedDrift, DriftJson, isConceptApplied. Before, on the stripped store: task-3 was checkSchemaVersion, preflight, applySchema; task-4 was NeverAppliedDrift, apply, DriftJson. Tasks 1, 2 and 6 were identical before and after on both stores. The review brief said the stripped task-3 third place was `Config`; the correct one is `applySchema`.

## By-hand store steps

The user (not the manager, not an agent) ran these by hand, because the auto-mode classifier denied `@backend`'s `apply`:
- `apply code-graph-search` (after `@backend` ran `extract code-graph-search`).
- `extract scribe-pipeline` and `apply scribe-pipeline`. Until this ran, the desktop real-store suite was red (23 skipped edges against 24), because `searchStore` now calls `queryTokens` in `scribe/rows.ts`, a cross-concept edge into a vertex not yet in the store.

## Findings and follow-ups

- The `code-graph-search` SKILL.md was edited again by `@scribe` after the stamp was set (version 1.3, applied by Edit because `skills stamp` exits 9 on a read-only filesystem). The stamp is slightly stale (`--bump minor --print` now says 1.4) and the store holds the doc from before those wording edits. The user can re-run `extract` + `apply` for `code-graph-search`, and decide whether to re-stamp.
- Non-blocking reviewer note: `nameEqualsToken` calls `JSON.parse(r.doc)` a second time, although the doc is already parsed into `seeds[].doc`.
- A consumer store needs `just regraph` after taking this change.
- `docs/implementation/plan.md` still describes the original BM25 spec; left alone on purpose.

## Post-mortem

Not clean: the store and bundle needed two by-hand user steps, the `@test` agent's closing line was JSON-wrapped once (resent), and the review brief had one wrong top-3 entry. No `## Post-Mortem` section was written.

## Suggested ticket changes

- Consider a rule or tooling so `@backend` can run `apply` for this repo's own concepts without the classifier denial, since the ticket asks for it.
