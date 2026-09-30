# CLAUDE.md

Project-level guide for Claude Code working inside this repo.

## What this project is

`code-graph` — CLI + Claude Code plugin for graph-based code intelligence over TypeScript/React projects. Extracts vertices (functions, hooks, components, stores, types, effects) and edges (calls, mounts, reads, writes, has-type, uses-hook, documented-by, agent-authored cross-concept refs) into an embedded SQLite store, then exposes hybrid retrieval through `/graph`.

## Repo layout

Turborepo workspace (pnpm). Every task runs from the root: `pnpm build` / `typecheck` / `test` /
`check` / `verify`, or the `just` equivalents.

```
apps/
  desktop/                # code-graph-desktop — Electron + React graph viewer
    src/main/             # main process; graph.ts is the ONLY importer of `code-graph`
    src/preload/          # contextBridge surface
    src/shared/ipc.ts     # the IPC contract (channels + Result<T> + mirror types)
    src/renderer/         # React UI — never sees the library or node
packages/
  code-graph/             # the published CLI + library; `bin: code-graph` → dist/cli.js
    src/
      cli.ts              # commander entrypoint, all subcommands
      index.ts            # programmatic surface — the pure read path only (see below)
      config.ts           # scribe.config.json loader
      schema.ts           # Vertex/Edge/Doc Zod schemas
      catalog/catalog.ts  # repo-wide symbol catalog (ts-morph)
      scribe/
        bootstrap.ts      # SQL schema + indexes + FTS5 index rebuild
        db.ts             # node:sqlite store handle + per-project db path
        rows.ts           # doc-column unwrapping, handle helpers, FTS match builder
        extract.ts        # ts-morph AST walk → vertices + edges (.ast.json)
        apply.ts          # diff DB vs ast.json/enriched.json, drift, upsert
        delete-concept.ts # archive + dangling-ref reporting
      query/
        preflight.ts      # config + store creation + schema-version check
        queries.ts        # concept / impact / cross / vertex / file SQL
        search.ts         # BM25 seed + multi-hop expand + token budget
        format.ts         # markdown rendering (formatConcept/Impact/Search)
        run.ts            # CLI-side wrappers around query funcs
      eval/
        harness.ts        # Layer-A eval runner (reads tasks.json, checks SearchResult)
    eval/
      tasks.json          # default Layer-A fixture, shipped in the npm `files` set
  lsp/                    # code-graph-lsp — spawns the CLI, deliberately decoupled
  typescript-config/      # @repo/typescript-config — base.json + react.json
  styles/                 # shared styles, fonts, SCSS (from the maestro reference)
  ui/                     # shared React UI components (see its own CLAUDE.md)

plugin/                   # stays at the ROOT, not in a package
  .claude-plugin/         # plugin.json
  commands/               # /graph, /scribe-enrich slash commands
  skills/scribe-code-graph/  # SKILL.md (the agent-facing skill)

editor/zed-code-graph/    # Zed extension (Rust → wasm; cargo, not pnpm)

eval/                     # this repo's OWN graph, not the shipped fixture
  tasks.code-graph.json   # the Layer-A regression gate — `just eval`
  verification.md         # 16-step phase-8 verification log
  eval-results.md         # Layer-B template

docs/
  installation.md
  usage.md
  development.md
  implementation/         # phase plans (plan.md, phase-1..11.md, phase-8-troubleshooting.md)

justfile                  # task runner
turbo.json                # build/lint/check/typecheck/test/dev tasks
pnpm-workspace.yaml       # apps/* + packages/*; onlyBuiltDependencies (pnpm 10 spelling)
```

`packages/code-graph/dist/` is the compiled output that `bin: code-graph` points at. Rebuild with
`pnpm build` (or `just build`).

