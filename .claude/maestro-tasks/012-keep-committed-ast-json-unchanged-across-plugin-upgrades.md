# Keep committed ast.json unchanged across plugin upgrades

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

maestro verified code-graph 0.3.4 and found that every plugin release rewrites every committed `.ast.json`. Upgrading from 0.3.3 to 0.3.4, with no source change, rewrote all 16 of maestro's files (task-queue alone had 105 changed lines). maestro is holding that re-extract uncommitted until this ships. Task 010's report noted this as a known side effect; maestro shows it is real churn.

Cause:
- `extract.ts` (around line 528) writes `ast.extractor_version` onto every vertex, and check whether edges carry it too.
- `ast-output.ts` (around lines 63-70) keeps the previous `meta.extracted_at` only if the rest of `meta` is equal, and `meta` includes `extractor_version`. So a version bump also moves the timestamp.

Fix:
1. Record the extractor version once in `.ast.json`, in `meta`, not on every vertex or edge. The store still needs a per-vertex `ast.extractor_version` (`schema.ts`), so `apply` fills it from `meta.extractor_version` when it writes the store, the same way it already stamps `extracted_at`. The `.ast.json` schema makes the per-vertex field optional, and reading an older file that still has it keeps working.
2. Decide `meta.extracted_at` by comparing vertices and edges only, not `meta`. If they are unchanged, keep the previous timestamp.
3. Decide what happens to `meta.extractor_version` on an upgrade with no content change. Recommended: keep the previous file byte-identical, including the old `meta.extractor_version`, so an upgrade alone touches nothing. The field then means "the version that last changed this file's content"; document that. If you choose to update it, the change must be limited to that one line.

The first extract after this ships rewrites each file once, to drop the per-vertex field. Mention that in the report so maestro commits just that one rewrite. Don't change SCHEMA_VERSION unless the store's shape changes; it shouldn't. Update docs/usage.md (sharing a graph), the package CLAUDE.md and the scribe-pipeline skill where they describe these fields. Bump all three version files together (`check-versions.mjs`).

## Acceptance criteria

- [ ] .ast.json carries the extractor version only in meta; no vertex or edge has ast.extractor_version
- [ ] Store vertices still carry ast.extractor_version after apply, taken from meta
- [ ] With content unchanged, re-extracting under a different package version leaves .ast.json byte-identical, or changes at most the single meta.extractor_version line if you chose that option and documented it (a test fakes the version)
- [ ] meta.extracted_at changes only when vertices or edges change
- [ ] An older .ast.json with per-vertex extractor_version and extracted_at still applies cleanly
- [ ] pnpm test, pnpm check and just eval (7/7) are green; the version is bumped in all three files and the bundle regenerated

## Blocked by

None — can start immediately
