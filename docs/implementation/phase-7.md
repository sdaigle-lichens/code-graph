# Phase 7 — Search (hybrid BM25 + traversal)

## Goal

Primary retrieval surface: `code-graph search "<natural language>"`. One CLI call → one dense markdown dump containing skill prose + precisely-scoped vertices + cross-concept side effects. Pipeline: BM25 seeds via ArangoSearch, multi-hop expansion, re-rank, cluster by concept, format.

This is the mode `/graph` routes to by default.

## Context

### Pipeline

```
1. Parse query string → tokens (basic whitespace split is fine v1)
2. BM25 search via `code_search_view`:
   - score = BM25(name, boost 3) + BM25(purpose, boost 2) + BM25(tags, boost 1.5) + BM25(body_md, boost 1)
   - top K=10 results (vertices + docs mixed)
3. Seed expansion — for each seed:
   - if seed is a vertex:
     * include parent concept's skill doc (via `documented-by` edge → docs/<concept>::skill)
     * 1-hop outbound on structural edges: calls, reads, writes, uses-hook
     * 2-hop inbound on impact edges: calls, triggers, delegates-to
     * cross-concept edges (`crosses_concept == true`) from this vertex
   - if seed is a doc:
     * include doc itself + all vertices `documented-by` it (whole concept)
4. Union + dedupe by `_key`
5. Re-rank: score = (BM25 score × 0.7) + (edge-degree-in-result-set × 0.3)
6. Cluster by concept; sort concepts by max score in cluster
7. Format markdown
```

### AQL skeleton — BM25 seeds

```aql
LET seeds = (
  FOR d IN code_search_view
    SEARCH ANALYZER(
      BOOST(d.name == @q, 3) OR
      BOOST(PHRASE(d.purpose, @q, "text_en"), 2) OR
      BOOST(PHRASE(d.tags, @q, "text_en"), 1.5) OR
      PHRASE(d.body_md, @q, "text_en"),
      "text_en"
    )
    SORT BM25(d) DESC
    LIMIT 10
    RETURN { doc: d, score: BM25(d) }
)
RETURN seeds
```

The `code_search_view` links both `vertices` (purpose/name/tags) and `docs` (body_md), so the result set mixes both collection types — the caller distinguishes by inspecting `seed.doc._id` collection prefix (`vertices/...` vs `docs/...`).

### Expansion (per seed) — pseudocode

```
function expand(seed):
  if seed is vertex:
    out += seed
    out += skill_doc_for(seed.concept)  // via documented-by
    out += traverse(seed, OUTBOUND, types=[calls, reads, writes, uses-hook], depth=1)
    out += traverse(seed, INBOUND,  types=[calls, triggers, delegates-to], depth=2)
    out += traverse(seed, ANY,      types=[* where crosses_concept], depth=1)
  if seed is doc:
    out += seed
    out += all vertices V where documented-by(V) == seed
```

### Re-rank

For each unique vertex/doc in the unioned set:
- `bm25 = score from seed query (0 if expanded-only)`
- `degree = count of edges in result set incident on this vertex`
- `final = bm25 * 0.7 + degree * 0.3`

Sort descending. Cluster by `concept`. Within each cluster, sort by `final`. Order clusters by the max `final` they contain.

**Normalize BM25 scores within result set before mixing with degree.** Raw BM25 has arbitrary scale; map to `[0, 1]` (divide by max) so the 0.7/0.3 weighting is meaningful regardless of corpus size.

### Typed result shape (decouple from format)

Build a structured intermediate before any markdown emission. Keeps formatter pure and makes `--json` mode trivial.

```ts
type SearchHit = {
  vertex: Vertex | null;            // null if hit is a doc seed
  doc: SkillDoc | null;             // SKILL.md vertex this hit belongs to
  edges_in: Array<{ edge: Edge; from: Vertex }>;   // 2-hop inbound impact
  edges_out: Array<{ edge: Edge; to: Vertex }>;    // 1-hop outbound structural
  cross_edges: Array<{ edge: Edge; other: Vertex }>; // crosses_concept=true
  bm25: number;                     // raw BM25 from seed query (0 if expanded-only)
  degree: number;                   // incident-edge count in result set
  score: number;                    // final = normalize(bm25)*0.7 + normalize(degree)*0.3
};

type SearchResult = {
  query: string;
  hits: SearchHit[];                // unioned + deduped + re-ranked
  clusters: Array<{                 // grouped by concept, sorted by max score
    concept: string;
    skill: SkillDoc | null;
    hits: SearchHit[];
  }>;
  totals: { concepts: number; vertices: number; docs: number; tokens: number };
};
```

Search pipeline returns `SearchResult`. Formatter takes `SearchResult` → markdown. `--json` returns `SearchResult` directly.

