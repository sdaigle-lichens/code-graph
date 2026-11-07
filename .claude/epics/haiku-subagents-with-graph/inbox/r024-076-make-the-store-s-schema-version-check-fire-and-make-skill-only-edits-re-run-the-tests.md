# Report r024: 076-make-the-store-s-schema-version-check-fire-and-make-skill-only-edits-re-run-the-tests.md

- Task: 076-make-the-store-s-schema-version-check-fire-and-make-skill-only-edits-re-run-the-tests.md
- Written: 2026-11-07T19:21:43.597Z
- From session: haiku-subagents-with-graph-076

Outcome: ticket 076 done on branch 076-schema-version (from 075-refactor-scout), version 0.3.44, nothing pushed.
Verified commit: fbbc18d (on top of 2d70eeb). On fbbc18d: pnpm verify 14/14 tasks green, just eval 7/7.
Done: the schema-version check fires on every store command (20 commands exit 3 on a newer store, version unchanged, incl. skills status and refresh-skills; refresh-skills --hook exits 0 with a systemMessage, tested); turbo test inputs include plugin/skills and plugin/agents (dry run only); shared leavesRoot in scout/root.ts; todo and limitation notes removed; bundle regenerated.
Findings: the new tests were never run against the pre-fix code, and no real skill-only edit was run through turbo to see a cache miss. enrich merge opens the store twice (harmless). The scribe did not stamp the edited skills; a skill version bump is left to you.
Post-mortem: one manager redirect (skills status and refresh-skills were first left out).
