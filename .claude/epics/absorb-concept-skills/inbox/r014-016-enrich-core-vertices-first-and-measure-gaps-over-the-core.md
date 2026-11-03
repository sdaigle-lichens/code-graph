# Report r014: 016-enrich-core-vertices-first-and-measure-gaps-over-the-core.md

- Task: 016-enrich-core-vertices-first-and-measure-gaps-over-the-core.md
- Written: 2026-10-17T00:54:12.438Z

Outcome: task 016 done, uncommitted in the main checkout. Version 0.3.9 in all three files, bundle regenerated.
- New pure scribe/core.ts (coreVertices: SKILL-named identifiers of 3+ chars plus in-concept hubs with 3+ inbound calls/mounts), shared by enrich and gaps.
- `enrich targets --core`: new vertices limited to the core; changed, stale and --vertex-named still listed; core flag and left-out count in text and --json; thin-core message.
- gaps: enrichedRatio measured over the core (all live vertices if the core is empty); thinCores in GapReport and the diagnostic.
- Docs: docs/usage.md and packages/code-graph/CLAUDE.md updated.
Verification: pnpm test 306/306, pnpm check green, just eval 7/7 (per @test).
Findings (non-blocking): addCoreCounts in gaps.ts is O(concepts x rows), so group by concept first if it matters. The thin-core message says "SKILL.md names N" but N is the whole core size (named plus hubs). The scribe-pipeline skill's scribe/ file map has no core.ts row.
Post-mortem: clean session. The scribe subagent ended with no HANDOFF line, treated as success.
Suggested ticket changes: none. Task 017 can rely on --core and the thin-core JSON fields (core.size, leftOut, thin, message).
