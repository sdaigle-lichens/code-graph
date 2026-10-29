# Report r002: 047-make-check-versions-run-directly-check-symlink-safe.md

- Task: 047-make-check-versions-run-directly-check-symlink-safe.md
- Written: 2026-10-29T22:34:11.762Z
- From session: haiku-subagents-with-graph-047

Outcome: 047 done. check-versions.mjs, check-plugin-clean.mjs, build-plugin.mjs and bench/strip-concept-skills.mjs now compare realpaths for their run-directly check (ensure-dist.mjs was already safe). Tests added in ast-stability.test.ts (2) and script-symlink.test.ts (4). Package suite green, the scribe drift case passes, plugin bundle unchanged. Docs: one bullet in packages/code-graph/CLAUDE.md.
Findings: isEntrypoint is copy-pasted in five scripts in three forms (possible shared-helper follow-up; bench needs its own copy). build-plugin symlink path verified manually only. just eval 7/7 reported by backend but not re-run by test or reviewer; pnpm check not runnable in the sandbox.
Post-mortem: none, clean session.
Suggested ticket changes: none.
