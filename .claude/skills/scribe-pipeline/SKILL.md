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
| `scribe/apply.ts` | upserts vertices/edges, runs drift detection, archives vertices that vanished, rebuilds FTS |
| `scribe/bootstrap.ts` | schema (`SCHEMA_VERSION`), the single `search_fts` table, `rebuildSearchIndex` |
| `scribe/db.ts` | `resolveDbPath` (`dbPath` override), cached store handles |
| `scribe/enrich.ts` | `enrich targets` (what needs enriching) and `enrich merge` (upsert a partial into `.enriched.json`, stamping `sig_seen`/`hash_seen`); `enrichmentIsCurrent` is the staleness rule `apply` uses |
| `scribe/core.ts` | a concept's core (vertices named in its SKILL.md plus in-concept hubs); shared by `enrich targets --core` and `gaps`; `isThinCore` / `thinCoreMessage` flag a big concept whose skill names little |
| `scribe/freshness.ts` | per-concept graph freshness surfaced by `skills status` |
| `scribe/delete-concept.ts` | archive a concept and report dangling cross-concept refs |
| `scribe/rows.ts` | row shaping and `toMatchExpr` (query stopwords are stripped in JS) |

## Invariants

- Vertex `_key` includes the filepath, so moving a file orphans its enrichment until remapped.
- Agent fields come only from enrichment and survive re-extracts; a body change sets `agent.stale`.
- Enrichment is partial-friendly: `.enriched.json` is the only committed copy and `apply` reads it as
  the whole truth (edge reasons are re-inserted from it), so never overwrite it with a partial; use
  `enrich merge`. A changed vertex is fresh only when the entry's `hash_seen` equals its new
  `contentHash`; entries without `hash_seen` fall back to `sig_seen === signature` (no mass-stale on
  upgrade). `gaps` counts only non-stale purposes as enriched.
- Nothing is hard-deleted: apply archives missing vertices (`status: archived`).
- `.ast.json` is byte-stable for unchanged code: no per-item `ast.extracted_at` in the file (`apply`
  stamps it into the store), and the whole `meta` (`extractor_version` + `extracted_at`) is kept when
  vertices, edges and skill are unchanged. So `meta.extractor_version` = the version that last
  changed the file's content; there is no per-vertex `extractor_version` in the file, `apply` fills
  the store's `ast.extractor_version` from `meta` (a legacy per-vertex value still wins).
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

## Relationships

`code-graph-search` reads what this writes; `concept-skills-layer` (`skills status`) reads graph
freshness from here.
