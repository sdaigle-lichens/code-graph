# Let a subagent enrich up to 20 targets and leave the rest, and read targets in summary form

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Follow-up to maestro's end-to-end check of 0.3.11. It uses task 019's lazy default, `--summary` and `--all`.

**1. Partial inline enrichment, not all-or-nothing.** Today a subagent (no Agent tool) enriches every target when there are 20 or fewer, and nothing above that (scribe SKILL.md L151-154, update-concept-skills L156-158, update-single-concept-skill L116-123). In maestro's check, the scribe named a few more exports in agents-view's file map, and the core went from 18 to 22 within the same run. That crossed the limit and turned 18 inline enrichments into zero. New rule: a subagent enriches up to 20 targets inline and lists the rest under "left to enrich" for a main session. Order: changed and stale first, then vertices named in SKILL.md, then hubs, then the rest. When the run's own SKILL.md edit grew the core, the report says so ("core grew from N to M with this run's skill edit"). The main-session Haiku fan-out is unchanged.

**2. Read targets in summary form.** The flows call `cg enrich targets <c> --summary --json` to decide (counts, core block, target lines). Each batch, whether a Haiku subagent or the inline subagent, reads full details with `--json --vertex <k>...` for its own targets only. Drop the "first touch: use --core" step, since lazy is now the default in 019. Keep the thin-core routing to update-single-concept-skill.

**3. A revised SKILL.md doesn't mean every vertex.** The whole-concept path (update-concept-skills L162-164, the scribe skill's "Whole-concept path") now re-enriches the vertices already enriched (their descriptions read the skill) plus the core. Never-enriched non-core vertices stay lazy. `--all` is only for an explicit full pass the user asks for.

**Note from 019 (r017).** 019 already moved part of the skill text to `--summary --json` and `--vertex`, and `--vertex` now *narrows* the output to the named vertices (before, it added them). Start from the current text, and rewrite only what's still all-or-nothing or still says "first touch: --core". A target the subagent leaves out keeps `agent.touched_at` until it's enriched, so it stays a target on the next run; the "left to enrich" list can say so.

**4. Ride-alongs from r017 (code, so the bundle changes).**
- An approved rename of a never-enriched vertex (`apply --approve-drift`, apply.ts ~434-456) isn't stamped `agent.touched_at`, so a renamed non-core vertex isn't a target. Stamp it when `conceptWasApplied && !merged.purpose`, and add a test for it.
- enrich.test.ts:353-355 doesn't assert the exit codes of merge and apply; assert them.

Keep the version bumps (update = `--bump minor`, single = `--bump major`), the no-tsconfig path and the gap-channel contract text verbatim. Version 0.3.13 in all three files, bundle regenerated.

## Acceptance criteria

- [ ] The three skills tell a subagent to enrich up to 20 targets inline (changed/stale, then SKILL-named, then hubs) and list the rest under "left to enrich"; nothing is all-or-nothing any more
- [ ] The report says when this run's own SKILL.md edit grew the core
- [ ] The flows decide with `enrich targets --summary --json` and give each batch only its own targets' full details via `--json --vertex`
- [ ] The whole-concept path on a revised SKILL.md covers the enriched vertices plus the core; `--all` is only for an explicit full pass
- [ ] An approved rename of a never-enriched vertex after the concept's first apply is a target (a test covers it); enrich.test.ts:353-355 asserts the merge/apply exit codes; pnpm test is green and the bundle is regenerated
- [ ] The main-session Haiku fan-out, thin-core routing, version bumps, the no-tsconfig path and the gap-channel contract text are unchanged; claude plugin validate, pnpm check and just eval are green; the version is 0.3.13

## Blocked by

- `019-keep-enrich-targets-lazy-after-the-first-touch-and-give-it-a-summary-form.md`
