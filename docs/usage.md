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
after a revision), e.g. "enrich workorder-store". It decides from `enrich targets --summary --json`
(below), adds semantic enrichment (purpose, cross-concept refs, tags) and merges it into
`scribe-output/workorder-store.enriched.json`. The main session fans targets out to subagents in
batches; a flow running as a subagent enriches up to 20 targets inline (changed/stale first, then
SKILL-named, then hubs) and reports the rest as "left to enrich" for a main session.

#### Incremental enrichment (`enrich targets`, `enrich merge`)

Enrichment can build up a few vertices at a time. Run `extract <concept>` first (both commands read
`<concept>.ast.json` and say so if it is missing).

- `code-graph enrich targets <concept> [--json]` lists the vertices that need enrichment: changed,
  stale, and **never-enriched** (`new`) ones. It is lazy (since 0.3.12): a never-enriched vertex is a
  target only when it is in the concept's core, was touched by a task since the previous apply, or is
  named with `--vertex`. The rest are counted in `core.leftOut`. Each entry has `key`, `name`, `type`,
  `filepath`, `start_line`, `end_line`, `signature`, the current `purpose`, `reasons`, `core`
  (`true|false`) and `edgesWithoutReason` (outgoing AST edges with no `reason`). The JSON always has
  a top-level `core { size, leftOut, thin, message? }`. Text output tags each entry
  `core`/`non-core`, shows its count of edges without a reason, and ends with the core/leftOut line.
- The **core** is the vertices whose name appears (as a whole identifier, 3+ characters) in the
  concept's SKILL.md, plus in-concept hubs (3+ inbound `calls`/`mounts` edges from other vertices of
  the same concept).
- **Touched.** After a concept's first apply, `apply` stamps `agent.touched_at` on every vertex with
  no purpose that arrives new, with a changed body, or under a new key through an approved rename
  (`--approve-drift` or `y`, since 0.3.13); the first apply stamps nothing (ingesting a
  concept is not a task). So `extract` → `apply` → `enrich targets` lists a vertex a task added or
  edited even when it is non-core and never enriched. A vertex not yet applied, a body differing
  from the store's, or a pre-0.3.12 `agent.stale` also counts as touched.
- `--all` lists every never-enriched vertex (the pre-0.3.12 listing), for whole-concept enrichment.
  `--core` is still accepted as a no-op: core-first is the default.
- `--vertex <name|key>...` narrows the listing to just those vertices, with full details
  (`enrich targets <c> --json --vertex <k>...` is how a batch reads its targets).
- `--summary` (text, or compact JSON with `--json`) gives the total, counts per reason, the `core`
  block, the total of edges without a reason and one short line per target (`key`, `name`, `type`,
  `loc` = `filepath:start-end`, `reasons`, `core`, `edgesWithoutReason` as a count). No edge arrays,
  so it stays a few KB on a concept of 200+ vertices.
- **Thin core.** A concept with 50+ live vertices but fewer than 5 core vertices is `thin`: the
  SKILL.md names too little to enrich from. `enrich targets` reports it (`core.thin`,
  `core.message`) and `gaps` lists it under "thin core"; the flows then route to
  `update-single-concept-skill` to deepen the skill rather than enriching blindly.
- `code-graph enrich merge <concept> <partial.json>` merges a partial enrichment (same entry shapes as
  `.enriched.json`) into `scribe-output/<concept>.enriched.json`. It upserts vertices and edges by
  `_key` (fields merge per entry), keeps every other entry, rejects keys missing from `ast.json`
  (nothing is written), and stamps `sig_seen` and `hash_seen` from the current `ast.json`. The file is
  written sorted by key with stable formatting, so merging N vertices changes about N entries, and
  merging the same partial twice changes nothing. Then run `apply` as usual. (`apply` has no
  `--merge`; use `enrich merge`.)

**Staleness.** `hash_seen` is the vertex `contentHash` the enricher read. After a body edit, `apply`
marks a vertex stale unless its enrichment carries the new hash, so a body-only edit (same signature)
goes stale and `enrich merge` clears it. Entries written before 0.3.6 have only `sig_seen`; for them
the old signature rule still applies, so upgrading does not mass-stale existing enrichment. The
`gaps` completeness check no longer counts a stale description as enriched. The `gaps` ratio is
measured over the core (enriched core / core) when the core is non-empty, else over all live
vertices; the diagnostic then reads "N/M core vertices".

### 5. Apply to graph

```sh
code-graph apply workorder-store
```

Upserts vertices, edges, and skill doc into the store, in one transaction. Shows drift summary.

