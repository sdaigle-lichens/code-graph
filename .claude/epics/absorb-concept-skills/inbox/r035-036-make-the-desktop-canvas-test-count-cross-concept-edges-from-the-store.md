# Report r035: 036-make-the-desktop-canvas-test-count-cross-concept-edges-from-the-store.md

- Task: 036-make-the-desktop-canvas-test-count-cross-concept-edges-from-the-store.md
- Written: 2026-10-27T01:49:21.702Z
- From session: absorb-concept-skills-036

Outcome: done. Clean session, no loop-backs.
Changed only apps/desktop/test/graph-canvas-real-store.test.ts. truth() now reads skipped and skippedCross from the store; l.skipped is asserted against it. A new test requires at least one skipped crosses_concept=1 edge and fails with a pointer to just regraph if there are none. The describes assertions are kept. No canvas, packages/code-graph or plugin changes, no version bump.
Verification: pnpm check 6/6, pnpm test 5/5 from the root (code-graph 492/492). The reviewer forced a fresh desktop run: 115/115. The root test result came from turbo cache.
Findings: no docs needed changes (docs/development.md already describes the skip generically).
Suggested ticket changes: none. Drawing cross-concept edges on the canvas remains a possible separate design ticket.
