## Changed

- `packages/code-graph/scripts/check-versions.mjs`: new `isEntrypoint()` compares `realpathSync(argv[1])` with `realpathSync(fileURLToPath(import.meta.url))`, false on any error.
- `packages/code-graph/scripts/check-plugin-clean.mjs`, `packages/code-graph/scripts/build-plugin.mjs`, `bench/strip-concept-skills.mjs`: same symlink-unsafe comparison fixed through realpath.
- `packages/code-graph/src/scribe/ast-stability.test.ts`: two new tests (run through a symlinked dir exits 1 with "version drift"; import does nothing, exit 0, empty stderr).
- `plugin/scripts/`: no diff after bundling.

## Did

- @backend: fixed the four scripts, added the tests. Package suite 514/514, `just eval` 7/7, check-versions, check-plugin-clean, prettier and `tsc --noEmit` clean.

## Deviations from the ticket

- Fixed three scripts beyond check-versions (check-plugin-clean, build-plugin, bench/strip-concept-skills); the ticket asks for any copies of the check.
- `ensure-dist.mjs` was already safe, unchanged.
- `pnpm check` and `pnpm bundle` were not run themselves (registry unreachable in the sandbox); build-plugin.mjs was run directly.
