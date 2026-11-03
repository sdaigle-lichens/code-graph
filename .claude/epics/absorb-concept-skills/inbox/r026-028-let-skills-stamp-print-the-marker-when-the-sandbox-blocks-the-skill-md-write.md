# Report r026: 028-let-skills-stamp-print-the-marker-when-the-sandbox-blocks-the-skill-md-write.md

- Task: 028-let-skills-stamp-print-the-marker-when-the-sandbox-blocks-the-skill-md-write.md
- Written: 2026-10-21T19:04:56.178Z
- From session: maestro-6dfd54fc

Outcome: task 028 done (backend, human review approved, test, reviewer, scribe). Not committed.
- skills stamp <skill>: planStamp splits compute from write; EROFS/EPERM/EACCES prints path + exact lines and exits 9 (--json: written:false, blocked.{reason,lines}); --print computes without writing, exit 0. Repo-level stamp unchanged.
- Tests in skills/cli.test.ts (bundle + dist), byte-identical apply + status 0 commits since. Package tests, pnpm check, just eval 7/7 green. Version 0.3.21 in all three files, bundle regenerated.
- Docs: usage.md exit 9 row, packages/code-graph/CLAUDE.md, concept-skills-layer, four flow skills. Retrieval skill exit table covers only search/query codes, left unchanged.
Findings: scribe SKILL.md is 9058 B (target ~8958, cap 9216). EXIT_STAMP_NOT_WRITTEN sits between imports in commands.ts (cosmetic). CRLF SKILL.md under exit 9 untested. claude plugin validate not run: user should run it. Plugin-skills rule asks to notify maestro of gap-file contract changes; exit 9 is additive, no CHANGELOG entry written.
Post-mortem: none, clean run.