`apply --dry-run --json` (and `drift --json`) prints the drift as one JSON object instead:
`{ concept, new[], changed[], stale[], missing[], renameCandidates[], doc: { bodyHashChanged } }`.
Vertices are `{ name, type, file }`; a rename candidate is `{ from, to, score }`. `--json` without
`--dry-run` exits 1. `changed` compares `<concept>.ast.json` (the last extract) with the store, so
run `extract <concept>` first, then `drift`, to see pending source edits. The JSON also carries
`unextracted: { changed, new, removed, files[] }`: source files edited, added or deleted since the last
`extract` (counted in files, from `meta.files` in the ast.json); non-zero means run `extract` then
`apply`. It is absent for an ast.json written before 0.3.17.

A **docs-only** concept (no `tsconfig`, or globs that name no TypeScript files) needs no compiler:
`extract` writes zero vertices plus its skill block, `apply` stores the doc so the SKILL.md body is
searchable, and `search` finds it.

With **no `concepts`** in `scribe.config.json`, `extract`, `apply` and `drift` print
`no concepts configured in scribe.config.json, skipped` and exit 0, loading neither ts-morph nor the
store.

**Where ts-morph comes from.** The plugin bundle does not ship the TypeScript compiler. Graph
commands (`extract`, `catalog`) resolve `ts-morph` (which carries its own compiler) in this order:

1. the plugin-owned deps directory: `$CLAUDE_PLUGIN_DATA/deps/<key>` when set, and the per-user cache
   `~/.cache/code-graph/deps/<key>` (both are searched). `<key>` names the pinned deps, e.g.
   `ts-morph@28.0.0`, not the code-graph version, so a plugin update reuses the install and a new
   download happens only when a pin changes. After upgrading from 0.3.7 or earlier, run
   `deps install` once more; the old `deps/0.3.*` folders are never searched and can be deleted;
2. the project's own install (`<project>/package.json` resolution) as a fallback.

Populate (1) with the explicit `code-graph deps install` (it runs `npm install` and says so);
`code-graph deps status` shows what resolves from where. When neither has ts-morph, the error names
`deps install`. Inside a Claude Code Bash sandbox (`SANDBOX_RUNTIME=1`) an unreadable `~/.cache` looks
missing; the error and `deps status` then say so and name `sandbox.filesystem.allowRead` with the
absolute cache dir. The `skills` commands never need any of this.

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
(`×3`); distinct edge reasons are all shown. Inbound edges are labelled by their type (`← called by`,
`← mounted by`, `← triggered by` only for `triggers`, ...), outbound ones show the type. `--json`
stays one entry per stored edge. A hit with no purpose ends in ` — _not enriched_` (plain text only;
in `--json` its `purpose` stays absent or null); the `code-graph-retrieval` skill reports the ones an
answer used as an "enrich only" gap (see the `scribe` skill row below). The `~N tokens`
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
values); commit that rewrite. The first `extract` after 0.3.27 rewrites each `.ast.json` once more
(cross-concept edges, below); commit that too.

### Cross-concept edges

`extract` records a call into a file owned by another concept as an edge with `crosses_concept: true`,
so `query cross`, `impact` and `concept` see it with no enrichment (since 0.3.27).

- **Owner rule.** A file matched by several concepts' globs belongs to the first one in
  `scribe.config.json` order, the concept being extracted and docs-only concepts excluded. A file the
  extracting concept matches itself resolves locally: the local match wins.
- **Target not applied yet, or archived.** The edge is kept in the `.ast.json` and the store; the target
  key is deterministic, so the other concept's `.ast.json` is never read. Queries hide an edge whose far
  vertex is missing or archived, and show it once that concept is applied and the vertex is live.

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
| `code-graph enrich targets <concept>` | `code-graph enrich targets workorder-store --summary --json`         | List vertices that need enrichment (lazy; `--all`: every) |
| `code-graph enrich merge <c> <file>`  | `code-graph enrich merge workorder-store partial.json`               | Merge a partial enrichment into `<c>.enriched.json`       |
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
| `code-graph skills stamp [skill] [--bump minor\|major\|initial] [--sha <sha>] [--reviewed]` | Stamp one skill's marker; with no skill, the repo-level `skills` block. Warns on a blind stamp (see below) |
| `code-graph skills check [--json] [--strict]` | Concepts missing a SKILL.md, path mismatches, unmarked and docs-only skills (`--strict` exits 1) |
| `code-graph skills status [skill] [--json\|--summary]` | Per-concept version, last-update and commits since, over its globs; with a skill, that concept only, naming each changed file with its commit count |
| `code-graph skills agents`                 | The agents list agent notes may be written for (JSON array)                 |
| `code-graph skills agents-discover`        | Agents the project has (`.claude/agents` + maestro.json), read-only         |
| `code-graph skills agents-set [names...]`  | Replace the agents list (no names empties it)                               |

