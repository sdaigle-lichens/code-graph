# Report un-enriched search hits through the gap channel so they get enriched

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Since 016/019, never-enriched non-core vertices stay lazy: they're enriched only when a task edits them or a gap names them. maestro's check showed the gap this leaves. `search "how an agent's description is edited"` returned setAgentDescription, the function named for exactly that, but it isn't in the core, so it was listed with no purpose. Code that a search finds and an agent relies on is a better enrichment signal than an edit, and today nothing reports it.

**1. Make un-enriched hits visible (CLI).** In plain-text search (`formatSearch`, query/search.ts ~L403-407), a hit with no purpose just has no ` — purpose` suffix, so an agent can't tell "not enriched" from "nothing to say". Mark it, e.g. ` — _not enriched_`. In --json, `purpose` is already absent or null; keep that and don't add fields that cost budget.

**2. Retrieval reports the un-enriched hits it used (skill).** In `plugin/skills/code-graph-retrieval/SKILL.md` ("Reporting the gap (subagents)", ~L109-127): after answering, if the answer relied on hits marked not enriched, append one entry through the same channel and contract, verbatim: `{ "skill_gaps": [{ "skill", "missing" }] }`, with `skill` = the hit's concept skill and `missing` = "enrich only: <name> (<filepath>), ... — found by search \"<query>\"". Rules:
- Only hits the answer actually used, not every un-enriched hit in the output.
- At most 5 vertices per entry.
- Dedupe per session by (skill, vertex).
- Keep all existing file rules: one json block merged in place, a leading run_id line kept, no run_id written, the bare agent name, and main-session gaps not promised to be inlined.

This isn't a weak-search gap, so word it so the scribe doesn't revise the SKILL.md for it.

**3. The scribe and update-single-concept-skill close an "enrich only" gap without touching the skill.** update-single-concept-skill's "Only a reported gap to close" branch (~L118-127) already enriches named vertices via `enrich targets --vertex`. Make an "enrich only" gap take that branch directly: no research pass, no SKILL.md edit and no `skills stamp` (the skill text didn't change, so no major bump). Enrich the named vertices (subagent: inline, within 020's 20-target rule), then `enrich merge`, a spot-check and `apply`. The scribe skill's gap section says the same. The gap-channel contract text stays verbatim (maestro depends on it).

The no-tsconfig path is unchanged: with no graph there are no hits to mark. Version 0.3.14 in all three files, bundle regenerated. Runs after 020, which edits the same skills.

## Acceptance criteria

- [ ] Plain-text search marks a hit with no purpose as not enriched; --json is unchanged; a test covers the marker
- [ ] code-graph-retrieval tells an agent to append one "enrich only" skill_gaps entry for un-enriched hits its answer used (5 or fewer per entry, deduped per session by skill and vertex), following every existing gap-file rule
- [ ] update-single-concept-skill and the scribe skill close an "enrich only" gap by enriching the named vertices, with no SKILL.md edit and no skills stamp
- [ ] The gap-channel contract text is unchanged; claude plugin validate, pnpm check, pnpm test and just eval (7/7) are green; the version is 0.3.14 in all three files and the bundle is regenerated

## Blocked by

- `020-let-a-subagent-enrich-up-to-20-targets-and-leave-the-rest-and-read-targets-in-summary-form.md`
