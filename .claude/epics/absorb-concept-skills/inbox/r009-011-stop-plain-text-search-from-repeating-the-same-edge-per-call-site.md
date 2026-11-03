# Report r009: 011-stop-plain-text-search-from-repeating-the-same-edge-per-call-site.md

- Task: 011-stop-plain-text-search-from-repeating-the-same-edge-per-call-site.md
- Written: 2026-10-16T20:29:38.173Z
- From session: code-graph-ce

Outcome: task 011 done, uncommitted in the main checkout. Plain-text search groups edges by (other vertex, type) for incoming, outgoing and cross-concept lines, showing (line N), (lines a, b, c) or xN, and all distinct reasons. --json is unchanged. The totals line was stale (computed before trimming and not counting itself); it is now restated after trimming. --max-tokens was already honoured.
Checks: pnpm test 269 pass, pnpm check green, just eval 7/7, bundle regenerated. 3 of the 4 new tests fail on the old search.ts. Real CLI run on a repeated-call-site graph confirmed.
Findings: cli.ts appends the thin-result enrichment warning after applyTokenBudget, so printed output runs ~14 tokens over the totals figure on thin results. Reviewer judged it acceptable; documented in docs/usage.md and the code-graph-search skill. Hard truncation can still cut mid-heading (pre-existing). Scribe's extract failed with the plugin bundle (ts-morph missing); I ran extract and apply for code-graph-search with packages/code-graph/dist/cli.js instead, and both succeeded.
Post-mortem: clean session.
Suggested tickets: optional follow-up to count the gap note inside the token budget.
