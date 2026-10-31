---
name: scribe-pipeline
description: How the code-graph write path works — extract a concept to an .ast.json, apply it into the SQLite store with drift detection, and ingest the concept's SKILL.md as a doc vertex. Read before changing packages/code-graph/src/scribe.
metadata:
  type: concept-skill
  version: "1.0"
  last-update: eb68ef2464aff4efaffe916e2416411df40eba0a
---

# Scribe pipeline

The write path of code-graph: `extract <concept>` → `scribe-output/<concept>.ast.json` →
(enrichment → `.enriched.json`) → `apply <concept>` → rows in `scribe-output/graph.db`.
The read path (`src/query/`) is the `code-graph-search` skill's concern.

## File map

| File | Role |
| --- | --- |
| `scribe/extract.ts` | ts-morph walk of the concept's globs; emits vertices and edges, never touches the store |
| `scribe/ast-output.ts` | reads the concept's SKILL.md, writes the `.ast.json`; `extractDocsOnly` for concepts with no code |
| `scribe/apply.ts` | upserts vertices/edges, runs drift detection, archives vertices that vanished, rebuilds FTS; modes: interactive rename prompt (`y`/`n`/skip-all), `--approve-drift`, `--dry-run` (exit 0, `--json`), `--defer-renames` (see Invariants) |
| `scribe/skill-refresh.ts` | `refresh-skills [--hook] [--json]`: finds applied concepts whose SKILL.md changed, runs `extract` + `apply --defer-renames` per concept as child CLI processes under a lock, builds the hook's `systemMessage`; owns `EXIT_RENAMES_DEFERRED` (10) and `HOOK_TIMEOUT_SECONDS` (120). Run by `plugin/hooks/hooks.json` on Stop/SubagentStop |
| `scribe/bootstrap.ts` | schema (`SCHEMA_VERSION`), the single `search_fts` table, `rebuildSearchIndex` (stamps `meta.fts_format` = `FTS_FORMAT`), `ensureSearchIndexFormat` (one-time reindex used by `search`) |
| `scribe/db.ts` | `resolveDbPath` (`dbPath` override), cached store handles |
| `scribe/enrich.ts` | `enrich targets` (what needs enriching; lazy, see Invariants; `--all` lists every never-enriched vertex, `--core` is a no-op, `--vertex` narrows to the named vertices with full details, `--summary` is the compact form with no edge arrays, plus `applied`; `--summary [--json] [--all]` with no concept is the cross-concept roll-up `enrichTargetsRollup`: `{ total, neverApplied[], notExtracted[], concepts[] }`, same selection rules, no target lines) and `enrich merge` (upsert a partial into `.enriched.json`, stamping `sig_seen`/`hash_seen`); `enrichmentIsCurrent` is the staleness rule `apply` uses |
| `scribe/core.ts` | a concept's core (vertices named in its SKILL.md plus in-concept hubs); shared by `enrich targets` (core-first by default) and `gaps`; `isThinCore` / `thinCoreMessage` flag a big concept whose skill names little |
| `scribe/freshness.ts` | per-concept graph freshness surfaced by `skills status` |
| `scribe/unextracted.ts` | rescans a concept's globs, sha256s code files and diffs against `.ast.json` `meta.files` (`unextractedChanges`); layer-1 safe, used by `skills status` and `drift` |
| `scribe/delete-concept.ts` | archive a concept and report dangling cross-concept refs |
| `scribe/rows.ts` | row shaping and `toMatchExpr` (query stopwords are stripped in JS) |

## Invariants

- Vertex `_key` includes the filepath, so moving a file orphans its enrichment until remapped.
- Agent fields come only from enrichment and survive re-extracts; a body change sets `agent.stale`
  on every changed vertex, never-enriched ones included.
- `enrich targets` is lazy: a never-enriched vertex is `new` only when core, touched since the
  previous apply, or `--vertex`-named; the rest count in `core.leftOut`. Touched
  (`touchedSinceApply`) = not in the store yet, a body differing from the store's, `agent.touched_at`
  or `agent.stale` set. `apply` stamps `agent.touched_at` on a purpose-less vertex that is new or
  body-changed, or the new key of an approved rename (`--approve-drift` or interactive `y`) whose
  merged vertex has no purpose, but never on a concept's first apply (an empty store for it): that
  ingest is not a task, so nothing is touched before it.
- "Applied" (`conceptWasApplied`, private in `enrich.ts`) = the concept has live vertices or a `docs`
  row, so a docs-only concept counts. Reporting only (`applied`, `neverApplied`); `touchedSinceApply`
  keeps its live-vertex rule. Reuse this definition rather than writing another.
- Enrichment is partial-friendly: `.enriched.json` is the only committed copy and `apply` reads it as
  the whole truth (edge reasons are re-inserted from it), so never overwrite it with a partial; use
  `enrich merge`. A changed vertex is fresh only when the entry's `hash_seen` equals its new
  `contentHash`; entries without `hash_seen` fall back to `sig_seen === signature` (no mass-stale on
  upgrade). `gaps` counts only non-stale purposes as enriched.
