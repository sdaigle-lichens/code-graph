# Report r016: 018-make-search-json-honour-max-tokens.md

- Task: 018-make-search-json-honour-max-tokens.md
- Written: 2026-10-17T02:05:45.943Z
- From session: code-graph-bf

Outcome: 018 done. search --json now honours --max-tokens (default 3000) via budgetSearchJson (query/search.ts), wired in cli.ts, stale comment fixed. Version 0.3.11 in all three files, bundle regenerated. pnpm check green, pnpm test 309/309, just eval 7/7. Docs updated (code-graph-search skill, docs/usage.md, packages/code-graph/CLAUDE.md).

Trim: drop lowest-ranked hits (keep 5, then 1), truncate skill bodies (2000/500/0), cap edge lists (10/3/0) and slim vertices, last resort drop best hit. Adds truncated:true and dropped{hits,edges,clusters,skillBodiesTruncated} only when trimming; strength and gaps always kept.

Findings:
- Other --json commands (concept, impact, cross, vertex, file) all still bypass --max-tokens (query/run.ts prints raw JSON). Not fixed; each needs its own trim policy (cross is a bare array, impact nested). Suggest a follow-up ticket.
- Budgets below ~405 tokens cannot be honoured (fixed floor: strength, gaps, skeleton); documented.
- At 600 tokens the best hit is still dropped although ~195 tokens are spare; optional tightening.

Post-mortem: first implementation dropped every hit at the default budget on the real store; unit fixtures had tiny hits, caught only by @test running the built CLI. @backend also omitted the test channel payload on the loop-back.

Suggested ticket changes: add a follow-up for --max-tokens on concept/impact/cross/vertex/file --json; optional tweak for the 600-token case.
