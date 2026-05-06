# Usage

## Quickstart

### 1. Write `scribe.config.json` in your project root

```json
{
  "project": "my-app",
  "tsconfig": "tsconfig.app.json",
  "skillsDir": ".claude/skills",
  "concepts": {
    "workorder-store": {
      "globs": ["src/store/workorder.store.ts", "src/utils/workorder-store.ts"],
      "skill": ".claude/skills/workorder-store/SKILL.md"
    }
  }
}
```

### 2. Start ArangoDB

```sh
code-graph up        # starts Docker container
```

### 3. Bootstrap the project DB

```sh
code-graph bootstrap
```

### 4. Extract AST

```sh
code-graph extract workorder-store
# writes scribe-output/workorder-store.ast.json
```

### 5. Enrich (agent step)

In a Claude Code session with the plugin loaded:

```
/scribe-enrich workorder-store
```

This starts a subagent that reads the AST, adds semantic enrichment (purpose, cross-concept refs, tags), and writes `scribe-output/workorder-store.enriched.json`.

### 6. Apply to graph

```sh
code-graph apply workorder-store
```

Upserts vertices, edges, and skill doc into ArangoDB. Shows drift summary.

### 7. Search

```sh
code-graph search "sync sends stale ops"
```

Or from inside Claude Code:

```
/graph sync sends stale ops
```

## CLI Reference

| Command                               | Example                                                              | Description                                               |
| ------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------- |
| `code-graph up`                       | `code-graph up`                                                      | Start ArangoDB via Docker Compose                         |
| `code-graph down`                     | `code-graph down`                                                    | Stop ArangoDB                                             |
| `code-graph status`                   | `code-graph status`                                                  | Show DB and collection status                             |
| `code-graph view-db`                  | `code-graph view-db`                                                 | Open ArangoDB web UI in browser                           |
| `code-graph bootstrap`                | `code-graph bootstrap`                                               | Create DB + collections + view for current project        |
| `code-graph extract <concept>`        | `code-graph extract workorder-store`                                 | Extract AST → `scribe-output/<concept>.ast.json`          |
| `code-graph apply <concept>`          | `code-graph apply workorder-store`                                   | Apply enriched doc to graph (upsert + drift check)        |
| `code-graph drift <concept>`          | `code-graph drift workorder-store`                                   | Show drift without applying (alias for `apply --dry-run`) |
| `code-graph search "<query>"`         | `code-graph search "sync sends stale ops"`                           | Hybrid BM25 + multi-hop search                            |
| `code-graph query concept <name>`     | `code-graph query concept workorder-store`                           | Query a concept subgraph                                  |
| `code-graph query impact <symbol>`    | `code-graph query impact setWorkorderIndex`                          | Query impact of a symbol                                  |
| `code-graph query cross <a> <b>`      | `code-graph query cross workorder-store scheduler-store`             | Query cross-concept relationships                         |
| `code-graph query vertex <location>`  | `code-graph query vertex setWorkorderIndex`                          | Query vertex by location, name, or qualified name         |
| `code-graph query file <filepath>`    | `code-graph query file src/store/workorder.store.ts`                 | Query all live vertices in a file with their edges        |
| `code-graph eval [--tasks <path>]`    | `code-graph eval --tasks eval/tasks.json`                            | Run layer-A eval harness                                  |

### `query vertex` calling forms

The `<location>` argument supports four forms. Detection: if the segment after the last `:` is numeric, it's filepath:line. Otherwise it's a name lookup.

| Form | Example | When to use |
|------|---------|-------------|
| `<filepath>:<line>` | `code-graph query vertex src/store/workorder.store.ts:42` | Jump to vertex covering a specific line — e.g. from editor cursor or a stack trace |
| `<name>` | `code-graph query vertex setWorkorderIndex` | Quick lookup by symbol name — exits 4 with candidate list if ambiguous |
| `<concept>::<name>` | `code-graph query vertex workorder-store::setWorkorderIndex` | Disambiguate when the same name exists in multiple concepts |
| `<filepath>:<name>` | `code-graph query vertex src/utils/workorder-store.ts:setWorkorderIndex` | Disambiguate when the same name exists in multiple files of one concept (e.g. util vs store-action) |

### Common options

- `--max-tokens <n>` — truncation budget (default 3000)
- `--json` — emit structured JSON instead of markdown
- `--direction in|out|both` — impact direction (query impact)

## `/graph` Slash Command

Routing logic (inside `plugin/commands/graph.md`):

- First token is `concept`, `impact`, `cross`, or `vertex` → `code-graph query <args>`
- Otherwise → `code-graph search "<args joined>"`

## `scribe.config.json` Reference

```json
{
  "project": "string", // ArangoDB database name
  "tsconfig": "string", // path to tsconfig (relative to config root)
  "skillsDir": "string", // optional: base dir for SKILL.md files
  "concepts": {
    "<concept-name>": {
      "globs": ["src/**/*.ts"], // files to include in this concept
      "skill": "path/SKILL.md" // optional: SKILL.md path for this concept
    }
  }
}
```

## Troubleshooting

| Exit code | Meaning                 | Fix                                          |
| --------- | ----------------------- | -------------------------------------------- |
| 2         | ArangoDB unreachable    | `code-graph up`                              |
| 3         | DB not found            | `code-graph bootstrap`                       |
| 4         | Ambiguous symbol        | Qualify with concept: `impact concept::name` |
| 5         | No `scribe.config.json` | Create one at project root                   |
| 6         | Zero search results     | Rephrase query or use Explore agent          |

## Zed editor LSP

Surfaces code-graph metadata as hovers, code-lens, and jump-to-definition in TS/TSX/JS/JSX buffers.
