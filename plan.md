# Plan — Code-Concept Graph (ArangoDB) — Workorder Store Pilot

## Context

The user wants to implement the code-graph project: a graph database that can map any local git project's main concepts to their constituent code sections and be used as a code exploration tool by Claude Code.

Goal: at task time, Claude Code queries the graph to retrieve **only** the code needed for the task — better than prose-only skills, better than a generic Explore pass, because multi-hop traversal and cross-concept intersection are native. The graph does **not** replace the skills. Skills stay authoritative for prose, graph is authoritative for locations and relationships.

To test the validity of the idea, the `~/Documents/gits/lichens-ordonnancement-ui` project is used as a test codebase to ingest into the graph database. The lichens-ordonnancement-ui project already has 7 hand-authored skills in `~/Documents/gits/lichens-ordonnancement-ui/.claude/skills/<name>/SKILL.md` encoding prose/invariants/algorithms.

## Structure

code-graph main sections:

- **Claude Code plugin** — hosts the scribe skill, usable across all projects via `/plugin install code-graph`. Extensible — easy to add more skills to code-graph later.
- **Scribe** — ts-morph paired with the subagent skill to ingest the targeted project into ArangoDB. ts-morph extracts structural vertices/edges deterministically; Claude Code subagent enriches with concept tags, purpose prose, cross-concept links.
- **Query CLI** — global binary via `npm i -g code-graph`.
- **Docker stack (ArangoDB)** — uses local Docker Desktop.

Graph database structure:

- Each concept = subgraph
- Vertices = code sections (functions, components, hooks, types, store slices)
- Edges = relationships (calls, reads, writes, mounts, subscribes, delegates-to, cross-concept)

**Per-project ArangoDB database** — each ingested project gets its own database named after the project. Code ingestion and search are scoped by project (isolation via DB, not via a `project` field). Bootstrap runs per project, not per machine.

## Decisions locked by the user

- Query path = CLI binary `code-graph` + Claude Code slash command (no MCP in phase 1)
- Incremental build — one concept at a time, pilot concept = **workorder store** (inside `lichens-ordonnancement-ui`)
- Tool autonomy — everything infra-shaped lives in `code-graph` repo; consumer repos get `scribe.config.json` + `scribe-output/` only
- Consumer project files — `scribe.config.json` + `scribe-output/` committed at consumer repo root. Fine to be visible in the repo.
- **Per-project ArangoDB database** (DB name = project name), not shared multi-tenant DB.
- Search layer = deterministic hybrid retrieval (BM25 via ArangoSearch + graph traversal + skills-as-docs). Agentic/LangChain layer deferred to phase 2.

## Setup

The code-graph project uses **pnpm**, already installed.
Project type: `module`.

Libraries already installed in `code-graph/`:

- `ts-morph`
- `arangojs`
- `tsx`

Still to add (devDeps): `typescript`, `@types/node`, plus runtime: `zod` (config validation), `commander` or `yargs` (CLI arg parsing).

Not yet installed: Docker ArangoDB (local Docker Desktop), no `.claude/agents/` or `.claude/commands/` directories in consumer, no git hooks.

## Repo split — what lives where

### `code-graph/` (autonomous repo at `~/Documents/gits/code-graph`)

```
code-graph/
├── package.json                     # "bin": { "code-graph": "dist/cli.js" }, "type": "module"
│                                    # + Claude Code plugin manifest at plugin/plugin.json
├── tsconfig.json
├── docker-compose.arangodb.yml      # local ArangoDB (single instance hosts many project DBs)
├── src/
│   ├── cli.ts                       # subcommand dispatcher
│   ├── scribe/
│   │   ├── bootstrap.ts             # per-project DB + collections + graph + indexes + search view (idempotent)
│   │   ├── extract.ts               # ts-morph → <c>.ast.json (reads SKILL.md into ast.json.skill)
│   │   ├── apply.ts                 # diff + drift + upsert; auto-bootstraps DB if missing
│   │   └── db.ts                    # arangojs client singleton, resolves DB from scribe.config.json project name
│   ├── query/
│   │   ├── run.ts                   # AQL executor + mode dispatch
│   │   ├── format.ts                # markdown formatter + token budget
│   │   ├── queries.ts               # typed AQL for concept/impact/cross/vertex modes
│   │   └── search.ts                # hybrid BM25 + traversal pipeline
│   ├── config.ts                    # walk CWD upward for scribe.config.json, parse, validate (zod)
│   └── schema.ts                    # shared TS types: Vertex, Edge, AstDoc, EnrichedDoc
├── plugin/                          # Claude Code plugin — discovered by /plugin install
│   ├── plugin.json                  # manifest: name, version, skills[], commands[]
│   ├── skills/
│   │   └── scribe-code-graph/
│   │       └── SKILL.md             # enrichment subagent
│   └── commands/
│       ├── graph.md                 # /graph — routes to search or query
│       └── scribe-enrich.md         # /scribe-enrich <concept>
├── test/
└── README.md
```

