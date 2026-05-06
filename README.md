# code-graph

Graph-based code intelligence for Claude Code. Extracts a typed graph of your TypeScript/React codebase — functions, hooks, stores, edges — stores it in ArangoDB, and exposes hybrid BM25 + multi-hop retrieval through a `/graph` slash command.

One query returns: the SKILL.md invariants, precisely scoped code vertices with file/line, and cross-concept side effects — as a single dense markdown dump that Claude Code can act on immediately.

## Docs

- [Installation](docs/installation.md) — prerequisites, dev install (`pnpm link --global`), Claude Code plugin registration.
- [Usage](docs/usage.md) — `scribe.config.json`, bootstrap → extract → enrich → apply → search.
- [Development](docs/development.md) — repo layout, build, link, test loop.
- [Implementation phases](docs/implementation/) — phase-by-phase build plan ([plan.md](docs/implementation/plan.md), [phase-1](docs/implementation/phase-1.md) … [phase-8](docs/implementation/phase-8.md)).

## Eval harness

Layer-A deterministic eval — regression-safe, no Claude session needed:

```sh
code-graph eval
# reads eval/tasks.json (project root) or code-graph/eval/tasks.json (fallback)
# writes eval/results-<iso>.json
```

`eval/tasks.json` shape:

```json
[
  {
    "id": "task-id",
    "prompt": "natural language query",
    "mode": "search",
    "expected": {
      "concepts_in_top_clusters": ["workorder-store"],
      "vertices_in_top_k": [{ "name": "MyFn", "k": 10 }],
      "skill_present": true,
      "min_cross_concept_edges": 0
    }
  }
]
```

Add `"skip_until_concept": "concept-name"` to defer tasks needing a second concept.

## Quick commands (justfile)

```sh
just            # list recipes
just up         # start ArangoDB
just bootstrap  # init DB for pilot project
just refresh    # extract + apply for default concept
just search QUERY="sync sends stale ops"
just eval       # Layer-A regression eval
```

Override pilot dir / concept: `PILOT_DIR=… CONCEPT=… just …`.