`plugin/` and `.claude-plugin/` stay at the repo root on purpose: `marketplace.json` points at
`./plugin`, and `claude --plugin-dir /path/to/code-graph/plugin` is the documented install path.
They are not in the npm `files` set any more, because npm cannot reach outside a package directory —
the plugin ships via git, not via the tarball.

### The library surface

`packages/code-graph`'s `exports` map points at `dist`, not source: its relative imports carry
explicit `.js` extensions against `.ts` files, which a bundler's resolver should not have to guess
at. `src/index.ts` re-exports the pure read path and deliberately omits `loadConfig`,
`deleteConcept`, `preflight.ts`, `run.ts` and `search()` — all of which `process.exit` and write to
stdout, so they belong to the CLI and would crash a host process. It also omits `extract.ts` and
`catalog.ts`, the only `ts-morph` importers. When adding an export, keep that line.

### The desktop app

`apps/desktop` consumes the library in-process, under these rules:

- Only `apps/desktop/src/main/graph.ts` may import `code-graph`. Every read goes through `openStore`
  (`existsSync` before `getStore`); `closeAllStores` runs on project switch and `will-quit`.
- All IPC goes through the single `handle()` wrapper in `main/ipc.ts`, which returns `Result<T>`
  (`{ ok: true, data } | { ok: false, error }`). Channels live in `src/shared/ipc.ts`.
- A renderer-supplied `projectRoot` is honored only via `resolveProjectRoot`.
- Edge endpoints are resolved with `keyOf` in the main process only (`withEndpointKeys` in
  `main/graph.ts` adds `fromKey`/`toKey` to `graph:concept` edges); the renderer never splits a
  handle. The canvas skips edges whose endpoint is outside the concept and counts them. Layout uses
  `@dagrejs/dagre`; `documented-by` edges start toggled off.
- `graph:init` writes `scribe.config.json` only. It never creates the store or extracts; the store
  appears on `apply`.

## Concepts

A **concept** is a named slice of the codebase declared in the consumer's `scribe.config.json`. Each concept has globs + a SKILL.md path. The pilot concept is `workorder-store` in `~/Documents/gits/lichens-ordonnancement-ui`.

## Pipeline

```
scribe.config.json
       │
       ├── code-graph extract <concept>   → scribe-output/<concept>.ast.json
       │
       ├── /scribe-enrich <concept>       → scribe-output/<concept>.enriched.json
       │      (Claude subagent fills purpose/inputs/outputs/cross_concept_refs/tags)
       │
       ├── code-graph apply <concept>     → DB upsert + drift report
       │
       └── code-graph search "<query>"    → BM25 seed → 1–2 hop expand → markdown
```

## Important conventions

- **One store per project** — `<configRoot>/scribe-output/graph.db` (override with `dbPath` in the config). Gitignored; share a graph by committing the `.ast.json` / `.enriched.json` beside it and re-running `apply`.
- **Vertex `_key`** — `sha1(concept::filepath::name::type).slice(0,32)` — deterministic, survives rename via drift detection.
- **`status: "live" | "archived"`** — never hard-delete; apply marks missing vertices archived.
- **Agent fields** — `purpose`, `inputs`, `outputs`, `cross_concept_refs`, `document_ref`, `tags` are written ONLY by enrichment, preserved verbatim across re-extracts. `agent.stale = true` flags purpose drift on body change.
- **Edge dedup** — `eKey = sha1(from|to|type|line)`. Re-apply replaces all AST edges; agent-authored edges (`agent.authored_by != null`) are upserted separately.
- **Skill ingestion** — `concept.skill` markdown ingested as a `docs/<concept>::skill` vertex with `documented-by` edges to every live vertex in the concept.
- **Full-text index** — one standalone FTS5 table `search_fts` over `vertices(name, purpose, tags)` + `docs(body_md)`, tokenized `porter unicode61`. One table, because `bm25()` scores are only comparable within a single index. Rebuilt wholesale at the end of every `apply`, never incrementally.
- **Stopwords are stripped in JS** before the FTS5 `MATCH` (`toMatchExpr` in `scribe/rows.ts`). FTS5 does not strip them and they otherwise match long `body_md` far more often than short `name`.