Versions are `major.minor`: `initial` writes 1.0, a list-wide update bumps the minor, a single-concept
deep pass bumps the major. **A repo-level `skills stamp` without `--bump` refuses (exit 1, nothing
written) when a version already exists** in `scribe.config.json` or the legacy `.claude/concept-skills.json`;
with none it stamps 1.0. Pass `--bump minor|major` explicitly, or `--bump initial` to reset to 1.0 on purpose.

`skills status <skill>` (id, directory or SKILL.md path, resolved like `stamp`) shows that concept only: each
changed file in `<last-update>..HEAD` with its commit count, then the unchanged mapped files (capped at 10), under
a `since stamp <sha8> (git):` label (printed only when a stamp exists and the changed or unchanged list is non-empty): that list is committed git state only. When an `.ast.json` with
`meta.files` exists, a second section `unextracted (working tree vs last extract):` lists each file as
`changed`, `new` or `removed` (capped at 10, `+N more`), so uncommitted edits and untracked files show up there.
A file in that section is dropped from the `unchanged` text list (it is not unchanged since the extract);
`--json` `filesUnchanged` stays the raw git list. With no usable `.ast.json` the section is absent.
`--json` adds `filesChangedCounts: [{path, commits}]` per concept (`filesChanged` is unchanged) and, for the
single-skill form, `filesUnchanged`. The full text view lists the first 10 changed files under each concept,
then `+N more`. `--summary` stays counts-only.

**Blind-stamp warning.** `skills stamp <skill>` compares the previous `last-update`..HEAD: when files in the
concept's globs changed and the SKILL.md neither changed in that window nor has an uncommitted change (staged
or unstaged), it prints a warning naming the files on stderr, still writes and exits 0; the JSON result gains
`warning: { reason: "mapped-files-changed-skill-unchanged", files[] }`. Changed `version:` and `last-update:` marker
lines do not count as a SKILL.md edit, so a bare re-stamp cannot clear the warning. `--reviewed` silences it, and is for
after you read the SKILL.md against those files. No check for an unstamped skill, a docs-only skill (no
globs) or an unknown or malformed previous sha. A blocked write still exits 9 and prints the lines, plus the
warning. It never refuses a stamp. Known limit: the first re-stamp after a skill is created gives no
warning, because the commit that added the SKILL.md counts as an edit.

### Concept-skill skills (plugin)

The plugin wraps the `skills` commands in skills that call only its bundled CLI
(`plugin/scripts/code-graph.cjs`). All work with no tsconfig; staleness then comes from the git-diff
window of `skills status` and the graph steps are skipped.

| Skill | Use | Version effect |
| --- | --- | --- |
| `create-concept-skills` | No list yet: catalog → proposal → `scribe.config.json` + SKILL.md skeletons → `bootstrap`/`extract`/`apply` | repo and skills stamped `1.0` (`--bump initial`) |
| `update-concept-skills` | List exists, code moved: `skills status --json` / `drift --json`, revise, `extract` + `apply`, re-enrich revised | `--bump minor` |
| `update-single-concept-skill` | One thin skill or a reported gap: deepen from `query concept` / `impact`. An "enrich only" gap just enriches the named vertices (`enrich merge` + `apply`), no SKILL.md edit | `--bump major` (none for "enrich only") |
| `scribe` | Skill vs `docs/` placement; extract + apply after a SKILL.md; gap channel (incl. "enrich only" gaps for un-enriched search hits); enrichment procedure | none |
| `cleanup-skill`, `load-concept-skills`, `explore-concept-skills` | Building blocks the flows call | none |
| `code-architecture-design`, `use-code-architecture-design-check` | Design gate and brief; explore uses `query cross` / `impact` | none |
| `code-graph-install` / `-update` / `-uninstall` | Enable/check/disable the plugin per project; install migrates `.claude/concept-skills.json` into `scribe.config.json` keeping its version | none |
| `add-concept` | Add one concept to an existing config via seed-driven expansion (`/add-concept [seed]`) | none (hands off to `update-single-concept-skill` for the SKILL.md) |

`skills status --summary` is the compact form (implies JSON; about 2 KB for 16 concepts against 30+ KB
for `--json`): `{head, list: {v, at, commits}, concepts: [{id, v, at, commits, files, graph?: {vertices,
enriched, changed, stale}, unextracted?: {changed, new, removed}}]}`. `commits: null` means the window could not be counted. The update flows
use it; reach for `--json` only for one concept's file list.

