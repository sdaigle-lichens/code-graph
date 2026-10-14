# Usage

## Quickstart

### 1. Write `scribe.config.json` in your project root

In a Claude Code session with the plugin loaded, the `create-concept-skills` skill (or its alias
`/code-graph-init`) does this for you: it runs `code-graph catalog --json`, proposes concepts for
per-concept approval, writes the config and a SKILL.md skeleton per concept, and stamps them at 1.0.
By hand:

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

### 2. Create the project store

```sh
code-graph bootstrap
```

### 3. Extract AST

```sh
code-graph extract workorder-store
# writes scribe-output/workorder-store.ast.json
```

### 4. Enrich (agent step)

In a Claude Code session with the plugin loaded:

```
/scribe-enrich workorder-store
```

This starts a subagent that reads the AST, adds semantic enrichment (purpose, cross-concept refs, tags), and writes `scribe-output/workorder-store.enriched.json`.

### 5. Apply to graph

```sh
code-graph apply workorder-store
```

Upserts vertices, edges, and skill doc into the store, in one transaction. Shows drift summary.

### 6. Search

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
| `code-graph status`                   | `code-graph status`                                                  | Show store path, schema version, integrity and row counts |
| `code-graph bootstrap`                | `code-graph bootstrap`                                               | Create the graph store for the current project            |
| `code-graph reindex`                  | `code-graph reindex`                                                 | Rebuild the full-text index from the stored graph         |
| `code-graph extract <concept>`        | `code-graph extract workorder-store`                                 | Extract AST → `scribe-output/<concept>.ast.json`          |
| `code-graph apply <concept>`          | `code-graph apply workorder-store`                                   | Apply enriched doc to graph (upsert + drift check)        |
| `code-graph drift <concept>`          | `code-graph drift workorder-store`                                   | Show drift without applying (alias for `apply --dry-run`) |
| `code-graph search "<query>"`         | `code-graph search "sync sends stale ops"`                           | Hybrid BM25 + multi-hop search                            |
| `code-graph query concept <name>`     | `code-graph query concept workorder-store`                           | Query a concept subgraph                                  |
| `code-graph query impact <symbol>`    | `code-graph query impact setWorkorderIndex`                          | Query impact of a symbol                                  |
| `code-graph query cross <a> <b>`      | `code-graph query cross workorder-store scheduler-store`             | Query cross-concept relationships                         |
| `code-graph query vertex <location>`  | `code-graph query vertex setWorkorderIndex`                          | Query vertex by location, name, or qualified name         |
| `code-graph query file <filepath>`    | `code-graph query file src/store/workorder.store.ts`                 | Query all live vertices in a file with their edges        |
| `code-graph catalog --json`           | `code-graph catalog --json --tsconfig tsconfig.app.json`             | Store-free ts-morph digest: units, exports, imports, fan-in/out, hubs (drives concept proposals) |
| `code-graph delete-concept <name>`    | `code-graph delete-concept workorder-store --yes`                    | Archive a concept's vertices/edges, remove it from config and artifacts |
| `code-graph eval [--tasks <path>]`    | `code-graph eval --tasks eval/tasks.json`                            | Run layer-A eval harness                                  |

### `skills` commands (concept skills, no graph needed)

Layer 1: these read SKILL.md markers (`metadata.type: concept-skill`, `version`, `last-update`) and
the `skills` block of `scribe.config.json`. They work in any repo — no store, no TypeScript, no
`node_modules`. Every one takes `--root <dir>` (default: `$CLAUDE_PROJECT_DIR`, then the nearest
`scribe.config.json`, then cwd).

