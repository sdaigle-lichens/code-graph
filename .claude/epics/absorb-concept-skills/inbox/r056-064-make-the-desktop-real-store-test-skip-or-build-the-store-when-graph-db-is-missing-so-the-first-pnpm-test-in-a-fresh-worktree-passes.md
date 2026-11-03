# Report r056: 064-make-the-desktop-real-store-test-skip-or-build-the-store-when-graph-db-is-missing-so-the-first-pnpm-test-in-a-fresh-worktree-passes.md

- Task: 064-make-the-desktop-real-store-test-skip-or-build-the-store-when-graph-db-is-missing-so-the-first-pnpm-test-in-a-fresh-worktree-passes.md
- Written: 2026-11-02T21:21:59.402Z
- From session: absorb-concept-skills-064

Outcome: task 064 done. apps/desktop/test/graph-canvas-real-store.test.ts now uses describe.skipIf(!hasStore) with a console.warn naming `just store-fresh`, and a comment giving the cause (scribe-output/ gitignored; turbo runs desktop tests in parallel with `just eval`). Chose skipIf over build-in-beforeAll because ensure-store.mjs has no cross-process lock, so a concurrent build could corrupt graph.db.

Verified: commit 16741a1. pnpm check green, full pnpm test green, just eval 7/7 (run twice by @test). Mutation check: store moved aside -> old test fails, new test 7 skipped, 0 failed; store restored byte-identical (cmp). With store present 7/7 pass; an injected off-by-one failed exactly one test.

Findings: `just eval` rewrites graph.db header bytes (content logically identical: same row counts/hashes). Not caused by this change; @reviewer judged it immaterial. console.warn fires at module load, so it prints even when the file is filtered out (noise only). docs: @scribe found nothing to change.

Not done on purpose: no version bump, pnpm-lock.yaml not committed, ensure-store.mjs and src/main/graph.ts untouched.

Suggested ticket changes: optionally a follow-up giving ensure-store a lock/atomic write, which would allow the build-in-test option; optionally a line in docs/development.md near `pnpm test`.
