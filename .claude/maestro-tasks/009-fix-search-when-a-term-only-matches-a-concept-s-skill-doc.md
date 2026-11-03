# Fix search when a term only matches a concept's skill doc

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

maestro's first real graph (code-graph 0.3.2: 16 concepts, 1480 vertices, 3510 edges, not enriched) found two linked search bugs and asked for one hint.

**1. Plain text says '0 concepts matched' when --json has hits.** `code-graph search "blockedBy cascade"` prints 0 concepts, but `--json` returns hits (task-queue first). Likely cause: in `src/query/search.ts`, when the only seeds are skill docs, `expandDoc` loads the concept's vertices with bm25 0 and never expands them, so their degree is 0 too. `applyTokenBudget` step 2 then keeps only hits with `degree > 1 || bm25 > 0`, which drops all of them. Confirm this, then fix it: a doc-seeded result must never shrink to zero concepts in plain text when `--json` has hits. Within a token budget, keep at least the concept cluster with its skill line, and trim vertices rather than dropping the cluster.

**2. --json hits from a doc seed have empty edges_in, edges_out and cross_edges.** This happens even though the store holds the edges, and a vertex-seeded search (e.g. `search MaestroTasksPage`) lists calls and mounts. Vertices loaded through a doc seed should get their one-hop edges, and so a real degree, so the 0.3 degree term ranks them instead of leaving them unranked. Keep the cost bounded: a concept can hold hundreds of vertices, so cap or rank the expansion. Re-check token use against `--max-tokens`.

**3. Hint before enrichment.** If the hits come only through a skill doc (every vertex bm25 0, typically because the concept isn't enriched yet), say so in the plain-text output in one line, suggesting enrichment via the `scribe` skill so vertices become searchable by purpose and tags.

Add a Layer-A eval task or a unit test that reproduces 1 and 2 (a doc-only match on a concept with edges). `just eval` must stay green.

## Acceptance criteria

- [ ] A query that matches only a concept's skill doc prints that concept in plain text, and the --json output agrees on which concepts matched
- [ ] Doc-seeded vertices in --json carry their one-hop edges_in, edges_out and cross_edges, and their degree is non-zero when the store has edges for them
- [ ] Doc-seeded expansion stays within --max-tokens on a concept with hundreds of vertices
- [ ] Plain text shows a one-line enrichment hint when every hit came only through a skill doc
- [ ] A test or eval task reproduces the doc-only match and fails on the old code
- [ ] pnpm test, pnpm check and just eval are green (eval count updated if a task was added)

## Blocked by

None — can start immediately
