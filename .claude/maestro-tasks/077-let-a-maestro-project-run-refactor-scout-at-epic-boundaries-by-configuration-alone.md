# Let a Maestro project run refactor-scout at epic boundaries by configuration alone

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Maestro already builds a scope file at each epic boundary (start: the tasks' touched surfaces; end: git diff --name-only from the recorded epic base to HEAD) and passes its absolute path to every skill listed in maestro.json start_skills / end_skills, saving each output as a file beside it (per the maestro manager session; maestro repo, assumed, unverified here). So refactor-scout needs no wrapper skill. Two small changes on the code-graph side:

1. Code change in the scout CLI and the refactor-scout plugin skill: every exit-12 case (no code-graph index, no tsconfig or tsconfig key, ts-morph missing) prints its one stderr line with a fixed prefix, `refactor-scout not run: <reason>`, so a saved boundary output says the skill was skipped rather than failed. Still one line and no PROPOSALS: line. Update the existing scout CLI tests that pin these lines.

2. Skill change in code-graph-update: when the project has a .claude/maestro.json whose end_skills does not contain "code-graph:refactor-scout", suggest adding it (end_skills, optionally start_skills), saying it is experimental: epic-boundary use was never measured, it needs the index and a tsconfig, and it can repeat findings a person declined earlier. code-graph-update never edits maestro.json itself and keeps no record of a declined suggestion: it simply suggests again on the next run. Mention the epic-boundary use in the refactor-scout skill's notes too.

Out of scope: remembering declined findings (a later ticket, after a trial epic). Includes rebuilding the committed plugin bundle (pnpm build) and bumping the version in the three version files together.

## Acceptance criteria

- [ ] Every scout exit-12 path prints exactly one stderr line beginning `refactor-scout not run: ` followed by the reason, and no PROPOSALS: line; the scout CLI tests assert the prefix
- [ ] The refactor-scout skill relays that line unchanged and its notes describe use from maestro.json end_skills / start_skills
- [ ] code-graph-update suggests adding code-graph:refactor-scout to end_skills when .claude/maestro.json exists and lacks it, with the experimental caveats, and never edits maestro.json
- [ ] code-graph-update stores no decline: run twice after a No, it suggests again
- [ ] No new skill is added
- [ ] Version bumped in packages/code-graph/package.json, plugin/.claude-plugin/plugin.json and .claude-plugin/marketplace.json together; pnpm build, pnpm check and pnpm test are green and plugin/scripts/code-graph.cjs is regenerated

## Touched surfaces

- packages/code-graph/src/scout/ (run.ts and the scout CLI tests)
- plugin/skills/refactor-scout/SKILL.md
- plugin/skills/code-graph-update/SKILL.md
- plugin/scripts/code-graph.cjs (generated bundle)
- packages/code-graph/package.json, plugin/.claude-plugin/plugin.json, .claude-plugin/marketplace.json (version; this task bumps for its own merge)

## Blocked by

None — can start immediately

## Post-Mortem

- **Problem:** The ticket described maestro.json `end_skills` / `start_skills` as flat lists ("assumed, unverified"); they are objects keyed by caller and only `*.maestro_manager` gets the epic-boundary scope file. @backend followed the ticket wording, so @reviewer failed round 1 and both skills were reworked.
  **Fix:** none