### Output format (single markdown dump)

```markdown
# Search: "<query>"

> N concepts matched, M vertices, K skill docs, ~T tokens

## Concept: <name>

### Skill (invariants, algorithms, gotchas)
<full SKILL.md body>

### Relevant code
- @<file>:<lines> — `<name>` — <purpose>
  - why: "<reason on edge if applicable>"
  - ← triggered by `<otherName>` at <file>:<line>
  - → reads `<otherName>` (<otherConcept>)

### Cross-concept side effects
- → **<otherConcept>** — <fromName> calls <toName> — <reason>
```

Repeat per concept cluster.

### Token budget

Same `--max-tokens=3000` default as query modes. Same truncation order:
1. Drop edge `reason` strings
2. Drop low-degree leaves (incident-edge count ≤ 1 in result set)
3. Truncate skill doc body from end (preserve first ~500 chars)

### Failure modes

- Exit 2 — server unreachable (stderr: "ArangoDB not reachable at <url>; try `code-graph up`")
- Exit 3 — DB doesn't exist (stderr: "DB <name> not found; try `code-graph bootstrap`")
- Exit 5 — no `scribe.config.json` (stderr: "no scribe.config.json found above <cwd>")
- Exit 6 — zero hits (stderr: "no matches; try rephrasing or fall back to Explore")

## Tasks

1. Create `src/query/search.ts`. Entrypoint: `search(query: string, opts: { maxTokens, json })` → `SearchResult`.
2. Pre-flight: call `preflight()` from `src/query/preflight.ts` (phase 6 task 1) — handles exits 2/3/5 in one call.
3. Implement BM25 seed query (AQL above). Bind `@q` from input. K = 10.
4. Implement seed-expansion. Use arangojs cursor + AQL traversal — one query per seed is acceptable in v1; can batch later. Traversal AQL example:
   ```aql
   FOR v, e, p IN 1..2 INBOUND @startId edges
     FILTER e.type IN @types
     RETURN { vertex: v, edge: e, depth: LENGTH(p.edges) }
   ```
5. Resolve skill doc for each unique concept in the seed set: `DOCUMENT("docs", CONCAT(@concept, "::skill"))`.
6. Union + dedupe vertices and edges by `_key`. Build a `degree` map by counting incident edges per vertex.
7. Normalize BM25 scores within result set (`bm25 / maxBm25`) and degree (`degree / maxDegree`). Re-rank: `final = bm25norm * 0.7 + degreeNorm * 0.3`. Vertices appearing only via expansion get `bm25 = 0`.
8. Build the typed `SearchResult` (see Context section): per-vertex `SearchHit` with structured `edges_in / edges_out / cross_edges`, then cluster by `concept`. Sort within cluster + sort clusters.
9. Build markdown from `SearchResult`. Header line with totals. Per-concept block: skill body inline → relevant-code list → cross-concept side effects list. Formatter is pure (`SearchResult` → string).
10. Apply token budget truncation in priority order.
11. Wire `code-graph search "<q>"` in `src/cli.ts`. Support `--max-tokens` and `--json` (when set, emit `SearchResult` JSON directly).
12. Update `plugin/commands/graph.md` (from Phase 4) — confirm routing wired and exit-code fallbacks land in the slash command output.

## Done when

- `code-graph search "sync sends stale ops"` returns markdown including:
  - The `workorder-store` skill body inline.
  - `clearWorkorderOperations` and `mergeWorkordersByEquipment` in the Relevant Code section.
  - A Cross-concept side effects section referencing `scheduler-store` and/or `shift-logic`.
- `code-graph search "completely-unrelated-gibberish-xyz"` exits 6 with the rephrasing suggestion.
- With `code-graph down` running, `code-graph search "..."` exits 2.
- `code-graph search "..." --json` returns valid JSON with the union result set + ranking metadata.
- `code-graph search "..." --max-tokens=800` produces truncated markdown that still has the first ~500 chars of skill body.
- Inside Claude Code, `/graph sync stale ops` routes through the slash command, prints the markdown, and Claude Code can `Read` the file paths it suggests.
- `/graph concept workorder-store` routes to `code-graph query concept workorder-store` (not search).

## Pitfalls

- ArangoSearch view indexing is async — give it a moment after upserts. Tests may need to wait or query the view consistency.
- BM25 scores from `code_search_view` are arbitrary scale; normalize within the result set before mixing with degree.
- Seeds may include the same concept's skill doc multiple times (one per vertex seed in that concept) — dedupe early.
- Avoid re-running expansion AQL per seed serially — issue them in `Promise.all` for latency, but cap concurrency to ~5 to be polite to the local DB.
