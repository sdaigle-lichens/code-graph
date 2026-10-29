# Review — 046 make regraph and eval refuse or rebuild a stale CLI build (round 1)

## Changed

- `packages/code-graph/scripts/ensure-dist.mjs` (new): mtime check of compiled `src/**/*.ts(x)` (excluding `*.test.ts`, `*.d.ts`) vs `dist/*.js`, plus `tsconfig.json` and missing `dist/cli.js`; when stale, runs the package's own `node_modules/typescript/bin/tsc -p tsconfig.json --noEmitOnError`. `--check` mode refuses with one line naming the rebuild command instead. Exports `staleReason()`.
- `justfile`: new `dist-fresh` recipe; `eval` and `regraph` depend on it.
- `packages/code-graph/src/cli.ts`: `describeBuild()`; `eval` prints `build: code-graph <version>, <dist/cli.js path> built <mtime ISO>`.

## Did

- @backend: chose **Rebuild when stale** (not Refuse, not always-rebuild), implemented the guard and the eval build line, verified stale/current/missing-output/type-error cases; `just eval` 7/7 in both stale and current runs.

## Deviations from the ticket

- `pnpm check` could not run in the sandbox (pnpm fetches its pinned 11.9.0 from the registry). Its constituent scripts were run directly: `check-versions.mjs` OK, `check-plugin-clean.mjs` OK, `prettier --check` clean.
- Root CLAUDE.md line not yet added — deferred to @scribe by design (suggested line in the backend report).
- `status`, `reindex` and the pilot recipes, which call the global `code-graph` binary, are left unguarded.

## Risks / open questions

- Cost: guard ~44 ms when current (~10 ms over bare node startup); a stale rebuild ~0.8 s. `--incremental` (0.35 s no-op) was rejected to avoid a tsbuildinfo file.
- `--noEmitOnError`: a type error in `src/` blocks eval/regraph until it is fixed, so a broken build never runs.
- A rebuild does not regenerate `plugin/scripts/code-graph.cjs` (out of scope; `pnpm bundle` covers it).
