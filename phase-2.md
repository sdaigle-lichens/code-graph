# Phase 2 — Bootstrap

## Goal

Idempotent `code-graph bootstrap` that creates the per-project DB, all collections, the named graph, indexes, and the ArangoSearch view. Also exports `bootstrapIfMissing()` so `apply` can auto-bootstrap on first run in a fresh project.

## Context

Per-project ArangoDB database. DB name = `scribe.config.json` `project`. Bootstrap runs from CWD with that config; uses `_system` to create the DB.

### Database

- Name: `<project>` (e.g. `lichens-ordonnancement-ui`)
- One graph per DB: `code_graph`

### Collections (per DB)

- `vertices` — document. Code-section vertices.
- `edges` — edge. All relationships.
- `docs` — document. **First-class.** One doc per concept's SKILL.md. `_key = "<concept>::skill"`. Body = SKILL.md verbatim, plus any long-form `purpose` overflow (>400 chars).
- `concepts` — document. `_key = "<concept>"`. Fields: `owner_skill_path`, `last_scribed_at`.

No `projects` collection — DB **is** the project.

### Graph

```
graph: code_graph
edge collections: [edges]
edge definition: from [vertices, docs, concepts] → to [vertices, docs, concepts]
```

### Indexes

- `vertices`: persistent on `[concept, type]`
- `vertices`: persistent on `name`
- `edges`: persistent on `type`

### ArangoSearch view: `code_search_view`

Powers BM25 retrieval for the `search` mode. Created with the `text_en` analyzer.

Linked fields:
- `vertices.purpose` (text_en)
- `vertices.name` (text_en)
- `vertices.tags` (text_en)
- `docs.body_md` (text_en — markdown stripping is acceptable to defer; text_en alone is fine v1)

### Idempotence

Every step uses `existsAsync` / try-catch on "already exists" so `bootstrap` can run repeatedly and on top of partial state.

## Tasks

1. Create `src/scribe/bootstrap.ts`. Export `bootstrap(onStep?: (msg: string) => void)` (full run with optional progress callback) and `bootstrapIfMissing()` (no-args; used by `apply` — checks DB list, calls `bootstrap()` silently if missing).
2. `bootstrapIfMissing()` — checks if DB named `loadConfig().project` exists in `_system`. If not, calls `bootstrap()`.
3. `createDb()` — from `_system`, `db.createDatabase(name)` if not exists.
4. `createCollections()` — `vertices` (document), `edges` (edge), `docs` (document), `concepts` (document). Each gated on `collection.exists()`.
5. `createGraph()` — create graph `code_graph` with edge definition `{ collection: "edges", from: ["vertices","docs","concepts"], to: ["vertices","docs","concepts"] }`. Skip if exists.
6. `createIndexes()` — persistent on `vertices(concept, type)`, persistent on `vertices(name)`, persistent on `edges(type)`. arangojs `collection.ensureIndex({ type: "persistent", fields: [...] })`.
7. `createSearchView()` — ArangoSearch view named `code_search_view` linking:
   - `vertices` collection: fields `purpose`, `name`, `tags` with `text_en` analyzer, `includeAllFields: false`
   - `docs` collection: field `body_md` with `text_en` analyzer
   Use `db.createView(name, { type: "arangosearch", links: {...} })`. Skip if exists.
8. Wire `code-graph bootstrap` in `src/cli.ts` to call `bootstrap()`. The `bootstrap` function takes an optional `onStep?: (msg: string) => void` callback so the CLI can stream progress (the CLI passes `console.log`); calling without a callback runs silently — used by `bootstrapIfMissing()` from `apply`.
9. Update `code-graph status` to use the same existence checks (DB exists? collections present? view present?) and print a checklist.

## Done when

- From a clean state (`code-graph down && docker volume rm <vol> && code-graph up`), running `code-graph bootstrap` from a dir with `scribe.config.json` succeeds and prints checklist all green.
- Re-running `code-graph bootstrap` is a no-op (no errors, nothing created twice).
- `arangosh --server.database <project> --javascript.execute-string 'print(db._collections().map(c=>c.name()))'` lists `vertices, edges, docs, concepts`.
- `arangosh ... 'print(db._views().map(v=>v.name()))'` lists `code_search_view`.
- `arangosh ... 'print(db._graphs().map(g=>g._name))'` lists `code_graph`.
