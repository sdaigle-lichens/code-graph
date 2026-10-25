# Record cross-concept calls at extract time

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The 032 fixture build found that a fresh, un-enriched graph has only edges within a concept.
- `query impact moveTask` exits 0 but lists only callees: both real callers live in other concepts and
  are missing.
- `query cross` between the two concepts exits 6.

Verified in code:
- `buildEdges` (`scribe/extract.ts`) sets `crosses_concept: false` on every edge, and its resolver only
  maps a declaration to a vertex of the concept being extracted. A call into another concept's file
  resolves to nothing, so no edge is written.
- `apply` recomputes `crosses_concept` (`crossesConceptForEdge`, apply.ts ~533) from a `keyToConcept` map,
  which is built from this concept's ast.json vertices plus the store's vertices.
- Today only enrichment's agent-authored edges cross concepts. So `impact` and `cross`, which the
  retrieval skill recommends for "what breaks if I change Y", are wrong until someone enriches.

**Fix: when a call or mount resolves to a declaration in a file matched by another concept's globs, emit
the edge to that concept's vertex.**
- The vertex key is deterministic, `sha1(concept::filepath::name::type).slice(0,32)`, so `extract` can
  compute it from the config without reading the other concept's ast.json.
- The edge belongs to the source concept, so apply's replace-all of that concept's AST edges still owns
  it.
- Decide and document what happens when the target concept is not applied yet, or its vertex is
  archived:
  - `crosses_concept` must still be true. Don't rely on apply's `keyToConcept` alone; extract can set it
    itself.
  - Queries must not crash on, or show, a dangling `_to`.
- A file matched by several concepts' globs: pick a documented rule (e.g. config order), and test it.

Mind the invariants in packages/code-graph/CLAUDE.md:
- **ast.json byte-stability:** unchanged code gives an unchanged file. The first extract after this
  change rewrites files once, which is expected; say so in usage.md.
- **`EDGE_SCAN_ORDER`:** `impact` output for in-concept cases must not change.
- **`eKey` dedup.**
- **Layer 1 never loads the graph stack.**
- **`FTS_FORMAT`:** bump it only if the indexed text changes, which it shouldn't here.

Re-extract this repo's own concepts and the 032 fixture's `.ast.json` files, and commit both. The fixture
ships committed `<concept>.enriched.json` files (user decision in 032): after re-extracting, check them with
`enrich targets`; re-merge any entry that went stale, never hand-edit. The fixture must then show
`impact moveTask` naming its cross-concept callers and `query cross` exiting 0. Run `just
regraph` if this repo's graph needs it.

Then the user runs the full 032 suite (3 runs, `--scaffold`, `--allow-tools Bash`) as the after
measurement against the 032 pilot baseline.

Version: next free patch in all three files, bundle regenerated.

Out of scope: an enrichment-free `purpose` text; changing search ranking or the exit-7 rule (a
no-answer question still exits 7 on an un-enriched concept, recorded as a separate finding); `SCHEMA_VERSION`
(the edges table already has `crosses_concept`, and no migration is expected; if one turns out to be
needed, stop and report).

## Acceptance criteria

- [ ] A cross-concept call produces an edge with `crosses_concept: true` from extract alone, with no enrichment; tested, including the case where the target concept is not applied yet
- [ ] `query impact <symbol> --direction in` lists callers from other concepts, and `query cross <a> <b>` returns them, on a fresh extract + apply; tested
- [ ] In-concept `impact` output is unchanged (an existing test or a new golden), and an unchanged-code re-extract is byte-stable after the one-time rewrite
- [ ] The 032 fixture `.ast.json` files and this repo's own concepts are re-extracted and committed; the 032 suite's impact and cross cases pass on the new graph
- [ ] The user ran the full 032 suite (3 runs); the report compares it with the 032 pilot and 033's pilot (pass rate, Δ, Skill and Bash use per case, `costUsd`)
- [ ] docs/usage.md and the scribe-pipeline skill describe cross-concept edges and the one-time rewrite
- [ ] pnpm check, package tests and just eval (7/7) green; version bumped in all three files, bundle regenerated; `claude plugin validate` passes

## Blocked by

- `033-make-code-graph-retrieval-trigger-on-natural-code-questions.md` (shared tree, version and bundle; its pilot is this ticket's middle baseline)