## CLI exit codes

| Code | Meaning |
|------|---------|
| 0 | OK |
| 1 | Usage / config error |
| 2 | *(retired — was ArangoDB unreachable; never emitted now)* |
| 4 | Ambiguous symbol — disambiguate with `concept::name` or `filepath:name` |
| 6 | No results / vertex not found |

`/graph` slash command falls back to Explore agent on exit 2 or 6. Exit 2 is kept reserved rather than reused, so the plugin and LSP branches that still handle it stay harmless.

Exit 3 now means the store was written by a newer code-graph than the CLI reading it.

## Working in this repo

- Always run `pnpm build` (or `just build`) after changing `packages/code-graph/src/`. Turbo orders
  the packages, so build from the ROOT, not from inside a package. The global `code-graph` binary is
  a symlink to `packages/code-graph/dist/cli.js`.
- Run `just eval` before shipping retrieval changes — it runs the Layer-A harness against this
  repo's own graph (`eval/tasks.code-graph.json`, expects **5/5**). `just eval-pilot` is the old
  pilot-dir variant, and the pilot project is not on this machine.
- **`pnpm format` is a graph-invalidating operation.** Prettier rewrites function bodies, which
  rewrites `contentHash`, which marks every reformatted vertex `changed` and its enrichment
  `agent.stale`. Run `just regraph` after any format pass.
- **Vertex `_key` includes the filepath**, so moving a file — or moving the whole tree, as the
  monorepo refactor did — rewrites every key in that concept. `scribe-output/<concept>.enriched.json`
  is keyed by `_key` too, so it is orphaned by the same move and has to be remapped or re-enriched.
- `bootstrap` is idempotent (`CREATE TABLE IF NOT EXISTS`), but it will not migrate an existing store. A schema change means bumping `SCHEMA_VERSION` and deleting `scribe-output/graph.db`, then re-running `extract` + `apply`.
- The traversal ordering in `queries.ts` (`EDGE_SCAN_ORDER`) reproduces ArangoDB's reverse edge-index scan. It looks arbitrary because it is, but it decides which edge represents a vertex after de-duplication — changing it changes `impact` and `vertex` output.
- `node:sqlite` binds anonymous `?` placeholders only; numbered `?1`/`?2` raise "column index out of range".
- Edits to `extract.ts` change `contentHash` for affected vertices → drift report will show "changed" until apply runs.
- The destructured store-action resolution in `extract.ts` (`resolveToVertexKey` → `BindingElement` path) is load-bearing for impact queries through hooks. Keep it when refactoring.

## Pilot project

`~/Documents/gits/lichens-ordonnancement-ui` — first onboarded consumer. Do not commit changes there from this repo. The pilot's `scribe.config.json` + `scribe-output/` + `eval/results-*.json` live in that consumer dir, not here.

## Phase status

- Phases 1–11: complete (phase 11 = ArangoDB → embedded SQLite). See `docs/implementation/`.
- Layer-A eval: 5/5 green against this repo's own graph (`just eval`).
- Layer-B (Claude-session A/B) gate: pending user execution.
- Concept #2 (`shift-logic` / `gantt-render`): blocked on Layer-B gate decision.

## Out of scope (do not implement unless asked)

- Embedding-based ranking (BM25 first; embeddings only if Layer-B fails).
- LangChain / agentic search wrapper.
- MCP server.
- Git hooks / CI auto-scribe.
- `code-graph gc` for hard-delete of archived vertices.

## When in doubt

- Check `docs/implementation/plan.md` for the master spec.
- Check the relevant `phase-N.md` for the slice you're touching.
- Eval harness (`eval/tasks.code-graph.json`, run by `just eval`) is the regression-safety net — keep it green.
