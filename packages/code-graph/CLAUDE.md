# packages/code-graph

The published CLI + library (`bin: code-graph` → `dist/cli.js`). Build from the repo root, never
from here.

## Layout notes

- `src/scribe/` writes the store (bootstrap, extract, apply, delete-concept); `src/query/` reads it;
  `src/skills/` is layer 1 (`code-graph skills *`); `src/eval/harness.ts` runs Layer-A eval.
- `eval/tasks.json` is the default Layer-A fixture shipped in the npm `files` set — not this
  repo's own gate (that is the root `eval/`).

## Library surface

The `exports` map points at `dist`, not source: relative imports carry explicit `.js` extensions
against `.ts` files. `src/index.ts` re-exports the pure read path and deliberately omits
`loadConfig`, `deleteConcept`, `preflight.ts`, `run.ts` and `search()` (they `process.exit` and
write to stdout, which would crash a host process) and `extract.ts` / `catalog.ts` (the only
`ts-morph` importers). Keep that line when adding an export.

## The plugin bundle

`scripts/build-plugin.mjs` (esbuild, turbo `bundle` task) emits the committed
`plugin/scripts/code-graph.cjs`, which plugin skills run with no `node_modules` beside it.

- `typescript`/`ts-morph` are not bundled: every import goes through `requireFromProject`
  (`project-deps.ts`, `createRequire(<project>/package.json)`); missing →
  `MissingProjectDependencyError` ("install dependencies first").
- The version is baked in as `__CODE_GRAPH_VERSION__` and `packageRoot()` is null in the bundle —
  read version/package dir through `version.ts`, never `package.json`.
- **Layer 1 never loads the graph stack.** `skills *` must not load `node:sqlite`, `typescript` or
  `ts-morph`; `cli.ts` imports store/extract/query modules lazily inside each command. Keep new
  graph imports lazy and keep `skills/` free of them.

## Store conventions

- Vertex `_key` = `sha1(concept::filepath::name::type).slice(0,32)`; survives rename via drift
  detection. `status: live | archived` — never hard-delete; apply archives missing vertices.
- Agent fields (`purpose`, `inputs`, `outputs`, `cross_concept_refs`, `document_ref`, `tags`) are
  written only by enrichment and preserved across re-extracts; `agent.stale = true` flags a body
  change.
- Edge dedup `eKey = sha1(from|to|type|line)`. Re-apply replaces all AST edges; agent-authored
  edges (`agent.authored_by != null`) are upserted separately.
- `concept.skill` is ingested as a `docs/<concept>::skill` vertex with `documented-by` edges to
  every live vertex in the concept.
- One FTS5 table `search_fts` over `vertices(name, purpose, tags)` + `docs(body_md)`, `porter
  unicode61` — one table because `bm25()` scores only compare within one index. Rebuilt wholesale
  at the end of every `apply`. Stopwords are stripped in JS (`toMatchExpr`, `scribe/rows.ts`).
- `skills` block `{ version, last_update, agents[] }` in `scribe.config.json`: loose `z.record` in
  `config.ts`, validated in `skills/state.ts` from raw JSON (works without `concepts`/`tsconfig`).
  Legacy `.claude/concept-skills.json` is a read-only per-field fallback; the first write seeds
  from it.

## Gotchas

- `bootstrap` is idempotent but never migrates. A schema change = bump `SCHEMA_VERSION`, delete
  `scribe-output/graph.db`, re-run `extract` + `apply`.
- `node:sqlite` binds anonymous `?` only; `?1`/`?2` raise "column index out of range".
- `EDGE_SCAN_ORDER` in `queries.ts` reproduces ArangoDB's reverse edge-index scan. It looks
  arbitrary, but it picks which edge represents a vertex after dedup — changing it changes
  `impact`/`vertex` output.
- The destructured store-action resolution in `extract.ts` (`resolveToVertexKey` →
  `BindingElement`) is load-bearing for impact queries through hooks.
- Edits to `extract.ts` change `contentHash`; drift shows "changed" until `apply` runs.
- A repo-level `skills stamp` without `--bump` resets the version to **1.0**; pass
  `--bump minor|major` when migrating an existing list.