Search index format: the FTS row format is recorded in the store's `meta` table (`fts_format`). When
`search` finds it missing or older (a store indexed before 0.3.18, e.g. one built by 0.3.15), it rebuilds the
index once; if the store cannot be written it prints one line to stderr saying to run `code-graph reindex`.
That hint only covers lock/busy-type write failures. A truly read-only `graph.db` (file or directory
permissions) fails earlier, in `bootstrapStore`, before `search` reaches the index check, so the hint
never appears for it.

`skills status --json` also carries, per concept, a `graph` block when a store exists:
`{ extracted, extractedAt, enriched, vertices, enrichedVertices, changed, stale }` (`changed` is the
same ast.json-vs-store count as `drift`, so extract first). A recorded `last-update` sha that is
malformed or unknown to git yields `unknownFreshness: true` (`reason: "malformed-sha"` or
`"unknown-commit"`, `commitsSince: null`) instead of an error. Docs-only concepts have no `graph` block.
Each concept also carries `unextracted: { changed, new, removed, files[] }` (text form
`unextracted: N changed, N new, N removed file(s)`): source files changed since the last `extract`,
which `graph.changed` cannot see. Null until the next `extract` records `meta.files`.

### `query vertex` calling forms

The `<location>` argument supports four forms. Detection: if the segment after the last `:` is numeric, it's filepath:line. Otherwise it's a name lookup.

| Form | Example | When to use |
|------|---------|-------------|
| `<filepath>:<line>` | `code-graph query vertex src/store/workorder.store.ts:42` | Jump to vertex covering a specific line — e.g. from editor cursor or a stack trace |
| `<name>` | `code-graph query vertex setWorkorderIndex` | Quick lookup by symbol name — exits 4 with candidate list if ambiguous |
| `<concept>::<name>` | `code-graph query vertex workorder-store::setWorkorderIndex` | Disambiguate when the same name exists in multiple concepts |
| `<filepath>:<name>` | `code-graph query vertex src/utils/workorder-store.ts:setWorkorderIndex` | Disambiguate when the same name exists in multiple files of one concept (e.g. util vs store-action) |

### Common options

- `--max-tokens <n>` — truncation budget (default 3000). Applies to `search` (markdown and `--json`);
  `query concept|impact|cross|vertex|file --json` ignore it
- `--json` — emit structured JSON instead of markdown. `search --json` is trimmed to the budget (lowest-ranked
  hits first, then skill bodies, then edge lists) and adds `truncated: true` plus
  `dropped {hits, edges, clusters, skillBodiesTruncated, gaps}` when it trims. The budget bounds the whole
  payload (about 4 bytes per token). `gaps` is compact (`{enriched, enrichable, concepts: ["<concept>: <status>
  <enriched>/<live>", ...]}`, one line per concept with a gap, none listed twice) and is cut first when over
  budget: first to the concepts the results are about, then to the counts alone (`dropped.gaps` = lines cut);
  `strength` is always kept. The remaining fixed floor is the empty result skeleton (roughly 150 tokens);
  under extreme budgets the best hit may be dropped
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
| 7         | `search` low confidence | Results are printed, but the top cluster is a weak match or its concept is un-enriched (`LOW_CONFIDENCE_MIN_SCORE`, `LOW_CONFIDENCE_MIN_ENRICHED` in `query/search.ts`). Verify with grep or the concept's SKILL.md. `--json` sets `low_confidence: true` and `low_confidence_reason`. An exact symbol-name hit and a docs-only concept are never low confidence |
| 8         | `node:sqlite` unavailable | Any command that opens the store (`search`, `query *`, `status`, `bootstrap`, `reindex`, `apply`, `drift`, `enrich *`, `eval`, `delete-concept`) on a Node without `node:sqlite`. One stderr line names the requirement: Node >=22.5, no `--no-experimental-sqlite`. Check with `node --version`. `skills *`, `deps *`, `extract` and `catalog` never open the store and still run |
| 9         | `skills stamp` computed, not written | The sandbox blocked the SKILL.md write (EROFS/EPERM/EACCES). Output: `stamp computed, not written: <path>`, `reason:`, then `set exactly these lines in its metadata block:` and the lines (unmarked skill: `replace the metadata block (or add it to the frontmatter) with exactly:` and the whole block). Apply them with Edit, then re-run `skills status`. `--print` computes and prints without writing (exit 0); `--json` gives `{ stamped, version, lastUpdate, written: false, blocked: { reason, lines } }` |

## Zed editor LSP

Surfaces code-graph metadata as hovers, code-lens, and jump-to-definition in TS/TSX/JS/JSX buffers.