| Command                                    | Description                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| `code-graph skills list [--json]`          | Every concept skill under every nested `.claude/skills`                     |
| `code-graph skills state`                  | Repo-level list record (`{"present": false}` when none yet)                 |
| `code-graph skills stamp [skill] [--bump minor\|major\|initial] [--sha <sha>]` | Stamp one skill's marker; with no skill, the repo-level `skills` block |
| `code-graph skills check [--json] [--strict]` | Concepts missing a SKILL.md, path mismatches, unmarked and docs-only skills (`--strict` exits 1) |
| `code-graph skills status [--json]`        | Per-concept version, last-update and commits since, over its globs          |
| `code-graph skills agents`                 | The agents list agent notes may be written for (JSON array)                 |
| `code-graph skills agents-discover`        | Agents the project has (`.claude/agents` + maestro.json), read-only         |
| `code-graph skills agents-set [names...]`  | Replace the agents list (no names empties it)                               |

Versions are `major.minor`: `initial` writes 1.0, a list-wide update bumps the minor, a single-concept
deep pass bumps the major. **A repo-level `skills stamp` without `--bump` defaults to `initial` and
resets the version to 1.0** — pass `--bump minor|major` when migrating an existing list (e.g. from
`.claude/concept-skills.json`).

### Concept-skill skills (plugin)

The plugin wraps the `skills` commands in skills that call only its bundled CLI
(`plugin/scripts/code-graph.cjs`). All work with no tsconfig; staleness then comes from the git-diff
window of `skills status` and the graph steps are skipped.

| Skill | Use | Version effect |
| --- | --- | --- |
| `create-concept-skills` (alias `/code-graph-init`) | No list yet: catalog → proposal → `scribe.config.json` + SKILL.md skeletons → `bootstrap`/`extract`/`apply` | repo and skills stamped `1.0` (`--bump initial`) |
| `update-concept-skills` | List exists, code moved: `skills status --json` / `drift --json`, revise, `extract` + `apply`, re-enrich revised | `--bump minor` |
| `update-single-concept-skill` | One thin skill or a reported gap: deepen from `query concept` / `impact` | `--bump major` |
| `scribe` | Skill vs `docs/` placement; extract + apply after a SKILL.md; gap channel; `/scribe-enrich` procedure | none |
| `cleanup-skill`, `load-concept-skills`, `explore-concept-skills` | Building blocks the flows call | none |
| `code-architecture-design`, `use-code-architecture-design-check` | Design gate and brief; explore uses `query cross` / `impact` | none |
| `code-graph-install` / `-update` / `-uninstall` | Enable/check/disable the plugin per project; install migrates `.claude/concept-skills.json` into `scribe.config.json` keeping its version | none |

`add-concept` hands off to `update-single-concept-skill` for the new concept's SKILL.md.

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
  "project": "string", // project name, used in messages and skills
  "dbPath": "string", // optional: store location, default scribe-output/graph.db
  "tsconfig": "string", // path to tsconfig (relative to config root)
  "skillsDir": "string", // optional: base dir for SKILL.md files
  "concepts": {
    "<concept-name>": {
      "globs": ["src/**/*.ts"], // files to include in this concept
      "skill": "path/SKILL.md" // optional: SKILL.md path for this concept
    }
  },
  "skills": {
    // optional: concept-skill list state, written by `code-graph skills stamp` / `agents-set`
    "version": "1.2", // major.minor
    "last_update": "<sha>", // commit the list was last reconciled against
    "agents": [] // agents that may get agent notes
  }
}
```

A legacy `.claude/concept-skills.json` is still read as a per-field fallback for `skills`; it is never
written, and the first write of the block seeds from it. Commit the block — `last_update` describes
the repo's history.

## Troubleshooting

| Exit code | Meaning                 | Fix                                          |
| --------- | ----------------------- | -------------------------------------------- |
| 2         | *retired*               | Was "ArangoDB unreachable"; no longer emitted |
| 3         | Store written by a newer code-graph | Upgrade the CLI                  |
| 4         | Ambiguous symbol        | Qualify with concept: `impact concept::name` |
| 5         | No `scribe.config.json` | Create one at project root                   |
| 6         | Zero search results     | Rephrase query or use Explore agent          |

## Zed editor LSP

Surfaces code-graph metadata as hovers, code-lens, and jump-to-definition in TS/TSX/JS/JSX buffers.
