# Report r027: 030-make-a-repo-level-skills-stamp-without-bump-refuse-instead-of-resetting-to-1-0.md

- Task: 030-make-a-repo-level-skills-stamp-without-bump-refuse-instead-of-resetting-to-1-0.md
- Written: 2026-10-21T20:39:13.804Z
- From session: maestro-8cdc5b46

Outcome: done, uncommitted, version 0.3.22.
A repo-level `skills stamp` with no --bump over an existing version (scribe.config.json or legacy .claude/concept-skills.json) now exits 1, writes nothing, and names the current version plus --bump minor|major and --bump initial. With no existing version it still stamps 1.0, and --bump initial still resets. The per-skill form is unchanged.
Tests added in skills/cli.test.ts cover the refusal for both sources, the first stamp and the reset, a no-decrease check at repo and skill level, and the CRLF exit-9/--print follow-up from 028.
Docs: the five docs now say "refuses". Version is 0.3.22 in all three files, bundle regenerated.
Checks: package tests 458/458, pnpm check and typecheck green, just eval 7/7 (reported by the test agent; the reviewer did not re-run it).
Findings: none blocking. Only long doc lines, which Prettier accepts.
Post-mortem: clean session, nothing to record.
Suggested ticket changes: none.
