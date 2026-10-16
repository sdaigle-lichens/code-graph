# Report the real version and make ast.json byte-stable across re-extracts

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Two findings from maestro's first real graph on code-graph 0.3.2.

**1. Wrong version.** `code-graph --version` prints 0.1.0, and vertices carry `extractor_version: "code-graph@0.1.0"`, although the plugin is 0.3.2. The cause is that `packages/code-graph/package.json` is still at 0.1.0, and `build-plugin.mjs` bakes `pkg.version` into the bundle as `__CODE_GRAPH_VERSION__`. Use one version everywhere: package.json, plugin.json and marketplace.json. Add a check that fails when they drift apart, e.g. in `pnpm check`, the bundle step or a test. Decide whether this needs a version bump to 0.3.3.

**2. Byte-stable `.ast.json`.** code-graph says to commit `<concept>.ast.json`, but every `extract` rewrites them because of per-run timestamps. maestro's 16 files are 2.2 MB, so each scribe run makes a large diff, and maestro keeps them uncommitted for now. Vertices and edges are already sorted by `_key` (`extract.ts`), but `extracted_at` is stamped on every vertex (`ast.extracted_at`), every edge, and `meta`. Re-extracting an unchanged concept must produce a byte-identical file. Options: drop the per-vertex and per-edge timestamps and set the store's `ast.extracted_at` at apply time (apply already stamps `now`), or keep the `meta` timestamp only when content changed. `skills status` graph freshness (`scribe/freshness.ts`) reads `meta.extracted_at`, so either keep that meaningful (the time of the last real change) or switch freshness to something stable, such as a content hash. Also check that the `extractor_version` written to vertices doesn't cause churn beyond an intended version bump, and that `.enriched.json` doesn't regress. If the store's `ast` columns or schema change, follow the SCHEMA_VERSION rule in the package CLAUDE.md. Document the guarantee in docs/usage.md (sharing a graph).

## Acceptance criteria

- [ ] `code-graph --version` and new vertices' extractor_version match plugin.json and marketplace.json
- [ ] A check fails when package.json, plugin.json and marketplace.json versions differ
- [ ] Running extract twice on an unchanged concept leaves <concept>.ast.json byte-identical (a test covers it)
- [ ] A change to one file in the concept changes only the affected vertices and edges in ast.json, plus any intended meta field
- [ ] skills status --json graph freshness still reports correctly (tests updated if its source changes)
- [ ] pnpm test, pnpm check and just eval (7/7 or the updated count) are green; the bundle is regenerated

## Blocked by

None — can start immediately
