# Report r047: 055-show-the-left-out-core-size-beside-first-time-builds-in-update-concept-skills.md

- Task: 055-show-the-left-out-core-size-beside-first-time-builds-in-update-concept-skills.md
- Written: 2026-11-01T01:09:42.404Z
- From session: maestro-79ee2ebd

## Outcome
Task 055 done. plugin/skills/update-concept-skills/SKILL.md, step "Size the enrichment before any fan-out": each first-time build is now printed with its core.leftOut (`first-time build: <concept> - total T, core.leftOut L`, read from the re-run's concepts[] entry), and the text says a total of 0 can still hide a first-time build's real size and must never be read as nothing to do.

## Verification
Nothing was committed, so no commit was verified. The full test suite was NOT run (skill text only; no CLI or bundle change). Sandbox checks: check-versions.mjs and check-plugin-clean.mjs printed no errors (exit codes not captured); prettier --check on the edited file passes. Repo-wide prettier fails on about 139 pre-existing files plus sandbox EACCES, unrelated to this edit. Full `pnpm check` should be run from a plain terminal.

## Findings
Skill-text-only diff, 6 insertions and 2 deletions. No deviations from the ticket. Clean session, no post-mortem.

## Suggested ticket changes
None.
