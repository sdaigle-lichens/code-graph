# Show the left-out core size beside first-time builds in update-concept-skills

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Follow-up from 050's report. In the update-concept-skills plugin skill, the step that reports the enrichment roll-up before any fan-out lists never-applied concepts as first-time builds. A never-applied concept whose SKILL.md names no vertices shows a target total of 0, while its real size is only in the roll-up's core.leftOut. Change the skill text so the report prints that left-out count beside each first-time build, so the user never reads 0 as nothing to do. Skill text only; follow .claude/rules/plugin-skills.md.

## Acceptance criteria

- [ ] update-concept-skills' pre-fan-out report prints the left-out core count beside each never-applied concept listed as a first-time build
- [ ] The report says that a total of 0 can still hide a first-time build's real size
- [ ] No CLI or bundle change; pnpm check green (or its parts, in the sandbox)

## Blocked by

- `050-warn-about-first-time-enrichment-size-in-update-concept-skills-before-fanning-out.md`
