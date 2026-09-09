---
name: code-graph-search
description: Reference for how `code-graph search` works — BM25 seed → graph expansion → score → cluster. Read before refactoring src/query/search.ts.
allowed-tools: Read
---

## When to use

Read this before touching `src/query/search.ts`, the `search_fts` index in `src/scribe/bootstrap.ts`, `toMatchExpr` in `src/scribe/rows.ts`, or any retrieval code path. Explains *why* the pipeline is shaped the way it is so refactors don't regress relevance.

## Pipeline overview

```
query string
   │
   ▼
[1] BM25 seed     ← FTS5 table `search_fts` over vertices+docs
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

`search.ts` ~L136. One SQL statement against `search_fts`, ranked by `bm25()` with
per-column weights (`FTS_WEIGHTS` in `bootstrap.ts`):

| Column | Weight | Why |
|--------|--------|-----|
| `name` | 3.0 | partial name match |
| `purpose` | 2.0 | enriched semantic match |
| `tags` | 1.5 | tag match |
| `body_md` | 1.0 | skill doc body match |

**The exact-name hit is a sort tier, not a weight.** FTS5 has no per-clause boost, so
the old 5× `name == query` boost became `ORDER BY exact DESC, base DESC`: a direct symbol
hit outranks every token match outright, rather than depending on a multiplier being large
enough. Its `bm25` is scaled by 5/3 downstream so the 0.7-weighted score term keeps its
previous shape.

`bm25()` returns **negative-is-better**; it is negated so larger is better, which is what
the score blend in Phase 5 assumes.

**Stopwords are stripped in JS** (`toMatchExpr`, `scribe/rows.ts`) before the `MATCH`.
FTS5's `porter unicode61` tokenizer strips nothing, and filler words like *why / does / the*
match long `body_md` far more often than short `name` — without the filter, skill docs float
above the vertices a natural-language query is actually about. Every token is also quoted,
because a bare `AND` / `OR` / `NEAR` / `*` / `-` / `:` in user input is an FTS5 syntax error.

`unicode61` does **not** split camelCase: `setWorkorderIndex` is one token, so a bare
`workorder` reaches it only through purpose/tags/body. The `text_en` analyzer behaved the
same way.

`LIMIT 10` — top 10 seeds only. No surviving tokens, or no matches → `SearchNoResultsError`
(CLI exit 6).

One FTS table covers both `vertices` and `docs`, because `bm25()` scores are only comparable
within a single index — seeds may be either kind.

## Phase 2 — Partition seeds

`vertexSeeds` = seeds where the `ref_kind` column is `vertex`. `docSeeds` = the rest (skill docs).

`docLoadsVertices = vertexSeeds.length === 0` — controls fallback behavior in Phase 4.

## Phase 3 — Expand vertex seeds (`expandVertex`)

For each vertex seed, three traversals:

| Traversal | Direction | Depth | Edge filter |
|-----------|-----------|-------|-------------|
| Structural outbound | OUTBOUND | 1 | `calls`, `reads`, `writes`, `uses-hook`, `mounts`, `has-type` |
| Impact inbound | INBOUND | 1..2 | `calls`, `triggers`, `delegates-to` |
| Cross-concept | ANY | 1 | `crosses_concept = 1` |

All three go through `oneHop` / `twoHops` in `queries.ts`. Depth 2 is written as an explicit
second leg joined to the first, not a recursive CTE: the depth is a fixed 2, so recursion
would only add a cycle guard and a path accumulator. `e2.key <> d1.ekey` stops a traversal
walking back down the edge it arrived on.

Edges are scanned in **reverse insertion order** (`EDGE_SCAN_ORDER`). That reproduces
ArangoDB's edge-index order — arbitrary in itself, but it decides which edge represents a
vertex reachable more than one way once results are de-duplicated, so changing it changes
`impact` and `vertex` output.

The inbound traversal attributes **depth-2 rows to the seed as well**, inflating its degree.
That is a quirk of the original pipeline that the scores and the rendered "triggered by" list
both depend on — reproduced deliberately, not a bug to fix in passing.

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
| Multi-word queries return nothing | `toMatchExpr` joining tokens with AND instead of OR, or an unquoted operator word raising an FTS5 syntax error |
| Skill docs outrank the obvious vertex | Stopword list shrank — filler words now score against long `body_md` |
| Slow searches | Removed seed `LIMIT` or added recursive expansion |
| Missing high-relevance vertices | Column weights changed, or the `exact DESC` sort tier dropped |
| Search results stale after `apply` | `rebuildSearchIndex` not called; `code-graph status` compares index rows against `vertices + docs` |
| Cross-concept section empty | `crosses_concept` not set in `apply.ts` (computed at edge insert) |

## Files

- `src/query/search.ts` — pipeline implementation
- `src/scribe/bootstrap.ts` — `search_fts` definition, `FTS_WEIGHTS`, `rebuildSearchIndex`
- `src/scribe/rows.ts` — `toMatchExpr` (tokenizer + stopwords + quoting), doc-column helpers
- `src/query/queries.ts` — sibling query functions (`queryConcept`, `queryImpact`, `queryVertex`, `queryFile`, `queryCross`)
- `src/query/format.ts` — markdown rendering for non-search query types
- `src/query/run.ts` — CLI wrapper
