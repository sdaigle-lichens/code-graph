# Report r001: 046-make-regraph-and-eval-refuse-or-rebuild-a-stale-cli-build.md

- Task: 046-make-regraph-and-eval-refuse-or-rebuild-a-stale-cli-build.md
- Written: 2026-10-29T22:13:41.856Z
- From session: haiku-subagents-with-graph-046

## Outcome — 046 done (not committed)

Design: **Rebuild when stale.** New `just dist-fresh` (packages/code-graph/scripts/ensure-dist.mjs) is a dependency of `just eval` and `just regraph`: mtime check of compiled src vs dist outputs (+ tsconfig, missing dist/cli.js); when stale, rebuilds with the package's own tsc `--noEmitOnError` (no pnpm, no network, sandbox-safe). `--check` = refuse-only mode (one line naming the rebuild command). Rationale: a rebuild is ~0.8 s, refusing only adds the manual step that was missed on 2026-10-29. Cost when current: ~8-10 ms over bare node startup. Eval now prints `build: code-graph <version>, <dist/cli.js> built <mtime>`. Root CLAUDE.md Working rules gained one line. Plugin bundle regenerated (cli.ts changed).

Verification: `just eval` 7/7 in stale and current cases; `just regraph` rebuilds first; new src/ensure-dist.test.ts (21 real-fs tests); package suite 511/512 (the 1 is pre-existing, see below). `pnpm check` cannot run in the sandbox (pnpm registry fetch); check-versions, check-plugin-clean, prettier and tsc --noEmit are clean.

## Findings

- `check-versions.mjs` has a non-symlink-safe run-directly check (`path.resolve(argv[1])` vs `fileURLToPath(import.meta.url)`); it fails `scribe/ast-stability.test.ts`'s drift case when the temp dir is under /tmp. Pre-existing, out of scope.
- Staleness is mtime-only; dist outputs of deleted sources are not detected (harmless for the gate).
- Global-binary recipes (status, reindex, pilot) are unguarded by design.

## Post-mortem

- Reviewer loop-back: @backend left the committed plugin bundle stale after changing cli.ts (read "bundle out of scope" as "don't touch it").
- ensure-dist.mjs copied check-versions.mjs's symlink-unsafe entrypoint check; caught by @test, fixed in rework.

## Suggested ticket changes

- New small ticket: make `check-versions.mjs`'s run-directly check symlink-safe (realpathSync), turning the ast-stability drift case green.
- Ticket templates touching src/: state that "bundle out of scope" still requires regenerating the bundle when src changes.
