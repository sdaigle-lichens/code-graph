# Usage

## Quickstart

### 1. Write `scribe.config.json` in your project root

In a Claude Code session with the plugin loaded, the `create-concept-skills` skill does this for you: it runs `code-graph catalog --json`, proposes concepts for
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

In a Claude Code session with the plugin loaded, ask for enrichment of the concept (the `scribe`
skill's enrichment procedure; `update-concept-skills` and `update-single-concept-skill` offer it
after a revision), e.g. "enrich workorder-store". This starts a subagent that reads the AST, adds semantic enrichment (purpose, cross-concept refs, tags), and writes `scribe-output/workorder-store.enriched.json`.

### 5. Apply to graph

```sh
code-graph apply workorder-store
```

Upserts vertices, edges, and skill doc into the store, in one transaction. Shows drift summary.

`apply --dry-run --json` (and `drift --json`) prints the drift as one JSON object instead:
`{ concept, new[], changed[], stale[], missing[], renameCandidates[], doc: { bodyHashChanged } }`.
Vertices are `{ name, type, file }`; a rename candidate is `{ from, to, score }`. `--json` without
`--dry-run` exits 1. `changed` compares `<concept>.ast.json` (the last extract) with the store, so
run `extract <concept>` first, then `drift`, to see pending source edits.

A **docs-only** concept (no `tsconfig`, or globs that name no TypeScript files) needs no compiler:
`extract` writes zero vertices plus its skill block, `apply` stores the doc so the SKILL.md body is
searchable, and `search` finds it.

With **no `concepts`** in `scribe.config.json`, `extract`, `apply` and `drift` print
`no concepts configured in scribe.config.json, skipped` and exit 0, loading neither ts-morph nor the
store.

**Where ts-morph comes from.** The plugin bundle does not ship the TypeScript compiler. Graph
commands (`extract`, `catalog`) resolve `ts-morph` (which carries its own compiler) in this order:

1. the plugin-owned deps directory: `$CLAUDE_PLUGIN_DATA/deps` when set, and the per-user cache
   `~/.cache/code-graph/deps/<version>` (both are searched);
2. the project's own install (`<project>/package.json` resolution) as a fallback.

Populate (1) with the explicit `code-graph deps install` (it runs `npm install` and says so);
`code-graph deps status` shows what resolves from where. When neither has ts-morph, the error names
`deps install`. The `skills` commands never need any of this.

### 6. Search

```sh
code-graph search "sync sends stale ops"
```

Or from inside Claude Code:

```
/graph sync sends stale ops
```

Plain-text output groups edges between the same two vertices with the same type into one line. Call-site
lines are listed when the edge carries them (`at file:108 (lines 112, 140, 155)`), otherwise a count
(`×3`); distinct edge reasons are all shown. `--json` stays one entry per stored edge. The `~N tokens`
figure in the totals line is the size of the printed output, after `--max-tokens` trimming. The thin-result enrichment warning is appended after that figure, so
it is not counted in it (~14 tokens).

### Sharing a graph (committing `.ast.json`)

`<concept>.ast.json` is safe to commit: re-running `extract` on an unchanged concept rewrites it
byte-for-byte identical. Vertices and edges carry no per-run timestamps (`apply` stamps the store
with its own time), both lists are sorted by `_key`, and the whole `meta` block
(`extractor_version` + `extracted_at`) is kept as-is when vertices, edges and skill are unchanged.
A code-graph upgrade alone therefore leaves the file untouched. Editing one file touches only that
file's vertices and edges plus `meta`. `skills status` reports `meta.extracted_at` as the time of
the last real change.

`meta.extractor_version` means "the version that last changed this file's content". The file carries
no per-vertex `extractor_version`; `apply` stamps the store's per-vertex `ast.extractor_version` from
`meta`. Older files that still carry per-vertex values keep applying (the per-vertex value wins).
The first `extract` after 0.3.5 rewrites each committed `.ast.json` once (dropping the per-vertex
values); commit that rewrite.

## Plugin surface

Everything a user can invoke from the plugin. `/graph` is the only slash command; the rest are skills
(slash-invocable; the lifecycle trio is hidden from the model and must be typed by the user).

- `/graph <query>` — query the graph (Explore-agent fallback on exit 2/6)
- Concept skills: `create-concept-skills`, `update-concept-skills`, `update-single-concept-skill`,
  `add-concept`, `scribe` (incl. enrichment), `cleanup-skill`, `load-concept-skills`,
  `explore-concept-skills`
- Design: `code-architecture-design`, `use-code-architecture-design-check`
- Retrieval: `code-graph-retrieval`
- Lifecycle: `code-graph-install`, `code-graph-update`, `code-graph-uninstall`

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
| `code-graph deps install`             | `code-graph deps install`                                            | Install pinned ts-morph into the plugin deps directory (`deps status` shows what resolves) |
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
| `create-concept-skills` | No list yet: catalog → proposal → `scribe.config.json` + SKILL.md skeletons → `bootstrap`/`extract`/`apply` | repo and skills stamped `1.0` (`--bump initial`) |
| `update-concept-skills` | List exists, code moved: `skills status --json` / `drift --json`, revise, `extract` + `apply`, re-enrich revised | `--bump minor` |
| `update-single-concept-skill` | One thin skill or a reported gap: deepen from `query concept` / `impact` | `--bump major` |
| `scribe` | Skill vs `docs/` placement; extract + apply after a SKILL.md; gap channel; enrichment procedure | none |
| `cleanup-skill`, `load-concept-skills`, `explore-concept-skills` | Building blocks the flows call | none |
| `code-architecture-design`, `use-code-architecture-design-check` | Design gate and brief; explore uses `query cross` / `impact` | none |
| `code-graph-install` / `-update` / `-uninstall` | Enable/check/disable the plugin per project; install migrates `.claude/concept-skills.json` into `scribe.config.json` keeping its version | none |
| `add-concept` | Add one concept to an existing config via seed-driven expansion (`/add-concept [seed]`) | none (hands off to `update-single-concept-skill` for the SKILL.md) |

`skills status --json` also carries, per concept, a `graph` block when a store exists:
`{ extracted, extractedAt, enriched, vertices, enrichedVertices, changed, stale }` (`changed` is the
same ast.json-vs-store count as `drift`, so extract first). A recorded `last-update` sha that is
malformed or unknown to git yields `unknownFreshness: true` (`reason: "malformed-sha"` or
`"unknown-commit"`, `commitsSince: null`) instead of an error. Docs-only concepts have no `graph` block.

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
  "tsconfig": "string", // optional: path to tsconfig (relative to config root); omit for docs-only repos
  "skillsDir": "string", // optional: base dir for SKILL.md files
  "concepts": {
    "<concept-name>": {
      "globs": ["src/**/*.ts"], // files to include in this concept
      "skill": "path/SKILL.md" // optional: else the marked skill named <concept>, else <skillsDir>/<concept>/SKILL.md
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