**CLI surface** (all CWD-aware — resolve project from nearest `scribe.config.json`; DB auto-derived from project name):

```
code-graph up                        # docker compose up -d
code-graph down                      # docker compose down
code-graph bootstrap                 # create DB (named after current project) + collections + graph + indexes + search view — idempotent
code-graph extract <concept>         # ts-morph pass; reads + embeds SKILL.md body into ast.json
code-graph apply <concept> [--dry-run] [--approve-drift]   # auto-bootstraps DB if absent
code-graph drift <concept>           # alias for apply --dry-run
code-graph search "<natural language>"                     # primary retrieval mode
code-graph query concept <name> [--depth=1] [--max-tokens=3000] [--json] [--no-skill]
code-graph query impact <symbol> [--direction=in|out|both] [--max=20]
code-graph query cross <conceptA> <conceptB>
code-graph query vertex <filepath>:<line>
code-graph status                   # DB reachable? which project DB is current? how many concepts onboarded?
```

**Environment** (read by CLI):

- `ARANGO_URL` (default `http://localhost:8529`)
- `ARANGO_DB` (override; if unset, auto-derived from `scribe.config.json` `project` name)
- `ARANGO_USER` / `ARANGO_PASSWORD` (default none — local dev, no auth)
- `CODE_GRAPH_HOME` (default `~/.code-graph`) — reserved for future state, unused in v1

### Consumer project touchpoints (minimal)

For `lichens-ordonnancement-ui` and any future consumer:

```
scribe.config.json                  # project name + concept → globs + skill path
scribe-output/                      # committed artifacts
  ├─ <concept>.ast.json
  ├─ <concept>.enriched.json
  └─ <concept>.drift.json           # gitignored (transient)
.gitignore                          # add scribe-output/*.drift.json
```

No scripts added to consumer's `package.json`, no devDependencies added to consumer, no `scripts/` directory. Consumer invokes `code-graph <cmd>` directly (global binary on PATH). Optional: add `just` recipes for discoverability — user's call.

**`scribe.config.json` schema:**

```json
{
  "project": "lichens-ordonnancement-ui",
  "tsconfig": "tsconfig.app.json",
  "skillsDir": ".claude/skills",
  "concepts": {
    "workorder-store": {
      "globs": [
        "src/store/workorder.store.ts",
        "src/utils/workorder-store.ts",
        "src/utils/workorder.ts",
        "src/commons/schedule-workorder.ts",
        "src/commons/workorder-operation.ts",
        "src/hooks/dnd-workorder/use-dnd-workorder-list.ts",
        "src/hooks/dnd-gantt/use-gantt-workorder-drag.ts",
        "src/routes/_authenticated/$siteid/scheduler/schedulers.tsx",
        "src/routes/_authenticated/$siteid/scheduler/sector-equipment.tsx",
        "src/routes/_authenticated/$siteid/scheduler/workorder-card.tsx",
        "src/routes/_authenticated/$siteid/scheduler/workorder-list-item.tsx",
        "src/routes/_authenticated/$siteid/scheduler/workorder-details.tsx"
      ],
      "skill": ".claude/skills/workorder-store/SKILL.md"
    }
  }
}
```

## Distribution

**v1: global npm install of a published package.**

End-user install (per machine):

```
npm i -g code-graph                  # or: pnpm add -g code-graph
```

Claude Code plugin registration (per machine, once):

