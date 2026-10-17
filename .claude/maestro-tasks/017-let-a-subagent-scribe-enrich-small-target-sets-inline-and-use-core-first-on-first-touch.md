# Let a subagent scribe enrich small target sets inline and use core-first on first touch

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

In maestro, update-concept-skills and update-single-concept-skill run inside the scribe subagent. That subagent can't spawn Haiku agents, so 0.3.7's "launched by you from the main session" step can't run (update-concept-skills L150, update-single-concept-skill L118, scribe L133-140). The user chose this behaviour for subagents:

- **With the Agent tool** (main session): keep 0.3.7's Haiku fan-out unchanged.
- **Without it** (a subagent: no Agent tool, no AskUserQuestion): with 20 or fewer targets, the scribe enriches them itself (purpose/tags/edge reason, in the same partial format), then runs `enrich merge`, a spot-check and `apply`. With more than 20, it enriches nothing and reports the target list as "left to enrich", to be fanned out from a main session, in its final report (names, filepaths, reasons). maestro doesn't call the enrich commands itself, so this behaviour lives in the skills.
- **First touch:** when the concept has nothing enriched yet, the flows run `enrich targets --core` (task 016); afterwards they use plain `enrich targets`. A thin core reported by 016 goes to update-single-concept-skill to deepen the skill (in a subagent, it's reported, not run).

Keep the version bumps (update = `--bump minor`, single = `--bump major`), the no-tsconfig path (graph steps skipped) and the scribe gap-channel contract text verbatim. Version 0.3.10 in all three files, bundle regenerated if it changes.

## Acceptance criteria

- [ ] update-concept-skills, update-single-concept-skill and the scribe skill give the subagent path: inline enrichment of 20 or fewer targets via enrich merge, spot-check and apply; above 20, no enrichment and a "left to enrich" list in the final report
- [ ] The main-session Haiku fan-out is unchanged
- [ ] The flows use `enrich targets --core` when the concept has nothing enriched, and plain targets afterwards
- [ ] A thin core is routed to update-single-concept-skill (reported, not run, from a subagent)
- [ ] Flows still work with no tsconfig; the gap-channel contract text is unchanged; claude plugin validate, pnpm check and just eval are green; the version is 0.3.10

## Blocked by

- `016-enrich-core-vertices-first-and-measure-gaps-over-the-core.md`
