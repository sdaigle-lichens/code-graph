# Review 077, round 1 (manager review run as a human review: task is in no epic)

## Goal
Let a Maestro project run refactor-scout from maestro.json end_skills / start_skills with no wrapper skill:
exit-12 lines carry a fixed `refactor-scout not run: ` prefix, code-graph-update suggests the entry.

## Changed
- packages/code-graph/src/scout/run.ts: new exported `SCOUT_NOT_RUN_PREFIX`; all four exit-12 cases
  (no store / no live vertex, no tsconfig key, tsconfig file missing, ts-morph missing) use it. Reason text unchanged.
- scout-cli.test.ts, scout-cli-gaps.test.ts, scout-cli-exits.test.ts: assert the prefix and no PROPOSALS: line;
  one skill-text test updated for the new SKILL.md wording.
- plugin/skills/refactor-scout/SKILL.md: relay the line unchanged; new "Use at Maestro epic boundaries" section.
- plugin/skills/code-graph-update/SKILL.md: new step 6 (suggest end_skills entry, experimental caveats,
  never edit maestro.json, record nothing on decline); description updated; report becomes step 7.
- Version 0.3.44 -> 0.3.45 in package.json, plugin.json, marketplace.json; plugin/scripts/code-graph.cjs regenerated.

## Did
- @backend: all of the above.

## Deviations from the ticket
None. Exit 11 / 13 lines keep the plain `refactor-scout: ` prefix (ticket scopes the change to exit 12).

## Decisions
- Prefix is one exported constant so tests and future callers share it.
- code-graph-update says nothing when the entry is present or there is no maestro.json.

## Sibling impact
078 (concept skills from the stop hook / scribe) may touch code-graph-update; no overlap with step 6 expected.
Unrelated in the working tree: the /maestro-update runtime refresh (.claude/scripts, settings, .prettierignore, etc.).

## Questions
None.

## Verified
Uncommitted working tree on top of bdda504. pnpm test: 960/960 pass; pnpm check green; pnpm build ran (bundle regenerated).
