# 061 diagnosis: partly enriched stores rank worse (eval tasks 2 and 6)

Phase 1 only. No source, rows.ts, bootstrap.ts or eval-task change has been made.

## Reproduction (`just eval-as-is`, code-graph 0.3.36 dist, 150 of 235 vertices carry a purpose)

Enriched: code-graph-search and scribe-pipeline; not concept-skills-layer (a docs-only concept, 0 vertices).
Result 5/7. Failing:

- task-2-traversal-expansion ("expand graph traversal impact"): vertex `expandDoc` not in top 6, found at 9.
- task-6-docs-only-concept ("docs-only concept skill resolution skillsDir"): concept-skills-layer not in the top 3 clusters (it is absent from the clusters altogether).

The other five pass (tasks 1, 3, 4, 5, 7).

## Raw evidence (`searchStore` on the real store, plus raw `search_fts` rows)

Task 2 final hit order: expandVertex, collectEdges, queryImpact, twoHops, formatImpact, oneHop (6), anyNeighbors (7), search (8), expandDoc (9, bm25 6.69, degree 7), runImpact.
Raw BM25 seed order: ... formatImpact 11.30, search 8.84, anyNeighbors 8.31, oneHop 7.45, expandDoc 6.69, runImpact 6.39.
`expandDoc` matches only through its name word "expand". `search`, `anyNeighbors` and `oneHop` also match through their enriched purposes ("graph", "traversal", "impact").

Task 6 clusters: scribe-pipeline(25), code-graph-search(19). The concept-skills-layer doc is at raw FTS rank 12 (6.37); ranks 1-11 are vertices whose purposes mention "concept", "docs", "skill" (extractDocsOnly 13.01, conceptEnrichable 11.30, declaredConcepts 10.97, extract 9.40 ...).

## Diagnosed cause

1. Task 6, seed limit. `searchStore` takes `LIMIT 10` over one mixed list (vertices and docs). A docs-only concept can only surface when its skill doc is itself a seed (search.ts appends an empty cluster for a docs-only concept "when its doc was itself a search seed"). A docs-only concept has no purpose to match and no vertices, so its doc competes on `body_md` weight 1.0 alone. On a stripped store the many vertices only match by name words, so the doc lands within the top 10. When two other concepts are enriched, a dozen vertices gain purpose matches (weight 2.0) and push the doc to rank 12, out of the seed set. Enrichment in one concept therefore pushes an un-enriched concept out of the seed window. This is structural, not a wording problem.
2. Task 2, purpose weight. Same mechanism on the score side: an enriched peer collects name plus purpose matches (name 3.0 + purpose 2.0), while expandDoc, whose purpose carries none of "graph", "traversal", "impact", scores on name only. Three enriched peers (search, anyNeighbors, oneHop) overtake it. In a stripped store those peers have no purpose text, so the task passes. Rank 9 is the raw BM25 order plus the degree term; the degree term does not rescue it (expandDoc degree 7 vs oneHop 8).

## Options

A. Doc-seed reservation (fixes task 6 only). Seed query returns the top 10 as now, plus the best 2 docs (UNION by `ref_kind='doc'`, own `LIMIT 2`) not already in the 10. Doc seeds with vertex seeds present only add a skill doc, or an empty docs-only cluster appended after the code clusters (`docLoadsVertices` stays `vertexSeeds.length === 0`, `docOnly` unchanged). Query-time only: no FTS_FORMAT bump, no reindex. Smallest, safe change.

B. Lower the purpose weight in `FTS_WEIGHTS` (fixes task 2). Query-time, no reindex. Proxy results on raw seed rank of expandDoc, weights name,purpose,tags,body:
   - 3,2,1.5,1 (today): 9th
   - 4,2,1.5,1 and 3,1,1.5,1: 9th and 8th (not enough)
   - 3,0.5,1.5,1: 8th
   - 3,0.25,0.5,1: 5th, but collectEdges falls from 4th to 10th (expected hits of other tasks may move)
   So only a large cut (about 0.25) makes task 2 pass. That also weakens enrichment, whose whole point is plain-language recall, and it moves ranks in tasks 1, 3, 4 and 5.

C. Rank-neutral compromise (recommended for task 2 if B at 0.25 breaks other tasks): keep weights, and make purpose count only when the name or tags also match (cap purpose contribution at the name contribution via two `bm25()` calls, `min(purposePart, namePart + tagsPart)`). Not yet measured; the build phase must sweep it before commit.

Recommendation: ship A plus a measured B (start at purpose 0.25-0.5, sweep all seven tasks on both the stripped and partly enriched store, keep the lightest value that passes), or C if B regresses any task. Commit only values for which all seven tasks keep their rank or better.

## Rejected alternatives

- Raise seed `LIMIT` (10 to 12+): the doc is rank 12 here but the margin shrinks with every further enriched concept; it multiplies expansion cost (skill invariant "Seeds are limited to 10") and does nothing for task 2.
- Always add docs-only concepts as clusters: bypasses relevance, would surface irrelevant docs-only concepts.
- Raise the `body_md` weight: floats long skill docs above the vertices a query is about (the pitfall the stopword list guards against).
- Change eval tasks or expectations: forbidden (no loosening); task 2 wording was already reworded in 0.3.28.
- Strip purposes in the as-is eval: that is just `just eval`.

## Risk

- Other five tasks: A cannot change vertex hits (docs only add clusters appended last). B and C change bm25 scores for every query and can reorder tasks 1, 3, 4, 5, 7; the build phase must print before/after ranks for each of the five and fail if any worsens.
- FTS_FORMAT: not bumped for A, B or C (weights/seeding are query-time, indexed text unchanged); no `code-graph reindex` needed. If the build phase ends up changing indexed text, bump `FTS_FORMAT` and document the reindex.
- Exit-7: confidence uses raw seed `bm25` against `LOW_CONFIDENCE_MIN_SCORE` (4). Lowering purpose weight (B/C) lowers raw scores of enriched hits and can turn borderline searches into exit 7; check `confidence.test.ts` / `search-exit.test.ts` fixtures and the `> Low confidence` wording stays as is unless a threshold changes (then update the message in source). A does not touch confidence (docs-only cluster is appended after code clusters, and docs-only concepts are exempt).
- `--json` shape and exit codes: unchanged for A, B, C.
- Tests: a partly enriched fixture store (two concepts enriched with peers whose purposes echo the query, one docs-only concept un-enriched) pinning both cases; docs to update: code-graph-search skill, docs/evals.md, root CLAUDE.md and packages/code-graph/CLAUDE.md (5/7 caveat).
