# CLAUDE.md

Project-level guide for Claude Code working inside this repo.

## What this project is

`code-graph` — CLI + Claude Code plugin for graph-based code intelligence over TypeScript/React projects. Extracts vertices (functions, hooks, components, stores, types, effects) and edges (calls, mounts, reads, writes, has-type, uses-hook, documented-by, agent-authored cross-concept refs) into an embedded SQLite store, then exposes hybrid retrieval through `/graph`.

## Repo layout

```
src/
  cli.ts                # commander entrypoint, all subcommands
  config.ts             # scribe.config.json loader
  schema.ts             # Vertex/Edge/Doc Zod schemas
  scribe/
    bootstrap.ts        # SQL schema + indexes + FTS5 index rebuild
    db.ts               # node:sqlite store handle + per-project db path
    rows.ts             # doc-column unwrapping, handle helpers, FTS match builder
    extract.ts          # ts-morph AST walk → vertices + edges (.ast.json)
    apply.ts            # diff DB vs ast.json/enriched.json, drift, upsert
  query/
    preflight.ts        # config + store creation + schema-version check
    queries.ts          # concept / impact / cross / vertex / file SQL
    search.ts           # BM25 seed + multi-hop expand + token budget
    format.ts           # markdown rendering (formatConcept/Impact/Search)
    run.ts              # CLI-side wrappers around query funcs
  eval/
    harness.ts          # Layer-A eval runner (reads tasks.json, checks SearchResult)

plugin/
  .claude-plugin/       # plugin.json
  commands/             # /graph, /scribe-enrich slash commands
  skills/scribe-code-graph/  # SKILL.md (the agent-facing skill)

eval/
  tasks.json            # default Layer-A fixture
  verification.md       # 16-step phase-8 verification log
  eval-results.md       # Layer-B template

docs/
  installation.md
  usage.md
  development.md
  implementation/       # phase plans (plan.md, phase-1..8.md, phase-8-troubleshooting.md)

justfile                # task runner
```

`dist/` is the compiled output that `bin: code-graph` points at. Rebuild with `pnpm build` (or `just build`).

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

- Always run `pnpm build` (or `just build`) after changing `src/`. The global `code-graph` binary is a symlink to `dist/cli.js`.
- Run `code-graph eval` from the pilot dir before shipping retrieval changes — Layer-A regressions surface fastest there.
- `bootstrap` is idempotent (`CREATE TABLE IF NOT EXISTS`), but it will not migrate an existing store. A schema change means bumping `SCHEMA_VERSION` and deleting `scribe-output/graph.db`, then re-running `extract` + `apply`.
- The traversal ordering in `queries.ts` (`EDGE_SCAN_ORDER`) reproduces ArangoDB's reverse edge-index scan. It looks arbitrary because it is, but it decides which edge represents a vertex after de-duplication — changing it changes `impact` and `vertex` output.
- `node:sqlite` binds anonymous `?` placeholders only; numbered `?1`/`?2` raise "column index out of range".
- Edits to `extract.ts` change `contentHash` for affected vertices → drift report will show "changed" until apply runs.
- The destructured store-action resolution in `extract.ts` (`resolveToVertexKey` → `BindingElement` path) is load-bearing for impact queries through hooks. Keep it when refactoring.

## Pilot project

`~/Documents/gits/lichens-ordonnancement-ui` — first onboarded consumer. Do not commit changes there from this repo. The pilot's `scribe.config.json` + `scribe-output/` + `eval/results-*.json` live in that consumer dir, not here.

## Phase status

- Phases 1–8: complete. See `docs/implementation/`.
- Layer-A eval: 4/4 green.
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
- Eval harness (`eval/tasks.json`) is the regression-safety net — keep it green.
