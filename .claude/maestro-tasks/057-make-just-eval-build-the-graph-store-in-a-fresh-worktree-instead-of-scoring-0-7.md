# Make just eval build the graph store in a fresh worktree instead of scoring 0/7

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Found by 048: in a freshly created git worktree there is no scribe-output/graph.db (it is gitignored), so `just eval` scores 0/7 until someone runs `just regraph`. A worker reads that as a regression. Also, an eval run by an agent from the main checkout's cwd wrote its results into the main checkout instead of the worktree. Make the eval gate notice when the store is missing or empty (or holds none of this repo's concepts) and build it first, the same way `dist-fresh` rebuilds a stale dist: either run the regraph steps, or refuse with a one-line message naming `just regraph`. Decide which before implementing. A refusal must not look like a 0/7 result. Keep it sandbox-safe (no pnpm, no network), like ensure-dist.mjs. This is a change to the justfile recipes and the eval/regraph scripts or eval command (code, with tests if it touches the CLI), plus docs (the root CLAUDE.md working rules and docs/usage.md if the CLI changes). Regenerate the plugin bundle only if CLI source changes.

## Acceptance criteria

- [ ] In a fresh worktree with no graph.db, `just eval` either builds the store and reports 7/7, or stops with a clear message naming `just regraph`; it never prints 0/7 for a missing store
- [ ] With a current store, `just eval` behaves and performs as today
- [ ] The eval's output names the store it measured, the way its `build:` line names the build
- [ ] The chosen behaviour is documented in CLAUDE.md's working rules; `pnpm check` green and `just eval` 7/7

## Blocked by

None — can start immediately