```
/plugin install code-graph           # registers skill + /graph + /scribe-enrich from installed package
```

Plugin resolution: the npm package ships a `plugin/plugin.json` manifest. `/plugin install code-graph` resolves the globally installed package, reads the manifest, and wires the bundled skill + slash commands into Claude Code. Adding more skills later = append to `plugin.json`, bump version, republish, user re-runs `/plugin install code-graph` to pick up the update.

**Dev flow** (for the `code-graph` repo itself):

```
cd ~/Documents/gits/code-graph
pnpm install && pnpm build
pnpm link --global                   # local dev — binary on PATH from the repo
/plugin install code-graph           # points at the linked package
```

**Publishing target:** public npm if OSS, private registry (GitHub Packages / npm private) otherwise. Decide at publish time; does not affect architecture.

## Architecture (4 pieces)

```
┌───────────────────┐     ┌──────────────────────┐     ┌────────────────────┐
│ code-graph        │────▶│ <consumer>/          │────▶│ code-graph         │────▶ ArangoDB (docker)
│ extract (ts-morph)│     │  scribe-output/      │     │ apply              │     per-project DBs
└───────────────────┘     │  <c>.ast.json        │     │ (diff + drift gate)│     on single instance
         ▲                │  <c>.enriched.json   │     └────────────────────┘
         │                └──────────────────────┘              ▲
    Consumer                         ▲                          │
    source files +          ┌────────┴────────┐          ┌──────┴──────┐
    SKILL.md                │ Claude subagent │          │ code-graph  │
                            │ (enrich)        │          │ search /    │
                            └─────────────────┘          │ query (AQL) │
                                                         └─────────────┘
                                                                ▲
                                                                │
                                              /graph <mode> <args>
                                              (plugin: plugin/commands/graph.md)
```

## Schema (ArangoDB) — per-project database

**Database:** `<project-name>` (e.g. `lichens-ordonnancement-ui`). Auto-created on first `bootstrap` or first `apply`. DB name comes from `scribe.config.json` `project`. Single ArangoDB instance hosts many project DBs.

**Graph:** `code_graph` (one per DB).

**Collections (per DB):**

- `vertices` (document) — code-section vertices
- `edges` (edge) — all relationships
- `docs` (document) — **first-class**. One doc per concept's SKILL.md (`_key = "<concept>::skill"`), body = SKILL.md verbatim, plus any long-form `purpose` overflow (>400 chars)
- `concepts` (document) — `_key = "<concept>"`, owner skill path, `last_scribed_at`

No `projects` collection — DB is the project.

**Indexes:** persistent on `vertices(concept, type)`, persistent on `vertices.name`, persistent on `edges.type`.

**ArangoSearch view `code_search_view`** (per DB) — analyzes:

- `vertices.purpose`, `vertices.name`, `vertices.tags` (text_en analyzer)
- `docs.body_md` (text_en analyzer with markdown stripping)

Powers BM25 retrieval for `search` mode. Created in bootstrap.

**Vertex schema:**

```json
{
  "_key": "<sha1(concept::filepath::name::kind) 32-char hex>",
  "displayKey": "workorder-store::store-action::setWorkorderIndex",
  "concept": "workorder-store",
  "type": "store|store-state|store-action|function|hook|component|type-def|callsite|effect",
  "name": "setWorkorderIndex",
  "filepath": "src/store/workorder.store.ts",
  "start_line": 57,
  "end_line": 69,
  "signature": "(equipmentId, workorderId, newIndex) => void",
  "contentHash": "sha256:...",

  "purpose": "Reorder workorder within equipment lane; delegates to util.",
  "inputs": ["equipmentId:string", "workorderId:string", "newIndex:number"],
  "outputs": ["mutates:workordersByEquipment", "mutates:workorderOperations"],
  "cross_concept_refs": ["scheduler-store", "schedule-utils"],
  "document_ref": null,
  "tags": ["reorder", "dnd-target"],

  "status": "live",
  "ast":   { "extracted_at": "...", "extractor_version": "code-graph@0.1.0" },
  "agent": { "authored_by": "claude", "authored_at": "...", "stale": false, "sig_seen": "..." }
}
```

Project identity = implicit (which DB the doc lives in). No `project` field on vertex.

