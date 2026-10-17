# Enrich core vertices first and measure gaps over the core

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

maestro's first-touch enrichment is too big: with nothing enriched, `enrich targets` (scribe/enrich.ts:127) lists every vertex as `new` (claude-session-bridge: 274). maestro's scribe is a subagent that can only enrich about 20 vertices inline (task 017). So the first touch should cover only the concept's core, and the rest stays lazy, as 0.3.7 already does: changed, stale and named vertices become targets when a task touches them.

**Core** = live vertices whose name appears in the concept's SKILL.md (an identifier match on word boundaries; skip names shorter than 3 characters so `id`/`get` don't match prose), plus hubs: vertices with 3 or more inbound `calls`/`mounts` edges whose source is in the same concept. Put this in one pure function over (vertices, edges, skill body), shared by enrich and gaps. maestro measured its 16 concepts: SKILL-named median ~13 (range 2-39), hubs median ~9 (0-37). The extractor emits no cross-concept edges, so "used elsewhere" isn't available as a signal.

1. `code-graph enrich targets <concept> --core`: restrict the new-vertex targets to core vertices. Changed, stale and `--vertex`-named targets still appear even outside the core, so lazy enrichment keeps working. Text and --json both say which targets are core (e.g. a `core` reason or flag) and how many non-core vertices were left out.
2. gaps.ts: measure `enrichedRatio` (0.9, gaps.ts:21) over a concept's core vertices, falling back to all live vertices when the core is empty. Otherwise a concept enriched core-only reads as un-enriched forever. Feed the same core function from the store (the concept's docs row body and its in-concept edges).
3. Thin core: when a concept has 50 or more live vertices and fewer than 5 core vertices (maestro-architecture names 2 of 148), report it. Do this in gaps output and in `enrich targets --core` (text and --json), e.g. "core is thin: SKILL.md names N of M vertices, deepen the skill", so the flows can route it to update-single-concept-skill.

The docs-only and no-tsconfig paths are unchanged. Update docs/usage.md and packages/code-graph/CLAUDE.md. Version 0.3.9 in all three files, bundle regenerated. Runs after 015 (0.3.8) so the versions don't clash.

## Acceptance criteria

- [ ] A shared core function returns the SKILL-named vertices (word-boundary identifier match, names of 3+ characters) plus in-concept hubs (3 or more inbound calls/mounts from the same concept), with unit tests for each rule
- [ ] `enrich targets <concept> --core` lists only core vertices among the new ones, still lists changed, stale and --vertex-named vertices outside the core, and reports the left-out count in text and --json
- [ ] gaps measures the 90% ratio over core vertices, or all live vertices when the core is empty; a test shows a core-only-enriched concept reads as enriched
- [ ] A thin core (50+ live vertices, fewer than 5 core) is reported in gaps and in `enrich targets --core`
- [ ] Docs updated; pnpm check, pnpm test and just eval (7/7) are green; the version is 0.3.9 in all three files and the bundle is regenerated

## Blocked by

- `015-key-the-plugin-deps-cache-by-the-pinned-deps-not-the-code-graph-version.md`
