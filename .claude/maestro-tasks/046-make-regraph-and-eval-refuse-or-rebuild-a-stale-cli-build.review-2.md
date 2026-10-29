# Review — 046 make regraph and eval refuse or rebuild a stale CLI build (round 2)

## Changed

- `packages/code-graph/scripts/ensure-dist.mjs` (new): rebuild-when-stale guard; `--check` refuse mode; now symlink-safe entrypoint detection (`isEntrypoint()` with `realpathSync(argv[1])`).
- `justfile`: `dist-fresh` recipe; `eval` and `regraph` depend on it.
- `packages/code-graph/src/cli.ts`: `describeBuild()`; eval prints a `build:` line (version, dist/cli.js path, mtime).
- `packages/code-graph/src/ensure-dist.test.ts` (new): 20 real-filesystem tests (staleReason, --check, rebuild, symlink invocation).
- `plugin/scripts/code-graph.cjs`: regenerated via `build-plugin.mjs` (minified, 64+/64- lines).

## Did

- @backend: implemented the guard and the build line; in rework, fixed the symlink bypass and regenerated the bundle.
- @test: verified stale/current/refuse/regraph against the real repo (7/7, ~10 ms added when current); added ensure-dist.test.ts.
- @reviewer: FAIL on two blockers (stale committed bundle; symlink fail-open), routed to @backend.

## Deviations from the ticket

- `pnpm check` cannot run in the sandbox (pnpm registry fetch); its scripts (check-versions, check-plugin-clean, prettier --check) pass when run directly.
- Root CLAUDE.md line still pending — @scribe step.
- The committed bundle was regenerated (the ticket put bundle *guarding* out of scope; CLAUDE.md requires a rebuild after src changes).

## Corrections since the last round

- Symlink bypass fixed: entrypoint check now uses `realpathSync`; the symlink test asserts exit 1 (no longer todo).
- Bundle regenerated; `skills/cli.test.ts` "exactly what the source builds to today" now passes. ensure-dist + skills/cli tests: 125/125. `just eval` 7/7.
- Not fixed (out of scope, pre-existing): the same symlink pattern in `check-versions.mjs`, which makes `scribe/ast-stability.test.ts`'s drift case fail under a `/tmp` temp dir.
