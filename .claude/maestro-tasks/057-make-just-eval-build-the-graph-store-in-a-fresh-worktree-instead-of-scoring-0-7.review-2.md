Round 2 (post-build direction review). Round 1 verdict m013: on-track (BUILD over refuse; skip the two optional CLI changes). No redirect to quote.

## Goal
`just eval` never prints 0/7 for a missing, empty or incomplete graph store; it builds the missing concepts first, or stops naming `just regraph`.

## Done
- New `packages/code-graph/scripts/ensure-store.mjs` (node only, no pnpm/network): per concept in scribe.config.json checks live vertices or a docs row without ever opening a missing db; builds only missing concepts via `dist/cli.js --root <root> extract` + `apply`; prints `store: built just now from <root> (<concepts>; extract + apply)`; build failure or missing dist exits 3 with one line ending `then run: just regraph` and never prints "built just now". `--check` reports and exits 1 without building.
- justfile: `store-fresh: dist-fresh`; `eval` and `eval-as-is` depend on it and pass `--root {{justfile_directory()}}` (results land in the invoking checkout).
- Root CLAUDE.md working-rules bullet, including that a bare `code-graph eval` outside `just` has no guard and can print 0/7 for an empty store.
- 12 tests in `packages/code-graph/src/ensure-store.test.ts`.

## Deviations
- None from the ticket or the m013 conditions. No CLI source change, so no bundle regeneration; no version bump; pnpm-lock.yaml not touched by this work (it was already modified before the task).
- Process note: for the fresh-worktree check the backend agent temporarily symlinked the main checkout's node_modules into a throwaway worktree (since removed). It did not install anything. A real fresh worktree still needs one `pnpm install` by the user.

## Decisions
- Conditions from m013: (a) a complete store is never touched, partial store rebuilds only missing concepts and leaves enriched files alone; (b) built line names concepts and root; (c) documented in CLAUDE.md; (d) tests for stub-cli build failure and a partial store (one concept missing), plus missing, empty, non-sqlite, dbPath override, archived-only, --check, no concepts, missing dist.

## Touches
packages/code-graph/scripts/ensure-store.mjs (new), packages/code-graph/src/ensure-store.test.ts (new), justfile, CLAUDE.md (root), .claude/channels/task-057/test/backend.1.md.

## Sibling impact
Anything that calls `just eval` / `just eval-as-is` now first runs store-fresh and passes --root. Tickets editing the same justfile recipes should rebase on this.

## Verified
There is NO commit yet: the work is uncommitted in the main checkout (HEAD d17cc09), so nothing is verified "on a commit". On that working tree the backend reported: `pnpm check` green, `pnpm test` 701 pass / 0 fail, `just eval` 7/7 (silent no-op for the store, `store:` line unchanged). `just eval` in a throwaway git worktree at HEAD (uncommitted justfile + script copied in; node_modules symlinked temporarily): dist-fresh rebuilt, store-fresh built all 3 concepts (line named the worktree path), eval 7/7, results landed in the worktree. @test and @reviewer have not yet run; I will re-verify and report on a commit once the user asks for one.

## Questions
1. Is it acceptable to continue to @test and @reviewer on the uncommitted tree, with the commit coming at the user's request?
