Ask Claude code to implement a phase with:

Implement phase 1. Read phase-1.md at repo root for full context — this is part of a multi-day, phase-split implementation of the code-graph project (see plan.md only if phase file is missing detail). Seed TaskCreate from the Tasks section of phase-N.md, work through them in order, and mark each task completed as soon as it's done (no batched closes). Verify against the Done-when criteria before declaring the phase complete. Ask for confirmation before destructive or shared-state actions (pnpm link --global, docker volume changes, npm publish, package.json publishes, git pushes).

Watch points:

- Phase 3 (ts-morph symbol resolution edge cases) — verify vertex counts + edge resolution after each run
- Phase 5 (rename detection + diff) — review drift report before approving
- Phase 7 (hybrid re-rank tuning) — may need iteration if BM25 misses
