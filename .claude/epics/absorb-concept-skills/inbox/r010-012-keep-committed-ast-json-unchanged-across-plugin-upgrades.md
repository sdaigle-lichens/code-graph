# Report r010: 012-keep-committed-ast-json-unchanged-across-plugin-upgrades.md

- Task: 012-keep-committed-ast-json-unchanged-across-plugin-upgrades.md
- Written: 2026-10-16T22:19:34.424Z
- From session: code-graph-d6

Outcome: task 012 done in worktree task-012 (/home/superadmin/gits/code-graph-task-012), uncommitted, unmerged. Version 0.3.5 in all three files, bundle regenerated. pnpm test 273/273, pnpm check green, just eval 7/7. Human review approved.

Changes: the extractor version is recorded once in .ast.json meta; vertices no longer carry ast.extractor_version (edges never did). apply stamps the store's per-vertex ast.extractor_version from meta; a per-vertex value in an older file wins, and older files still apply. Meta (version and extracted_at) is kept whole when vertices, edges and skill are unchanged, so a plugin upgrade alone leaves .ast.json byte-identical. meta.extractor_version therefore means "the version that last changed this file's content" (documented). SCHEMA_VERSION unchanged. Docs updated: docs/usage.md, packages/code-graph/CLAUDE.md, scribe-pipeline skill.

For maestro: the first extract after 0.3.5 rewrites each committed .ast.json once, to drop the per-vertex field. Commit just that rewrite; after that, upgrades touch nothing.

Findings: the comparison also includes the skill block (spec said vertices and edges only), so a skill-only change advances extracted_at; user approved. Unchanged vertices are not re-stamped by apply, so their store extractor_version stays as first written. No test covers a skill-only or edge-only change. Worktree needed pnpm install --offline and a copied gitignored graph.db for desktop tests.

Post-mortem: clean session, nothing to record.

Suggested ticket changes: optionally add a skill-only-change test. Merge of task-012 is pending the user.