**AST-owned (overwritten every extract):** `filepath, start_line, end_line, signature, contentHash, type, name, displayKey, ast.*`
**Agent-owned (preserved across extracts):** `purpose, inputs, outputs, cross_concept_refs, document_ref, tags, agent.*`
**Staleness:** AST re-extraction change in `contentHash` → apply flips `agent.stale = true`. Agent revisits next enrich.

**Edge schema:**

```json
{
  "_key": "<sha1(from|to|type|line)>",
  "_from": "vertices/<hash>|docs/<key>|concepts/<key>",
  "_to":   "vertices/<hash>|docs/<key>|concepts/<key>",
  "type": "calls|reads|writes|mounts|subscribes|uses-hook|delegates-to|has-type|triggers|describes|documented-by",
  "concept": "workorder-store",
  "crosses_concept": false,
  "reason": "Action wraps util that returns new maps atomically.",
  "lifecycle": "useEffect|handler|mount|callback|null",
  "line": 77,
  "ast":   { "extracted_at": "..." },
  "agent": { "authored_by": null }
}
```

`crosses_concept` auto-derived from endpoints (from/to concept diff). AST owns structural edges (`calls, reads, writes, mounts, uses-hook, has-type`) + doc-link edges (`describes, documented-by`). Agent owns semantic edges (`delegates-to, triggers`) + `reason` on any edge.

**Skills-as-docs edge types:**

- `describes` — `docs/<concept>::skill` → `concepts/<concept>`. One per concept.
- `documented-by` — `vertices/<v>` → `docs/<concept>::skill`. Auto-emitted for every vertex in the concept.

**Stable `_key` across renames:** apply detects AST vertex with no DB match + DB vertex with no AST match at same `(filepath, kind)` with ≥0.8 text similarity → `renamed` drift candidate. User approves → copies agent fields old→new `_key`, archives old.

**Soft-delete:** `status: "archived"` + `archivedAt`. Never hard-deleted in v1. Resurrection preserves agent fields.

## Skill + slash commands — shipped via Claude Code plugin

Package bundles a plugin at `<code-graph>/plugin/`:

```
plugin/
├── plugin.json
├── skills/
│   └── scribe-code-graph/SKILL.md
└── commands/
    ├── graph.md              # /graph
    └── scribe-enrich.md      # /scribe-enrich <concept>
```

**Manifest sketch (`plugin.json`):**

```json
{
  "name": "code-graph",
  "version": "0.1.0",
  "description": "Code-concept graph — scribe + query for Claude Code",
  "skills": [{ "path": "skills/scribe-code-graph" }],
  "commands": [
    { "path": "commands/graph.md" },
    { "path": "commands/scribe-enrich.md" }
  ]
}
```

**User flow:** `npm i -g code-graph` → `/plugin install code-graph` → skill + commands live. One install, all projects. Upgrade = republish + re-run `/plugin install code-graph`.

**Subagent boundaries** (`scribe-code-graph` skill):

- Tools: `Read, Glob, Grep` only
- Writes: only `<cwd>/scribe-output/<concept>.enriched.json`
- Must NOT touch AST-authoritative fields
- Inputs: concept name, astPath (CWD-relative), skillPath (from scribe.config.json), outPath
- Output fields: `purpose, cross_concept_refs, document_ref, tags, sig_seen` per vertex; `reason` on semantic edges

**`/graph` slash command** — default routes to `code-graph search $ARGUMENTS`. If first arg is `concept|impact|cross|vertex`, routes to `code-graph query $ARGUMENTS` instead. Skill prose arrives inline in search output (no separate skill Read needed). On exit 2/3/5/6, falls back to Explore agent.

**`/scribe-enrich <concept>`** — invokes the `scribe-code-graph` skill with concept arg + resolved paths.

## Pipeline

**One-time per machine:**

1. Install package — `npm i -g code-graph` (or `pnpm add -g code-graph`), or dev: `cd ~/Documents/gits/code-graph && pnpm install && pnpm build && pnpm link --global`
2. `/plugin install code-graph` inside Claude Code → skill + `/graph` + `/scribe-enrich` registered
3. `code-graph up` → Docker ArangoDB on `localhost:8529`

