# packages/code-graph

The published CLI + library (`bin: code-graph` → `dist/cli.js`). Build from the repo root, never
from here.

## Layout notes

- `src/scribe/` writes the store (bootstrap, extract, apply, enrich, delete-concept); `src/query/` reads it;
  `src/skills/` is layer 1 (`code-graph skills *`); `src/eval/harness.ts` runs Layer-A eval.
- `eval/tasks.json` is the default Layer-A fixture shipped in the npm `files` set — not this
  repo's own gate (that is the root `eval/`).

## Library surface

The `exports` map points at `dist`, not source: relative imports carry explicit `.js` extensions
against `.ts` files. `src/index.ts` re-exports the pure read path and deliberately omits
`loadConfig`, `deleteConcept`, `preflight.ts`, `run.ts` and `search()` (they `process.exit` and
write to stdout, which would crash a host process) and `extract.ts` / `catalog.ts` (the only
`ts-morph` importers). Keep that line when adding an export.

## The plugin bundle

`scripts/build-plugin.mjs` (esbuild, turbo `bundle` task) emits the committed
`plugin/scripts/code-graph.cjs`, which plugin skills run with no `node_modules` beside it.

- `typescript`/`ts-morph` are not bundled: every import goes through `requireFromProject`
  (`project-deps.ts`). Resolution order: (a) plugin-owned deps dir (`$CLAUDE_PLUGIN_DATA/deps/<key>`, then
  `<XDG_CACHE_HOME|~/.cache>/code-graph/deps/<key>`; both searched; `<key>` = `depsKey()`, the pins,
  e.g. `ts-morph@28.0.0`, not the version, so installs survive plugin updates; old `deps/0.3.*`
  folders are never searched and can be deleted; reinstall once after upgrading), populated only by the
  explicit `code-graph deps install` (`deps.ts`, npm, pins `PINNED_DEPS` — ts-morph only, it carries
  its own compiler; keep in step with package.json); (b) the project's own install via
  `createRequire(<project>/package.json)`. Neither → `MissingProjectDependencyError` naming
  `deps install`. Never download inside a graph command. A deps dir is probed with `probeDepsDir`
  (stat) into `present | absent | unreadable | not-visible`: EACCES/EPERM is `unreadable`; ENOENT is
  `absent` outside a sandbox. Under `SANDBOX_RUNTIME=1` (bubblewrap can hide a denied home path) an
  ENOENT is told apart by listing `cacheRootDir()` (or the plugin-data root), then its parent: listable
  and the dir not in it = `absent` ("run deps install"); neither visible = `not-visible` ("may be absent
  or hidden", both fixes). `unreadable` and `not-visible` (`blockedState`) make the error and `deps
  status` name `sandbox.filesystem.allowRead` and the absolute cache dir as well as `deps install`.
  `deps install` stays on `~/.cache`: `CLAUDE_PLUGIN_DATA` is unset in the user's shell and Claude Code
  documents no way to locate it from there.
- **No `node:sqlite`** (Node <22.5 or `--no-experimental-sqlite`): `sqlite-guard.ts` is the one catch.
  A commander `preAction` hook in `cli.ts` checks `isBuiltin("node:sqlite")` (`node:module`), without
  loading it, for the top-level commands in `STORE_COMMANDS` and exits `EXIT_NO_SQLITE` (8) with one
  line naming Node >=22.5 and `node --version`.
  Add any new store-opening command to that set; `skills`, `deps`, `extract`, `catalog` stay out.
  Deliberate exception: `refresh-skills` opens the store but stays out, so the Stop hook is a silent
  no-op without `node:sqlite` (`refreshSkipReason` checks `isBuiltin` before any store import). It also
  does its own no-concepts skip instead of `skippedForNoConcepts`.
- `extract`/`apply`/`drift` with no `concepts` in the config exit 0 with a skip message before
  importing anything heavy (`skippedForNoConcepts` in `cli.ts`); keep new concept-iterating commands
  behind it.
- The version is baked in as `__CODE_GRAPH_VERSION__` and `packageRoot()` is null in the bundle —
  read version/package dir through `version.ts`, never `package.json`.
- **Versions stay in lockstep**: `packages/code-graph/package.json`, `plugin/.claude-plugin/plugin.json`
  and `.claude-plugin/marketplace.json` must carry the same version. `scripts/check-versions.mjs`
  enforces it (in `pnpm check` and at the start of the bundle step); bump all three together.
- **`plugin/` stays clean and the gap-file format is pinned.** `scripts/check-plugin-clean.mjs` (in
  `pnpm check`) fails if `plugin/` holds a `CLAUDE.md` or `.claude/`. The skill-gap channel file
  format lives in `plugin/contracts/skill-gaps.{schema,example}.json`; `src/skills/gap-contract.test.ts`
  tests it, so change all three together.
- **Scripts' run-directly check compares realpaths.** `.mjs` scripts (and `bench/strip-concept-skills.mjs`)
  use a local `isEntrypoint` helper (realpath of `argv[1]` vs `import.meta.url`) so a symlinked checkout
  still runs; `scribe/script-symlink.test.ts` covers it. Copy the helper into new scripts.
- **Layer 1 never loads the graph stack.** `skills *` must not load `node:sqlite`, `typescript` or
  `ts-morph`; `cli.ts` imports store/extract/query modules lazily inside each command. Keep new
  graph imports lazy and keep `skills/` free of them.

## Store conventions

- Vertex `_key` = `sha1(concept::filepath::name::type).slice(0,32)`; survives rename via drift
  detection. `status: live | archived` — never hard-delete; apply archives missing vertices.
- Agent fields (`purpose`, `inputs`, `outputs`, `cross_concept_refs`, `document_ref`, `tags`) are
  written only by enrichment and preserved across re-extracts; `agent.stale = true` flags a body
  change.
- Edge dedup `eKey = sha1(from|to|type|line)`. Re-apply replaces all AST edges; agent-authored
  edges (`agent.authored_by != null`) are upserted separately.
- Cross-concept edges are written by `extract` (`makeForeignResolver`): `crosses_concept: true` to the
  owning concept's deterministic vertex key (owner = first in config order, extracting concept and
  docs-only excluded). `apply` keeps the flag; queries hide edges whose far vertex is missing or
  archived. First `extract` after 0.3.27 rewrites each ast.json once.
- `concept.skill` is ingested as a `docs/<concept>::skill` vertex with `documented-by` edges to
  every live vertex in the concept.
- One FTS5 table `search_fts` over `vertices(name, purpose, tags)` + `docs(body_md)`, `porter
  unicode61` — one table because `bm25()` scores only compare within one index. Rebuilt wholesale
  at the end of every `apply`. Stopwords are stripped in JS (`toMatchExpr`, `scribe/rows.ts`).
  The `name` column holds the identifier plus its camelCase/snake words (`nameIndexText`) so
  un-enriched vertices match plain-language queries; changing that needs `code-graph reindex`.
- `search` exits 7 (results still printed) when the top cluster is a weak match or its concept is
  un-enriched: `assessConfidence` in `query/search.ts`, thresholds `LOW_CONFIDENCE_MIN_SCORE` /
  `LOW_CONFIDENCE_MIN_ENRICHED`. Exact name hits and docs-only concepts are exempt. `--json` adds
  `low_confidence` + `low_confidence_reason`.
- `skills` block `{ version, last_update, agents[] }` in `scribe.config.json`: loose `z.record` in
  `config.ts`, validated in `skills/state.ts` from raw JSON (works without `concepts`/`tsconfig`).
  Legacy `.claude/concept-skills.json` is a read-only per-field fallback; the first write seeds
  from it.

## Gotchas

- `bootstrap` is idempotent but never migrates. A schema change = bump `SCHEMA_VERSION`, delete
  `scribe-output/graph.db`, re-run `extract` + `apply`.
- `node:sqlite` binds anonymous `?` only; `?1`/`?2` raise "column index out of range".
- `EDGE_SCAN_ORDER` in `queries.ts` reproduces ArangoDB's reverse edge-index scan. It looks
  arbitrary, but it picks which edge represents a vertex after dedup — changing it changes
  `impact`/`vertex` output.
- The destructured store-action resolution in `extract.ts` (`resolveToVertexKey` →
  `BindingElement`) is load-bearing for impact queries through hooks.
- Docs-only detection (`isDocsOnly`, `extractDocsOnly`) lives in `scribe/ast-output.ts`, not
  `extract.ts`: `cli.ts` checks it before importing `extract.ts`, so a docs-only `extract` never
  loads ts-morph. Keep it that way.
- A concept's SKILL.md resolves via `resolveConceptSkillPath` (`skills/concept-skills.ts`): explicit
  `skill` (returned as declared even if missing), else the marked skill whose id/dir equals the
  concept key, else `skillsDir/<concept>/SKILL.md`.
- `drift --json` / `apply --dry-run --json` `changed` is ast.json vs store: run `extract` first.
  `skills status --json` graph freshness (`scribe/freshness.ts`) is lazy and optional; a bad
  `last-update` sha reports `unknownFreshness`, never throws.
- **Unextracted changes** (`scribe/unextracted.ts`): `extract` records a sha256 per code file
  (`.[cm]?[jt]sx?`) its globs match in `.ast.json` `meta.files` (a scan, not only tsconfig files, so the
  same scan later finds new ones). `skills status` (`concepts[].unextracted`, text `unextracted: N
  changed, N new, N removed file(s)`) and `drift`/`apply --dry-run` (`unextracted` in `--json`) rescan
  and diff; counts are **files**, separate from vertex `changed`. Null/absent for an ast.json from
  before 0.3.17: the first `extract` rewrites each committed ast.json once to add `meta.files`.
  `meta.files` moves with the source while `extracted_at`/`extractor_version` keep the byte-stability
  rule. The module imports only fs/crypto/minimatch; `skills/unextracted-imports.test.ts` guards that
  the `skills status` import graph never reaches typescript, ts-morph or node:sqlite.
- `.ast.json` is byte-stable across re-extracts of unchanged code: vertices/edges carry no
  `ast.extracted_at` there (optional in the schema); `apply` stamps `ast.extracted_at` into the
  store's JSON column. `meta` (`extractor_version` + `extracted_at`) is kept whole when vertices,
  edges and skill are unchanged, so `meta.extractor_version` = the version that last changed the
  file's content. Per-vertex `ast.extractor_version` is optional in the file (schema unchanged,
  `SCHEMA_VERSION` too): `apply` fills the store's value from `meta`, a legacy per-vertex value wins.
  The first `extract` after 0.3.5 rewrites each committed file once. Guarded by
  `scribe/ast-stability.test.ts`; don't add timestamps or other per-run values to the file.
- Enrichment is merged, not replaced: `enrich merge <concept> <partial>` (`scribe/enrich.ts`)
  upserts by `_key` into `<concept>.enriched.json` (sorted, stable) and stamps `sig_seen` +
  `hash_seen` from ast.json; `enrich targets` lists what needs enriching. `apply` has no `--merge`.
  `enrich targets` is lazy: a never-enriched vertex is `new` only if core, touched since the previous
  apply (`touchedSinceApply`) or `--vertex`-named; the rest count in `core.leftOut` (always
  reported). `apply` stamps `agent.touched_at` (optional in `VertexSchema`, no `SCHEMA_VERSION` bump)
  on un-enriched new/changed vertices or approved renames, never on a concept's first apply. `--all` = old listing,
  `--core` = no-op, `--vertex` narrows to the named vertices (full details), `--summary` = counts +
  core block + one line per target, no edge arrays (compact JSON with `--json`).
  Staleness: a changed vertex is fresh only if `hash_seen === contentHash`; entries with no
  `hash_seen` (pre-0.3.6) keep the `sig_seen === signature` rule (`enrichmentIsCurrent`). `gaps`
  counts a vertex as enriched only with a non-stale purpose.
- A concept's **core** (`scribe/core.ts`, pure `coreVertices(vertices, edges, skillBody)`) = vertices
  named in the SKILL.md (whole identifier, name 3+ chars) ∪ in-concept hubs (3+ inbound
  `calls`/`mounts` from the same concept). Shared by `enrich targets` (only "new" is
  filtered; changed/stale/named always listed; JSON has `targets[].core` and top-level
  `core {size, leftOut, thin, message?}`) and `gaps` (`fetchConceptCounts(db, {core: true})` reads
  the SKILL.md from the `docs` row and `calls`/`mounts` edges). `gaps` ratio is over the core when
  non-empty, else all live vertices. Thin core (`isThinCore`: 50+ live, <5 core) is reported in
  `GapReport.thinCores` and `enrich targets`, routing to `update-single-concept-skill`.
  Thresholds are constants in `core.ts`; no schema change.
- `search --json` honours `--max-tokens` (default 3000) via `budgetSearchJson` in `query/search.ts`:
  adds `truncated`/`dropped` (incl. `dropped.gaps`) only when trimming and bounds the whole payload:
  `gaps` is the compact `CompactGaps` (`query/gaps.ts`, one line per gapped concept, never listed
  twice) and is cut before any hit (relevant concepts, then counts). `strength` is always kept; the
  floor is the empty skeleton (~150 tokens), and the best hit may be dropped as a last resort.
  `search` stamps `meta.fts_format` (`FTS_FORMAT`, `scribe/bootstrap.ts`) in `rebuildSearchIndex` and
  reindexes once via `ensureSearchIndexFormat` when it is missing or older (no `SCHEMA_VERSION` bump);
  bump `FTS_FORMAT` whenever the indexed text changes. `skills status --summary` is the compact form
  (`summarizeStatus`, `skills/report.ts`). `concept|impact|cross|vertex|file --json`
  (`query/run.ts`) still bypass `--max-tokens`. See the `code-graph-search` skill.
- Edits to `extract.ts` change `contentHash`; drift shows "changed" until `apply` runs.
- A repo-level `skills stamp` without `--bump` **refuses** (exit 1, nothing written) when a
  version exists (config or legacy file); `--bump initial` resets to 1.0 on purpose. Always pass `--bump`.
- `skills stamp` exits **9** (`EXIT_STAMP_NOT_WRITTEN`) when the SKILL.md write hits EROFS/EPERM/EACCES
  (`isWriteBlocked`): `planStamp` computes the result, the CLI prints the lines to apply by hand.
  `--print` forces that path with exit 0.
- `skills stamp <skill>` **warns, never refuses** on a blind stamp (`blindStampWarning`, `skills/report.ts`):
  mapped files changed since the previous `last-update`, SKILL.md unchanged in the window and in the working
  tree (staged or not). Stderr + `warning` in the JSON; `--reviewed` suppresses; exit 9 is unaffected.
  `skills status <skill>` lists changed files with commit counts (`filesChangedCounts`) and unchanged ones.
