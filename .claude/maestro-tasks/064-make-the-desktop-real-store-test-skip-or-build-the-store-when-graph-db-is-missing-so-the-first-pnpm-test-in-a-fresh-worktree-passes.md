# Make the desktop real-store test skip or build the store when graph.db is missing, so the first pnpm test in a fresh worktree passes

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

apps/desktop/test/graph-canvas-real-store.test.ts copies and reads <repo>/scribe-output/graph.db (projectCopy() at line 22 and truth() at line 28). scribe-output/ is gitignored, so in a fresh git worktree the file does not exist on the first `pnpm test`. Turbo runs the desktop vitest in parallel with `just eval`, which builds the store through ensure-store (ticket 057), so the test races the build and fails with a missing-file error. It passes on a second run once the store exists. Fix the test so a missing store never fails the suite on a first run. Preferred: build the store in the test's own setup (beforeAll) the way 057's packages/code-graph/scripts/ensure-store.mjs does, by calling that script with `node` and `--root <repo>`, then fall back to the existing assertions. It is a no-op when every concept is present, so it must not rewrite an existing store or enriched file. Make sure two concurrent builders (this test and `just eval`) cannot corrupt the store; if ensure-store has no guard for that, prefer the simpler option: `describe.skipIf(!fs.existsSync(storePath))` with a clear skip reason naming `just store-fresh`. Pick one, state why in the report. Do not change src/main/graph.ts behaviour, do not add network, pnpm or install steps, and keep it sandbox-safe. Do not bump the version; the merger does.

## Acceptance criteria

- [ ] In a fresh git worktree with no scribe-output/graph.db, the first `pnpm test` from the root passes (or reports the real-store tests as skipped with a reason that names how to build the store), with no missing-file failure.
- [ ] With an existing store, the test runs exactly as before and asserts against the real store; an existing graph.db and *.enriched.json are not modified.
- [ ] The test comment or skip message names the real cause: scribe-output/ is gitignored and turbo runs desktop tests in parallel with `just eval`.
- [ ] Mutation check: with the store deleted, the old test fails and the new one does not; reported in the report.
- [ ] pnpm check, pnpm test and just eval stay green (eval 7/7). pnpm-lock.yaml is not committed.

## Touched surfaces

- apps/desktop/test/graph-canvas-real-store.test.ts
- packages/code-graph/scripts/ensure-store.mjs (read; change only if the build option needs it)

## Blocked by

None — can start immediately