**Per consumer project (one-time):**

1. Write `scribe.config.json` at repo root with project name + concept map
2. Add `scribe-output/*.drift.json` to `.gitignore`
3. `code-graph bootstrap` → creates DB `<project-name>` + collections + graph + indexes + ArangoSearch view (idempotent). Also runs automatically on first `apply` if DB missing.

**Per concept (ingestion flow):**

1. `cd <consumer-repo> && code-graph extract <concept>` → `scribe-output/<concept>.ast.json`
   - ts-morph walks source, emits structural vertices + edges
   - Also reads the concept's SKILL.md (path from `scribe.config.json`), embeds body + contentHash into ast.json as `skill: { path, body, contentHash }`
2. In Claude Code at consumer repo: `/scribe-enrich <concept>` → subagent writes `<concept>.enriched.json` (semantic fields only)
3. `code-graph apply <concept>` → drift report → upsert
   - Upserts vertices + edges
   - Upserts one `docs` vertex per concept from SKILL.md body
   - Auto-emits `describes` edge (doc → concept) + `documented-by` edges (vertex → doc) for every vertex in the concept

**Per search (consumption flow):**

4. Claude Code (or user) runs `code-graph search "<natural language>"` → one dense markdown dump. See §Search flow below.

## Search flow — hybrid retrieval + multi-hop chaining

Primary surface: `code-graph search "<natural language>"`. Goal: one CLI call → dense markdown with skill prose + precisely scoped vertices + cross-concept side effects. Claude Code does minimal retrieval reasoning.

**Pipeline:**

```
1. Parse query string → tokens
2. BM25 search via ArangoSearch view `code_search_view`:
   - score = BM25(vertices.purpose) + BM25(vertices.name, boost 2x) + BM25(vertices.tags, boost 1.5x) + BM25(docs.body_md)
   - top K=10 results (vertices + docs mixed)
3. Seed expansion — for each seed:
   - if seed is a vertex → traverse:
       * parent concept's skill doc (documented-by)
       * 1-hop outbound structural edges (calls, reads, writes, uses-hook)
       * 2-hop inbound impact edges (calls, triggers, delegates-to)
       * cross-concept edges (crosses_concept=true) from this vertex
   - if seed is a doc → include doc + all vertices documented-by it (whole concept)
4. Union + dedupe by _key; re-rank by (BM25 score × 0.7) + (edge-degree × 0.3)
5. Cluster by concept; format markdown
```

**AQL skeleton** (simplified, runs inside project-scoped DB so no project filter):

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
    RETURN d
)
// ... expand via TRAVERSAL per seed ...
```

**Output format** (single markdown dump):

```markdown
# Search: "sync sends stale ops after week nav"

> 3 concepts matched, 8 vertices, 2 skill docs, ~2.4k tokens

## Concept: workorder-store

### Skill (invariants, algorithms, gotchas)

<full SKILL.md body inline>

### Relevant code

- @src/store/workorder.store.ts:107-109 — `clearWorkorderOperations` — resets ops after sync
  - why: "Called after successful API sync to clear pending ops buffer"
  - ← triggered by `Schedulers` sync effect at schedulers.tsx:99-115
- @src/utils/workorder-store.ts:80-118 — `mergeWorkordersByEquipment` — merges API + pending ops
  - why: "Bridges fresh API data with in-flight changes; ops survive week nav"
  - → reads `isWorkorderInSchedulePeriod` (shift-logic)

### Cross-concept side effects

