# Phase 5 — Apply (diff + drift + upsert + skills-as-docs)

## Goal

`code-graph apply <concept> [--dry-run] [--approve-drift]` consumes `scribe-output/<concept>.ast.json` + `scribe-output/<concept>.enriched.json`, computes a diff against the live DB, prompts on rename candidates, and upserts vertices/edges. Also upserts the per-concept `docs` vertex from the embedded SKILL.md and emits skills-as-docs edges (`describes`, `documented-by`).

Auto-bootstraps the DB if missing.

`code-graph drift <concept>` is an alias for `apply --dry-run`.

## Context

### Inputs

- `<configRoot>/scribe-output/<concept>.ast.json` — required.
- `<configRoot>/scribe-output/<concept>.enriched.json` — optional. If missing, AST fields applied with empty agent fields.

### Validation (trust boundary)

Both files are validated at load time against the zod schemas exported by `src/schema.ts` (introduced in phase 4.5):

- `AstDocSchema.parse(astJson)` — ours, but cheap insurance that `extract.ts` and `apply.ts` agree.
- `EnrichedDocSchema.parse(enrichedJson)` — written by the Claude Code subagent. **Untrusted boundary** — the subagent could emit malformed JSON, missing keys, or invented `_key`s. Validate before any DB write.

On validation failure: print zod's flattened error to stderr, exit 1, recommend re-running `/scribe-enrich <concept>`. Do NOT partially apply.

After parse: also enforce `astDoc.concept === argConcept` and (if enriched present) `enrichedDoc.concept === argConcept`. Mismatch → exit 1 with clear error. Catches "ran apply for concept A while output dir holds concept B's enriched.json".

