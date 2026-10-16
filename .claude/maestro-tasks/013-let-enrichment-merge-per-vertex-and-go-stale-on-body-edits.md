# Let enrichment merge per vertex and go stale on body edits

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

maestro (code-graph-cutover) wants enrichment to build up a little at a time as the graph gets used, instead of one bulk pass. Concept skills lay out the map, and enrichment refines it as tasks touch code. maestro dropped its bulk-enrichment task for this. This task is the CLI half; task 014 changes the skills to use it.

**1. Partial enrichment merges, never replaces.** Today `apply` reads `scribe-output/<concept>.enriched.json` (`apply.ts` ~L200) as the complete enrichment, and that file is the only committed copy. Edge `reason`s come only from it (`enrichedEdgeReasons`, ~L243-251), and AST edges are deleted and re-inserted on every apply (~L515). So a scribe that writes only the vertices it touched would wipe every other description and reason on a fresh clone. Add:
- `code-graph enrich targets <concept> [--vertex <name|key>...] --json`: lists the vertices that need enrichment (new, changed, stale, plus any named), with what an enricher needs: key, name, type, filepath, line range, signature, current purpose, and outgoing AST edges without a reason. Run `extract` first; say so in the error if ast.json is missing.
- `code-graph enrich merge <concept> <partial.json>`: merges a partial enrichment, with the same entry shapes as .enriched.json, into `<concept>.enriched.json`. It upserts by vertex `_key` and edge `_key`, keeps every other entry untouched, and validates keys against the current ast.json (rejecting or warning on unknown keys). It writes deterministically (sorted, stable formatting, in the spirit of task 010) so a merge touching N vertices changes about N entries in the diff. Then the user runs `apply` as usual. Alternatively, `apply --merge <partial>` is fine if it fits better; pick one and document it.

**2. Stale on body change.** In `apply.ts` `buildAgentUpdate` (~L148-153), a changed vertex is cleared to `stale:false` whenever `ev.sig_seen === newSignature`. `sig_seen` is the signature, so a body-only edit never goes stale. That contradicts `freshness.ts` ("stale = body changed after enrichment"), and the update flow only re-enriches listed stale vertices, so rewritten bodies keep old descriptions silently. Record the enriched `contentHash` (e.g. `hash_seen`) beside `sig_seen` in enrichment entries; `enrich merge` stamps it from ast.json. A changed vertex is fresh only if `hash_seen` equals the new contentHash. For old entries without `hash_seen`, keep the current signature rule so existing enrichment isn't mass-staled on upgrade; document that. Fix the stale count in the dry-run and drift output (~L321-343) to match.

**3. Gaps don't count stale descriptions.** `query/gaps.ts` treats a concept as enriched when 90% of its vertices have any `purpose` (`enrichedRatio`). Count a vertex as enriched only if it has a purpose and isn't stale.

Document the commands in docs/usage.md, the package CLAUDE.md, and the scribe-pipeline skill. Bump all three version files to 0.3.6 and regenerate the bundle.

## Acceptance criteria

- [ ] `enrich targets <concept> --json` lists new, changed, stale and named vertices with the fields an enricher needs
- [ ] `enrich merge` upserts a partial enrichment into <concept>.enriched.json; untouched vertices and edge reasons survive, and a later apply keeps them in the store
- [ ] Merging the same partial twice is a no-op, and output ordering is deterministic
- [ ] A body-only edit (same signature) to an enriched vertex makes it stale after extract + apply; enrichment with a matching hash_seen clears it
- [ ] Old enrichment entries without hash_seen are not mass-staled by the upgrade
- [ ] gaps no longer counts stale vertices as enriched
- [ ] pnpm test, pnpm check and just eval (7/7) are green; the version is 0.3.6 in all three files; the bundle is regenerated

## Blocked by

None — can start immediately