- → **scheduler-store** — sync flow calls `transferWorkorderScheduleEntry`
- → **shift-logic** — period filter via `isWorkorderInSchedulePeriod`
```

**Secondary CLI modes** (lower-level affordances — kept for direct calls when Claude Code knows exactly what it wants):

| Mode      | Signature                                                                 | Use case                                       |
| --------- | ------------------------------------------------------------------------- | ---------------------------------------------- |
| `search`  | `code-graph search "<natural language>"`                                  | **Primary mode.** Hybrid retrieval + chaining. |
| `concept` | `code-graph query concept <name> [--depth=1]`                             | Dump whole concept subgraph                    |
| `impact`  | `code-graph query impact <symbol> [--direction=in\|out\|both] [--max=20]` | "What breaks if I change X?"                   |
| `cross`   | `code-graph query cross <conceptA> <conceptB>`                            | Shared vertices between two concepts           |
| `vertex`  | `code-graph query vertex <filepath>:<line>`                               | Stack trace → neighbors                        |

All modes: `--json`, `--max-tokens=3000` budget (truncate `reason` first, then low-degree leaves, then skill doc body last — skill is highest value). All scoped by current project (resolved from nearest `scribe.config.json` → DB name).

**Failure modes:**

- Exit 2 — DB / ArangoDB server offline. Stderr suggests `code-graph up`.
- Exit 3 — project DB doesn't exist yet (bootstrap not run or wrong CWD). Stderr suggests `code-graph bootstrap`.
- Exit 4 — symbol ambiguous. Stderr lists candidates.
- Exit 5 — no `scribe.config.json` in CWD ancestry. Stderr names expected path.
- Exit 6 — search returns zero hits. Stderr suggests rephrasing or falling back to Explore.

## Dependencies (inside code-graph repo only)

Already installed: `ts-morph`, `arangojs`, `tsx`.

Still to add — devDependencies: `typescript`, `@types/node`. Runtime: `zod`, `commander` or `yargs`.

**No BM25 lib needed** — ArangoSearch provides `BM25()` native in AQL.

**No LangChain / no LLM SDK in v1** — search is deterministic AQL. Agentic layer deferred.

**Consumer repos: zero new dependencies.**

## Critical files — create in `code-graph/` repo

- `code-graph/package.json` (new) — bin entry, deps, build script
- `code-graph/tsconfig.json` (new)
- `code-graph/docker-compose.arangodb.yml` (new)
- `code-graph/src/cli.ts` (new)
- `code-graph/src/scribe/{bootstrap,extract,apply,db}.ts` (new)
- `code-graph/src/query/{run,format,queries,search}.ts` (new) — `search.ts` = hybrid BM25 + traversal pipeline
- `code-graph/src/{config,schema}.ts` (new)
- `code-graph/plugin/plugin.json` (new) — Claude Code plugin manifest
- `code-graph/plugin/skills/scribe-code-graph/SKILL.md` (new)
- `code-graph/plugin/commands/{graph,scribe-enrich}.md` (new)
- `code-graph/README.md` (new)

## Critical files — create in `lichens-ordonnancement-ui` consumer (pilot)

- `scribe.config.json` (new) — see schema above
- `scribe-output/` (new dir, created on first extract)
- `.gitignore` (modify) — add `scribe-output/*.drift.json`

No `scripts/`, no `package.json` script changes, no new devDependencies in consumer.

## Reuse references (don't reimplement)

- `openapi-ts.config.js` — pattern for "input source → generated output"
- `.claude/skills/workorder-store/SKILL.md` — content source for subagent enrichment (pilot)
- `src/store/CLAUDE.md` — store layer invariant (default values) — scribe reads, agent encodes as vertex gotcha

## Pilot scope (workorder-store, inside lichens-ordonnancement-ui)

Files in scope for AST extraction: see `scribe.config.json` `workorder-store.globs` above.

Cross-concept callouts agent tags (edges `workorder-store` → `scheduler-store`, `shift-logic`, `schedule-utils`): `transferWorkorderScheduleEntry`, `setSchedulePeriod`, `isWorkorderInSchedulePeriod`.

## Evaluation — pilot gate before scaling

5 eval tasks on workorder store. Cold Claude Code session, same seed, `/graph` (search) vs. Explore agent:

| # | Prompt | Ideal retrieval | Expected winning mode |
|---|---|---|---|
| 1 | Add `operation: "delete"` variant to WorkorderOperation | workorder-operation.ts, utils upsert+merge, store, update hook | `search` |
| 2 | Why does setWorkorderIndex re-index the whole array? | util setWorkorderIndex, reorderWorkorderOperations, skill invariants | `search` or `impact setWorkorderIndex` |
| 3 | Change week window to include Sunday 00h | isWorkorderInSchedulePeriod, mergeWorkordersByEquipment caller, API query | `search` or `impact isWorkorderInSchedulePeriod` |
| 4 | Gantt doesn't re-render on workorder drag | store subscribers in gantt, setWorkorderIndex, gantt-workorder | `cross workorder-store gantt-render` (needs 2nd concept onboarded — defer) |
| 5 | Sync sends stale ops after week nav | clearWorkorderOperations, mergeWorkordersByEquipment ops-survive-nav, sync hook | `search` |

**Score per task:** (a) files Read before first edit, (b) tokens consumed, (c) edit correctness. **Gate:** 4/5 wins → onboard 2nd concept (shift-logic). 2–3/5 → iterate output format or BM25 boosts. 0–1/5 → rethink scribe quality or add embeddings.

## Verification (end-to-end)

After one-time setup + pilot onboarding:

1. **Binary on PATH** — `which code-graph` returns a path; `code-graph --version` succeeds
2. **Plugin registered** — inside Claude Code, `/graph --help` and `/scribe-enrich --help` resolve; `scribe-code-graph` skill listed in available skills
3. **DB per project** — `code-graph status` reports DB name = `lichens-ordonnancement-ui`; `arangosh --server.database lichens-ordonnancement-ui --javascript.execute-string 'print(db._collections().map(c=>c.name()))'` lists `vertices, edges, docs, concepts`
4. **Vertex count sanity** — `code-graph query concept workorder-store --json | jq '.vertices | length'` → ~15–25
5. **Cross-concept refs present** — at least one vertex has non-empty `cross_concept_refs` (e.g. `updateWorkOrderStartTime` → `scheduler-store`)
6. **Impact correct** — `code-graph query impact setWorkorderIndex --direction=in` returns `useDndWorkorderList`
7. **Re-extract idempotence** — run `code-graph extract workorder-store` twice, `code-graph drift workorder-store` → "no changes"
8. **Drift detection** — rename a function in source, re-extract + apply → `renamed` candidate; reject → DB unchanged
9. **Agent field persistence** — whitespace edit in body → `agent.stale=true` but `purpose` preserved
10. **Skills-as-docs ingested** — `code-graph query concept workorder-store --json | jq '.docs | length'` → 1; `jq '.docs[0].body_md | length'` > 500 (non-empty SKILL.md body)
11. **Doc-link edges present** — AQL `FOR e IN edges FILTER e.type == "documented-by" RETURN e` returns one edge per vertex in the concept
12. **Search hybrid retrieval works** — `code-graph search "sync sends stale ops"` returns markdown with skill prose inline + `clearWorkorderOperations` + `mergeWorkordersByEquipment` in top results (no concept name in query — BM25 seeds it)
13. **Search multi-hop chaining** — same query output includes cross-concept callouts section (scheduler-store, shift-logic)
14. **Slash command integration** — fresh Claude Code session, `/graph sync stale ops` → routes to search, output parses, Claude Code Reads suggested files
15. **Fallback** — `code-graph down`, invoke `/graph ...` → exit 2, Claude Code falls back to Explore
16. **Per-project isolation** — create a throwaway second project with minimal `scribe.config.json` (different `project` name), `code-graph bootstrap` from that CWD → arangosh `db._databases()` shows both DBs; queries from either CWD never cross

Run eval gate only after all 16 verification steps pass.

## Explicitly deferred

- MCP server (phase 2 if graph proves value)
- Additional concepts (shift-logic, gantt-render, etc.) — only after pilot gate
- Git hooks / CI job for auto-scribe — manual invocation only in v1
- **Agentic search layer** — LangChain or Anthropic SDK wrapper over the CLI. Revisit post-pilot if eval shows deterministic hybrid retrieval consistently missing tasks Claude Code can't recover from. Replace or augment `code-graph search` with a multi-step agent that picks queries, chains them, synthesizes. Phase 2.
- Embeddings / vector similarity — BM25 only in v1. Add embeddings if BM25 precision-recall is insufficient on eval tasks.
- Multi-machine shared DB / hosted ArangoDB — single local Docker in v1.
- Cross-project queries — per-project DB makes these impossible by design. Not a goal.
- Migrations system for DB schema — bootstrap is `existsAsync`-gated; evolve via `scribe_meta.schemaVersion` doc (per DB) when first migration is needed.
- `code-graph gc` for true deletion of archived vertices — opt-in later.
