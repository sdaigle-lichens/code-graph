# CLAUDE.md

Project-level guide for Claude Code working inside this repo.

## What this project is

`code-graph` — CLI + Claude Code plugin for graph-based code intelligence over TypeScript/React projects. Extracts vertices (functions, hooks, components, stores, types, effects) and edges (calls, mounts, reads, writes, has-type, uses-hook, documented-by, agent-authored cross-concept refs) into ArangoDB, then exposes hybrid retrieval through `/graph`.

## Repo layout

```
src/
  cli.ts                # commander entrypoint, all subcommands
  config.ts             # scribe.config.json loader
  schema.ts             # Vertex/Edge/Doc Zod schemas
  scribe/
    bootstrap.ts        # DB + collections + indexes + ArangoSearch view
    db.ts               # arangojs client wiring
    extract.ts          # ts-morph AST walk → vertices + edges (.ast.json)
    apply.ts            # diff DB vs ast.json/enriched.json, drift, upsert
  query/
    preflight.ts        # connectivity + project DB sanity
    queries.ts          # concept / impact / cross / vertex AQL
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

- **One DB per project** — `dbName = config.project`. Never cross databases.
- **Vertex `_key`** — `sha1(concept::filepath::name::type).slice(0,32)` — deterministic, survives rename via drift detection.
- **`status: "live" | "archived"`** — never hard-delete; apply marks missing vertices archived.
- **Agent fields** — `purpose`, `inputs`, `outputs`, `cross_concept_refs`, `document_ref`, `tags` are written ONLY by enrichment, preserved verbatim across re-extracts. `agent.stale = true` flags purpose drift on body change.
- **Edge dedup** — `eKey = sha1(from|to|type|line)`. Re-apply replaces all AST edges; agent-authored edges (`agent.authored_by != null`) are upserted separately.
- **Skill ingestion** — `concept.skill` markdown ingested as a `docs/<concept>::skill` vertex with `documented-by` edges to every live vertex in the concept.
- **ArangoSearch view** — `code_search_view` indexes `vertices(name, purpose, tags)` + `docs(body_md)` with `text_en`. Seed query uses TOKENS-based matching (NOT PHRASE) so multi-word natural-language queries hit.

## CLI exit codes

| Code | Meaning |
|------|---------|
| 0 | OK |
| 1 | Usage / config error |
| 2 | ArangoDB unreachable |
| 4 | Ambiguous symbol — disambiguate with `concept::name` or `filepath:name` |
| 6 | No results / vertex not found |

`/graph` slash command falls back to Explore agent on exit 2 or 6.

## Working in this repo

- Always run `pnpm build` (or `just build`) after changing `src/`. The global `code-graph` binary is a symlink to `dist/cli.js`.
- Run `code-graph eval` from the pilot dir before shipping retrieval changes — Layer-A regressions surface fastest there.
- Don't rebootstrap the pilot DB casually; `bootstrap` is idempotent but the view is only created if missing — schema changes to the view need manual drop or a fresh DB.
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
