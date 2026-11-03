# Make the desktop canvas test count cross-concept edges from the store

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

034 (0.3.27) made `extract` emit `calls` edges into other concepts' vertices. The 035 worker then found
`apps/desktop/test/graph-canvas-real-store.test.ts` failing: the "describes edge ... is skipped" case
expects `l.skipped` to be 1 for `code-graph-search` and gets 23.

The canvas is right. Per `apps/desktop/CLAUDE.md`, it skips and counts every edge whose endpoint is
outside the concept. The store now holds 22 cross-concept `calls` edges in addition to the `describes`
edge, so 23 is the correct count. The test is wrong: it hard-codes 1, while the rest of the file already
reads its ground truth from the store (`truth()`) so it follows this repo's graph as it is regraphed.

Fix the test, not the canvas:
- Extend `truth()` so it also returns how many of the concept's edges have an endpoint that won't be a
  layout node. That means anything that is neither a live vertex of the concept nor the concept's skill
  doc: the `describes` edge, and edges to other concepts' vertices or to non-live ones. Read it straight
  from the source store, as `truth()` already does.
- Assert `l.skipped` against that number. Keep the existing `describes` assertions: the edge points at
  the concept key, it's skipped, it isn't drawn, and nothing throws.
- Add an explicit check that at least one cross-concept edge (`crosses_concept = 1`) is skipped, so the
  test covers 034's edges instead of only tolerating them. If the local store has none, the check should
  say so plainly rather than pass vacuously.

Run the whole suite (`pnpm test` from the root), not only the desktop filter. 034 was verified on the
package tests alone, which is how this failure was missed.

Out of scope: drawing cross-concept edges, or the other concept's vertices, on the canvas (a design
change; propose it as a separate ticket if worthwhile); any change under `packages/code-graph` or
`plugin/`; a version bump (desktop tests only, nothing ships in the plugin).

## Acceptance criteria

- [ ] `graph-canvas-real-store.test.ts` takes the expected skipped count from the store, not a constant, and passes on this repo's current graph
- [ ] The test asserts that cross-concept edges are among the skipped ones, and fails clearly if the store has none
- [ ] The `describes` assertions are kept
- [ ] No change to the canvas code or to `packages/code-graph`
- [ ] `pnpm check` and the full `pnpm test` from the root are green

## Blocked by

- `034-record-cross-concept-calls-at-extract-time.md` (the edges this test must account for)