- Nothing is hard-deleted: apply archives missing vertices (`status: archived`).
- Rename detection pairs each missing vertex with each new one of the same filepath and type, scores
  Levenshtein similarity of `"<signature> <name>"` (>= 0.8 is a candidate) and keeps unique pairs by
  greedy best score. An approved rename writes the new key carrying the old agent fields and archives
  the old key (counted 1 inserted + 1 archived); a rejected one archives the old key and inserts the new
  one as new.
- `apply --defer-renames` exits `EXIT_RENAMES_DEFERRED` (10) before any write when there are rename
  candidates (the whole concept is left unapplied, so a later interactive `apply` sees the same drift);
  combining it with `--approve-drift` exits 1. `EXIT_RENAMES_DEFERRED` lives in `skill-refresh.ts`, not
  `apply.ts`, so the hook path imports no store module up front.
- `refresh-skills` only touches concepts already applied: the SKILL.md `contentHash` differs from the
  `docs/<concept>::skill` row's `body_hash`, or vertices exist but there is no doc row. A first ingest is
  `add-concept`'s job. Each concept runs as a child process so extract/apply's stdout and `process.exit`
  never reach the hook's JSON stdout. Lock `.refresh-skills.lock` sits next to `graph.db` and is taken
  over after `HOOK_TIMEOUT_SECONDS`; keep that constant equal to the `timeout` in `plugin/hooks/hooks.json`.
- `refresh-skills` is deliberately outside `STORE_COMMANDS` and `skippedForNoConcepts`:
  `refreshSkipReason` returns a silent skip for no config, no concepts, no tsconfig or no `node:sqlite`
  (checked with `isBuiltin`, before any store import), and a missing store is skipped too. `--hook` always
  exits 0 and prints only `{ systemMessage }` or nothing; without `--hook`: 1 if any concept failed, 10 if
  any was deferred, else 0. A deferred concept is re-reported at every stop until applied by hand.
- `.ast.json` is byte-stable for unchanged code: no per-item `ast.extracted_at` in the file (`apply`
  stamps it into the store), and the whole `meta` (`extractor_version` + `extracted_at`) is kept when
  vertices, edges and skill are unchanged. So `meta.extractor_version` = the version that last
  changed the file's content. `meta.files` (optional path -> sha256 of every code file the globs match,
  no `SCHEMA_VERSION` bump) is the exception: it moves with the source and is kept even when vertices
  are unchanged, feeding unextracted-change detection; the first `extract` after 0.3.17 rewrites each
  file once. There is no per-vertex `extractor_version` in the file, `apply` fills
  the store's `ast.extractor_version` from `meta` (a legacy per-vertex value still wins).
- Cross-concept edges are emitted at extract time (`makeForeignResolver` in `extract.ts`): a call into a
  file owned by another concept gets an edge with `crosses_concept: true` to that concept's deterministic
  `vKey`, no enrichment needed. Owner = first concept in config order, the extracting concept and
  docs-only concepts excluded; a file the extracting concept matches resolves locally first. `apply`
  keeps `crosses_concept === true`. The target may be unapplied or later archived: the edge stays and the
  queries (`oneHop`, `twoHops`, `oneHopAnyTable`, `queryConcept`, `queryCross`) hide edges whose far
  vertex is missing or archived. No `SCHEMA_VERSION`/`FTS_FORMAT` bump; the first `extract` after 0.3.27
  rewrites each ast.json once. Guarded by `scribe/cross-concept-edges.test.ts`.
- Re-apply replaces all AST edges; agent-authored edges are upserted separately.
- The concept SKILL.md becomes a `docs/<concept>::skill` vertex with `documented-by` edges to every
  live vertex. A docs-only concept (no code vertices) still gets the doc vertex, which is what makes
  `search` find skills in repos with no tsconfig.

## Traps

- `extract` needs `ts-morph` via `requireFromProject`: the plugin deps dir (`deps install`) first, then
  the project's node_modules; `apply` and `search` do not. With no `concepts` configured, `extract`,
  `apply` and `drift` skip with exit 0. Docs-only concepts skip ts-morph entirely.
- `pnpm format` rewrites bodies, changing `contentHash` and marking enrichment stale: re-graph after.
- The FTS index is rebuilt wholesale at the end of every `apply`; a half-failed apply leaves a stale index.
- Resolving a deferred concept with `--approve-drift` looks like the fix and isn't: it accepts every
  candidate unreviewed (ticket 045 cites an installing-maestro run reported as 4 inserted, 2 archived with
  enrichment lost). Have a person run `apply <concept>` and answer the prompts.

## Relationships

`code-graph-search` reads what this writes; `concept-skills-layer` (`skills status`) reads graph
freshness from here.
