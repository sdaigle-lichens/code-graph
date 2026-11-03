# Report r007: 009-fix-search-when-a-term-only-matches-a-concept-s-skill-doc.md

- Task: 009-fix-search-when-a-term-only-matches-a-concept-s-skill-doc.md
- Written: 2026-10-16T18:59:19.417Z
- From session: code-graph-4c

Outcome: task 009 done. Doc-seeded search fixed in packages/code-graph/src/query/search.ts (uncommitted): cluster kept under tight budget (top 5), doc-loaded vertices get one-hop edges and real degree via collectEdges (capped at 20 per concept), plain-text scribe hint when docOnly. searchStore split out for testing. 4 unit tests in search.test.ts (3 fail on old behaviour, 1 guards vertex-seeded search). pnpm build/test/check and just eval 7/7 green. code-graph-search SKILL.md updated, extract+apply run.
Findings: cause confirmed by code reading, not reproduced on a real store. collectEdges runs for all concept vertices before the cap (a few SQL queries per vertex). 5 vertices flagged stale after scribe apply (enrichment not run). SKILL.md still has a stale ArangoDB TOKENS/PHRASE invariant and an outdated Phase 1 line reference.
Post-mortem: clean session; tester strengthened one weak test.
Suggested tickets: optional cleanup of the stale ArangoDB invariant and Phase 1 reference in code-graph-search SKILL.md.
