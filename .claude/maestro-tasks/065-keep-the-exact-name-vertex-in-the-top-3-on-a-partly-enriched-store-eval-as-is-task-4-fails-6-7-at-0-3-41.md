# Keep the exact-name vertex in the top 3 on a partly enriched store (eval-as-is task-4 fails 6/7 at 0.3.41)

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

`just eval-as-is` (store untouched, partly enriched: 163 of 235 vertices carry a purpose) is 6/7 at 0.3.41. task-4-apply-drift, query `scribe apply drift detection`, requires vertex `apply` in the top 3 hits; it ranks 4th (bm25 3.12). Ahead of it: `NeverAppliedDrift` (type-def, bm25 10.16), `DriftJson` (type-def, 9.96), `isConceptApplied` (function, 8.78; new in 058, enriched since). The 061 mechanisms (`DOC_SEED_RESERVE = 2`, whole-token `NAME_HIT_FACTOR = 3` in the blended score only) pass the pinned fixture `query/search-partly-enriched.test.ts` but not this real store. Reproduce first: `node packages/code-graph/dist/cli.js --root <repo> search "scribe apply drift detection" --json`. Then diagnose why: print each hit's bm25, name-hit status, degree and blended score; decide whether the cause is the ranking (a name hit that equals a whole query word, `apply`, loses to purposes that repeat several query words) or the enrichment text. Fix the ranking, not the fixture or the expected task: e.g. a stronger or graded name-hit signal (exact whole-name equality to a query token worth more than a partial name token; prefer a function over a type-def on a tie), or counting how many distinct query words hit the name versus the purpose. Weight tuning alone failed to find a safe margin in 061, so prefer a structural signal and prove the margin on both stores. Do not bump FTS_FORMAT unless the indexed text changes. The reported bm25 and the low-confidence threshold must stay unboosted (see the Phase 5 note in the code-graph-search skill). Add a pinned test reproducing this case (extend `search-partly-enriched.test.ts` with a vertex set shaped like this one: a function named like a query word beside enriched type-defs and a helper whose purposes repeat the query words), and update the `CLAUDE.md` Search ranking line and the code-graph-search SKILL.md if the mechanism changes (then stamp via `skills stamp --bump minor --reviewed`, or `--print` and Edit on exit 9, followed by extract + apply). Do not touch the gitignored enriched files; do not bump the version, the merger does.

## Acceptance criteria

- [ ] `just eval-as-is` is 7/7 on the current real store (task-4 passes with `apply` in the top 3), and `just eval` is still 7/7. Report the two stores' `store:` lines.
- [ ] A new or extended test in `query/search-partly-enriched.test.ts` fails on the 0.3.41 ranking and passes after the change (mutation evidence in the report: revert the fix, see it fail).
- [ ] The other six eval tasks keep passing on both stores; report the top-3 hits for each query before and after so a regression elsewhere is visible.
- [ ] The reported bm25 and the low-confidence threshold are unchanged (unboosted); `search --json` shape is unchanged.
- [ ] `CLAUDE.md` (Search ranking bullet and the Working rules eval-as-is sentence) and the code-graph-search SKILL.md state the mechanism and the real-store result accurately.
- [ ] pnpm check, pnpm test and just eval green on the result; pnpm-lock.yaml is not committed.

## Touched surfaces

- packages/code-graph/src/query/search.ts
- packages/code-graph/src/query/search-partly-enriched.test.ts
- CLAUDE.md
- .claude/skills/code-graph-search/SKILL.md
- plugin/scripts/code-graph.cjs (generated)

## Blocked by

None — can start immediately