Cross-reference: every `_key` in `enrichedDoc.vertices` must exist in `astDoc.vertices`. Unknown `_key`s → log warning + skip (don't fail; agent may have stale knowledge of vertex names).

### Field ownership

**AST-owned (overwritten every extract):**
`filepath, start_line, end_line, signature, contentHash, type, name, displayKey, ast.*`

**Agent-owned (preserved across extracts):**
`purpose, inputs, outputs, cross_concept_refs, document_ref, tags, agent.*`

### Diff sets (per concept)

Compute against `FOR v IN vertices FILTER v.concept == @concept AND v.status == "live" RETURN v`.

- **new** — `_key` in AST, not in DB.
- **changed** — `_key` in both, `contentHash` differs.
- **unchanged** — `_key` in both, `contentHash` same.
- **missing** — `_key` in DB, not in AST.

### Rename detection

For each pair (`v_missing` from DB, `v_new` from AST) with same `(filepath, type)`:
- Compute text similarity score between `(v_missing.signature + " " + v_missing.name)` and `(v_new.signature + " " + v_new.name)`. Use normalized Levenshtein or Jaro-Winkler — threshold ≥ 0.8.
- If above threshold and pair is unique → `renamed` candidate.

Behavior on renames:
- `--dry-run` → list candidates, no DB write.
- `--approve-drift` → auto-approve all rename candidates.
- Default → interactive prompt per candidate (y/n/skip-all).

On approve: copy agent fields from old `_key` to new `_key`; mark old as `status: archived`, `archivedAt: now`.

### Upserts

- **new** → insert. Set `status: live`, merge AST fields + agent fields from enriched.
- **changed** → update AST fields. Preserve agent fields. If `contentHash` changed: set `agent.stale = true`. Apply enriched fields if enriched.json present (overrides stale flag if `sig_seen` matches new signature).
- **unchanged** → no-op for AST fields. If enriched.json has fresher data, update agent fields.
- **missing (not renamed)** → `status: archived`, `archivedAt: now`.

### Edges

AST owns: `calls, reads, writes, mounts, uses-hook, has-type, describes, documented-by`.
Agent owns: `delegates-to, triggers`. Plus `reason` field on any edge.

Strategy:
- Replace-all per concept for AST-owned edges: `FOR e IN edges FILTER e.concept == @concept AND e.type IN [...ast types] REMOVE e`. Then insert AST edges from ast.json.
- For each AST edge, if enriched.json has a `reason` for the same `_key`, apply it.
- For agent-owned edges (in enriched.json): upsert by `_key`. Keep `agent.authored_by = "claude"`.
- Set `crosses_concept` per edge by looking up endpoints' `concept` fields.

### Soft-delete

Vertices never hard-deleted in v1. `status: archived` + `archivedAt`. Resurrection (same `_key` reappears in AST) preserves agent fields.

### Skills-as-docs (run on every apply)

1. Upsert `docs` vertex:
   ```json
   {
     "_key": "<concept>::skill",
     "concept": "<concept>",
     "kind": "skill",
     "path": "<ast.json skill.path>",
     "body_md": "<ast.json skill.body>",
     "body_hash": "<ast.json skill.contentHash>"
   }
   ```
2. Upsert `concepts` vertex:
   ```json
   {
     "_key": "<concept>",
     "owner_skill_path": "<config.concepts[c].skill>",
     "last_scribed_at": "<now>"
   }
   ```
3. Emit single `describes` edge: `_from: "docs/<c>::skill"`, `_to: "concepts/<c>"`, `type: "describes"`. Idempotent (`_key = sha1(_from|_to|describes|0)`).
4. Emit `documented-by` edges — one per live vertex in the concept. `_from: "vertices/<v._key>"`, `_to: "docs/<c>::skill"`, `type: "documented-by"`. Replace-all per concept: delete all existing `documented-by` edges where `e.concept == @concept`, then re-insert.

### Drift report

Print before any DB write:
```
Concept: workorder-store
  new:        N
  changed:    N (M became stale: true)
  unchanged:  N
  missing:    N (P rename candidates, Q to archive)
  doc:        body_hash <unchanged|changed>
```

If `--dry-run`, exit 0 here.

## Tasks

1. Create `src/scribe/apply.ts`. Entrypoint `apply(concept: string, opts: { dryRun, approveDrift })`.
2. Auto-bootstrap: call `bootstrapIfMissing()` (from Phase 2).
3. Load `scribe-output/<concept>.ast.json` (required) and `<concept>.enriched.json` (optional).
   - Parse each through the zod schema (`AstDocSchema`, `EnrichedDocSchema`) from `src/schema.ts`. On parse failure → stderr + exit 1, recommend re-running `code-graph extract` or `/scribe-enrich`.
   - Assert `astDoc.concept === concept` (and same for enriched if present). Mismatch → exit 1.
   - Build a Set of valid AST `_key`s; drop any enriched vertex whose `_key` is not in the set (log warning per drop).
4. Build intent set: merge per-vertex AST fields (from ast.json) + agent fields (from enriched.json by `_key`). Default `status: live`.
5. Fetch DB vertices: `FOR v IN vertices FILTER v.concept == @concept AND v.status == "live" RETURN v`.
6. Compute diff sets (`new`, `changed`, `unchanged`, `missing`) by `_key`.
7. Run rename detection on `missing` × `new` pairs. Use `fast-levenshtein` (add to deps) or implement simple normalized Levenshtein.
8. Print drift report.
9. If `--dry-run`: exit 0.
10. If renames present and `!approveDrift`: prompt interactively (use Node's `readline`). Build remap.
11. Apply rename remap: copy agent fields from old → new; archive old.
12. Upsert vertices in a transaction (or single batched AQL) — `INSERT OR UPDATE` semantics by `_key`.
13. Replace-all AST-owned edges for the concept; insert from ast.json. Apply enriched `reason` overrides.
14. Upsert agent-owned edges (`delegates-to`, `triggers`) from enriched.json by `_key`.
15. Recompute `crosses_concept` per edge based on endpoint concepts.
16. Upsert `docs/<concept>::skill` from `ast.skill`.
17. Upsert `concepts/<concept>` (set `last_scribed_at` to now).
18. Upsert `describes` edge (idempotent by `_key`).
19. Replace-all `documented-by` edges for the concept; insert one per live vertex.
20. Wire `code-graph apply <concept> [--dry-run] [--approve-drift]` in CLI.
21. Wire `code-graph drift <concept>` as alias for `apply --dry-run`.
22. Print final summary on success: counts of inserted/updated/archived vertices, edges replaced, doc updated Y/N.

## Done when

- First-time `code-graph apply workorder-store` (after extract + enrich) populates DB. Vertex count matches ast.json count.
- Re-running `apply` with no source change → drift report says all unchanged, doc body_hash unchanged, zero DB writes for AST. Edges replaced (acceptable — this is the cost of the replace-all strategy in v1).
- `code-graph drift workorder-store` prints same report without writing.
- Whitespace edit in a function body → re-extract + apply → vertex `agent.stale = true`, `purpose` preserved verbatim.
- Rename a function in source → re-extract + apply → rename candidate listed; rejecting → DB unchanged.
- After apply, AQL `FOR e IN edges FILTER e.type == "documented-by" RETURN e` returns one edge per live vertex in the concept.
- AQL `FOR d IN docs RETURN d._key` includes `<concept>::skill`.

## Pitfalls

- arangojs transactions: use `db.beginTransaction(...)` for atomic upsert+replace, or rely on AQL's `UPSERT` directives in single multi-statement AQL.
- Levenshtein on long signatures can be slow with many candidates — limit to pairs sharing `(filepath, type)` first.
- Replace-all on edges is heavy-handed but correct in v1 — optimization deferred.
