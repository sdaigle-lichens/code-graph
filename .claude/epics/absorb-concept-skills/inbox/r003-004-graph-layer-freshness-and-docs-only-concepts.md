# Report r003: 004-graph-layer-freshness-and-docs-only-concepts.md

- Task: 004-graph-layer-freshness-and-docs-only-concepts.md
- Written: 2026-10-14T13:28:30.323Z

Task 004 (graph-layer freshness and docs-only concepts): done, nothing committed.

Outcome: all acceptance criteria met. Build, typecheck, pnpm test (code-graph 239, desktop passing), pnpm check and just eval (6/6, incl. new task-6-docs-only-concept) are green.

Findings:
- Reviewer first FAILED on isDocsOnly treating extension-less globs (src/**) as docs-only even with a tsconfig; fixed (docs-only only when no tsconfig or all globs have explicit non-code extensions) plus a prettier fix on skills/commands.ts. Second review passed.
- drift --json 'changed' compares ast.json to the store, so extract must run before drift. Documented in docs/usage.md and the plugin update-concept-skills skill.
- Desktop graph.test.ts counts changed (128/314/2) because the repo now has the docs-only concept-skills-layer concept; apps/desktop/src/main/graph.ts got a tsconfig ?? "" fix.
- skills status: malformed shas now report unknownFreshness reason malformed-sha; mixed LF/CRLF stamping test added.
- Backend omitted a channel payload once and needed a resume.
- Untracked plan.md at repo root predates this work.

Suggested ticket changes: none. Downstream tickets can rely on tsconfig being optional, resolveConceptSkillPath, and the graph block in skills status --json.
