## Goal
A missing scribe-output/graph.db must never fail the first `pnpm test` in a fresh worktree (desktop real-store test).

## Done
- apps/desktop/test/graph-canvas-real-store.test.ts: suite is now `describe.skipIf(!hasStore)`, with a console.warn naming the missing path and `just store-fresh`, and a comment giving the cause (scribe-output/ is gitignored; turbo runs desktop tests in parallel with `just eval`).
- Mutation check by @backend: store moved aside, old test fails, new test reports 7 skipped; store restored and byte-identical (cmp), enriched files untouched.

## Deviations
None. Chose skipIf over build-in-beforeAll.

## Decisions
ensure-store.mjs has no cross-process lock or atomic write, so building from the test could race `just eval` and corrupt graph.db; the ticket names skipIf as the simpler option in that case.

## Touches
apps/desktop/test/graph-canvas-real-store.test.ts only. ensure-store.mjs, src/main/graph.ts, version and pnpm-lock.yaml untouched.

## Sibling impact
None known. A skipped suite on a fresh worktree means the real-store assertions only run once a store exists.

## Verified
Working tree on top of HEAD 887dd05 (change uncommitted): `pnpm check` green, full `pnpm test` green (desktop 115/115, 7/7 real-store tests with store present, 5/5 turbo tasks). `just eval` not yet run; @test will do it.

## Questions
None.
