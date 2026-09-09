# Phase 11 — ArangoDB → embedded SQLite (`node:sqlite`)

## Goal

Remove the Docker-hosted ArangoDB server. The graph becomes a single file per
project, read and written through Node's built-in `node:sqlite` — no server, no
container, and no new dependency.

## Why it was cheap

ArangoDB was barely used as a graph database. The named graph `code_graph` was
created and never traversed; every traversal was depth 1 or 2, anonymous over
the `edges` collection, filtered by edge type. Full-text search was a single
query. There were no transactions and no AQL `UPSERT` — idempotency came from
deterministic sha1 `_key`s. That is a property graph in tables, queried two hops
deep.

## Schema

Each table is `(key TEXT PRIMARY KEY, doc TEXT NOT NULL)` with VIRTUAL generated
columns projecting the filtered fields, and real indexes over those.

The document column is what kept the migration cheap: `SELECT doc` returns
exactly the object that was written, so `format.ts`, the `--json` payloads, the
eval harness and the LSP's own copy of the types all kept working without a
field-by-field mapping that could turn an absent key into an explicit null. It
also absorbs `status` / `archivedAt`, which `delete-concept` writes onto edges
and docs but which appear in no schema.

Document handles (`vertices/<key>`) are stored verbatim, because they appear in
every `.ast.json` on disk and are read by `format.ts` and the LSP.

Full text is one standalone FTS5 table over `vertices(name, purpose, tags)` and
`docs(body_md)`, tokenized `porter unicode61`, rebuilt wholesale after each
`apply`. One table, because `bm25()` scores are only comparable within a single
index.

## What changed for callers

- **Exit 2** ("ArangoDB unreachable") can no longer be produced. It is kept
  reserved rather than reused, so the LSP backoff branch and the `/graph`
  fallback stay harmless.
- **Exit 3** now means the store was written by a newer code-graph.
- **`up`, `down`, `view-db`** are gone; `reindex` is new.
- **`_id` and `_rev`** no longer appear in `--json`. They were driver metadata
  Arango added on read, never stored, and read by nothing in `src/`, `lsp/` or
  the plugin.
- **Search ranking shifts slightly.** ArangoSearch summed per-clause boosted
  contributions; FTS5 does one weighted sum with its own constants. Cluster sets
  and top-5 membership held across the verification queries, but two of seven
  changed which result ranked first.

## Deliberate oddities

- `EDGE_SCAN_ORDER` reverses edge scans to reproduce ArangoDB's edge-index
  order. Arbitrary in itself, but it decides which edge represents a vertex
  after de-duplication, so it is user-visible in `impact` and `vertex`.
- `queryFile` resolves neighbours across `vertices`, `docs` and `concepts`. It
  is the one traversal that never filtered to vertices, so a file's
  `documented-by` edge to its skill doc appears with the vertex fields null —
  and the Zed code lens counts those.
- The search inbound traversal attributes depth-2 rows to the seed, inflating
  its degree. Pre-existing, and both the scores and the rendered output depend
  on it.

## Gotchas found on the way

- `node:sqlite` binds **anonymous `?` placeholders only**. Numbered `?1` / `?2`
  raise "column index out of range".
- Rows come back with a **null prototype**, so `assert.deepStrictEqual` against
  an object literal fails; spread before comparing.
- Dropping the last `arangojs` import stopped TypeScript auto-including
  `@types/node`. `tsconfig.json` now declares `"types": ["node"]` explicitly.

## Verification

The pre-migration output of every read command was captured from a live
ArangoDB, then diffed after each phase.

- `concept`, `impact`, `cross`, `vertex`, `file` — **byte-identical**, including
  the exit-6 no-results path.
- Every stored record — 110 vertices, 256 edges, 1 doc, 1 concept — identical.
- `eval/tasks.code-graph.json` — 5 tasks, 5/5 green. Each carries a
  `provenance` field: four had their expectations checked against the ArangoDB
  goldens *before* being used as the post-migration gate. `task-3` is the
  exception — it originally named `checkServerReachable`, which this phase
  deleted along with exit code 2, so its expectations were written afterwards
  and are not golden-validated.

The graph itself (`scribe-output/`) is not committed: `scribe.config.json` and
the eval tasks are, and `extract` + `apply` rebuild the rest.

`apply` is now wrapped in a transaction. It previously deleted a concept's AST
edges and re-inserted them non-atomically, so a crash in between left the
concept with no edges.
