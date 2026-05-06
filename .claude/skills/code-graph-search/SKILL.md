---
name: code-graph-search
description: Reference for how `code-graph search` works — BM25 seed → graph expansion → score → cluster. Read before refactoring src/query/search.ts.
allowed-tools: Read
---

## When to use

Read this before touching `src/query/search.ts`, the ArangoSearch view in `src/scribe/bootstrap.ts`, or any retrieval code path. Explains *why* the pipeline is shaped the way it is so refactors don't regress relevance.

## Pipeline overview

```
query string
   │
   ▼
[1] BM25 seed     ← ArangoSearch view `code_search_view` over vertices+docs
   │
   ▼
[2] Partition     ← split seeds into vertex seeds vs doc seeds
   │
   ▼
[3] Expand vertex seeds  ← graph traversal, depth-bounded
   │
   ▼
[4] Expand doc seeds     ← capture skill doc; load concept vertices ONLY if no vertex seeds
   │
   ▼
[5] Score         ← 0.7 × (bm25/max) + 0.3 × (degree/max)
   │
   ▼
[6] Cluster by concept, sort, format markdown
```

## Phase 1 — BM25 seed

`search.ts` ~L147. Single AQL query against `code_search_view` with weighted boosts:

| Field | Boost | Why |
|-------|-------|-----|
| `d.name == query` (exact) | 5× | direct symbol hit dominates |
| `d.name IN TOKENS(query)` | 3× | partial name match |
| `d.purpose IN TOKENS(query)` | 2× | enriched semantic match |
| `d.tags IN TOKENS(query)` | 1.5× | tag match |
| `d.body_md IN TOKENS(query)` | 1× | skill doc body match |

`LIMIT 10` — top 10 seeds only. Empty seeds → `SearchNoResultsError` (CLI exit 6).

The view indexes both `vertices` and `docs` collections — seeds may be either.

## Phase 2 — Partition seeds

`vertexSeeds` = seeds where `_id` starts with `vertices/`. `docSeeds` = the rest (skill docs).

`docLoadsVertices = vertexSeeds.length === 0` — controls fallback behavior in Phase 4.

## Phase 3 — Expand vertex seeds (`expandVertex`)

For each vertex seed, three traversals:

| Traversal | Direction | Depth | Edge filter |
|-----------|-----------|-------|-------------|
| Structural outbound | OUTBOUND | 1 | `calls`, `reads`, `writes`, `uses-hook`, `mounts`, `has-type` |
| Impact inbound | INBOUND | 1..2 | `calls`, `triggers`, `delegates-to` |
| Cross-concept | ANY | 1 | `e.crosses_concept == true` |

Neighbors discovered here are added to `vertexMap` with `bm25 = 0` (they didn't BM25-match; they got pulled in by structure). They are **not themselves expanded** — depth caps at the values above.

Skill doc for the seed's concept is loaded into `skillDocs` map.

`incidentEdges: Map<vKey, Set<edgeKey>>` tracks edges incident to each vertex — used to compute `degree` in scoring.

## Phase 4 — Expand doc seeds (`expandDoc`)

Always: capture the skill doc into `skillDocs`.

Conditionally (`loadVertices === true`, i.e. zero vertex seeds): load **all** live vertices of the doc's concept with `bm25 = 0`. This is the discoverability fallback for pure-concept queries like "drag and drop" that only hit a skill body.

**Why the conditional**: when vertex seeds exist, loading all concept vertices floods the result with unrelated symbols (the original "35-vertex bloat" bug). Vertex seeds + their structural/impact expansions already cover the relevant subgraph.

## Phase 5 — Score

After expansion:

```
score = 0.7 × (bm25 / maxBm25) + 0.3 × (degree / maxDegree)
```

- `bm25` is the seed score (0 for expansion-only neighbors).
- `degree` is the count of edges incident to the vertex within the result set.
- Weights bias toward textual relevance but reward graph centrality.

Hits are sorted desc by score.

## Phase 6 — Cluster + format

Hits grouped by `vertex.concept`. Each cluster gets the matching skill doc (full body or name only, controlled by `skillMode`). Clusters sorted by max hit score within the cluster.

Markdown sections per cluster:
- `### Skill` — full body if `skillMode === "full"`, else one-liner pointer
- `### Relevant code` — vertex hits with edges_in/edges_out enumerated
- `### Cross-concept side effects` — deduped `crosses_concept` edges

## Token budget (`applyTokenBudget`)

Three-step degradation if markdown exceeds `maxTokens`:

1. Strip ` — why: "..."` reason strings from edges.
2. Drop low-degree leaves (`degree ≤ 1` AND `bm25 === 0`).
3. Truncate skill body between `<!--SKILL_START-->` / `<!--SKILL_END-->` sentinels to first ~2000 chars.
4. Hard-truncate.

Skill sentinels are stripped from final output regardless.

## Critical invariants — don't break these

- **One BM25 query, one expansion pass.** Don't add a second-round seed phase or recursive expansion — depth is capped intentionally for token budget.
- **`expandDoc` vertex loading is conditional.** Without the `vertexSeeds.length === 0` guard, single-symbol searches return whole-concept dumps.
- **`has-type` belongs in structural outbound.** Type-defs are useful context (one or two per function); removing it loses signal without saving meaningful tokens. Was reviewed once — stay the course.
- **Inbound depth-2 only filters `impactTypes`.** Don't include `mounts` / `uses-hook` inbound at depth 2 — that pulls in entire component trees.
- **Seeds are limited to 10.** Raising this multiplies expansion cost.
- **The view uses `TOKENS(...)` not `PHRASE(...)`.** Phrase matching kills multi-word natural-language queries.

## Common refactor pitfalls

| Symptom | Likely cause |
|---------|--------------|
| Result floods with unrelated vertices | `expandDoc` running unconditionally |
| Multi-word queries return nothing | View switched to PHRASE matching |
| Slow searches | Removed seed `LIMIT` or added recursive expansion |
| Missing high-relevance vertices | BM25 boosts changed; check exact-name boost still 5× |
| Cross-concept section empty | `e.crosses_concept` not set in `apply.ts` (computed at edge insert) |

## Files

- `src/query/search.ts` — pipeline implementation
- `src/scribe/bootstrap.ts` — `code_search_view` definition (analyzers, fields)
- `src/query/queries.ts` — sibling query functions (`queryConcept`, `queryImpact`, `queryVertex`, `queryFile`, `queryCross`)
- `src/query/format.ts` — markdown rendering for non-search query types
- `src/query/run.ts` — CLI wrapper
