# Report r050: 059-make-just-eval-pass-on-both-enriched-and-un-enriched-graph-stores.md

- Task: 059-make-just-eval-pass-on-both-enriched-and-un-enriched-graph-stores.md
- Written: 2026-11-02T00:43:33.695Z
- From session: absorb-concept-skills-059

## Outcome
Task 059 done on the user's option (a): gate-only. `just eval` now gates on a stripped, un-enriched temp copy of the store; `--store as-is` (`just eval-as-is`) measures the store untouched and is informational. Ranking is unchanged and search.ts is untouched. Acceptance criterion 2 (7/7 on a store enriched for code-graph-search and scribe-pipeline but not concept-skills-layer) is NOT met: as-is scores 5/7 there. The user accepted this after the manager's escalate verdict (m008); the manager owns the ranking ticket.

## Verified commit
8a07a41 on feat/integrate-concept-skills (on top of 0ef4ef3, version 0.3.34), working tree clean for the committed paths.
- pnpm check: green (6/6; check-versions and check-plugin-clean pass). Turbo replayed from cache.
- pnpm --filter code-graph test (uncached): 671 tests, 671 pass, 0 fail, 0 skipped, 0 todo.
- just eval: 7/7, `store: un-enriched (stripped copy, purposes and tags removed, index rebuilt; 150 of 226 vertices carry a purpose in the real store)`.
- just eval-as-is: 5/7 (task 2 expandDoc at rank 9, wanted top 6; task 6 concept-skills-layer not in top 3 clusters), `store: enriched (as-is, ...; verdict depends on local enrichment)`. Informational, exits 1 by design.
Not covered: a check that the real graph.db is byte-identical across runs. The code path does not write to it, and the existing preflight applySchema write predates 059.

## Findings
- Reproduced first: 5/7 on the enriched local store.
- Round 1 @test FAIL had two real defects, both fixed and now covered by tests that fail when each fix is reverted: (1) runEval called ensureSearchIndexFormat on the real store and rewrote a stale-format index; (2) openEvalStore leaked its temp dir on setup failure.
- As-is deliberately skips the FTS format check; docs/evals.md says so and points to `code-graph reindex`.
- Nothing tests that `eval-as-is` exits non-zero on a regression.

## Post-mortem notes
- The 059 brief first claimed "Deviations: none" and that one stripped run covered both store kinds. That was wrong; the manager caught it.
- The backend test-handoff payload went missing from its channel path once; @test and @scribe used the inlined copy.
- One scratch dir /tmp/claude-1000/code-graph-eval-* from a manual reproduction may remain; the delete was denied.

## Suggested ticket changes
- New ranking ticket for partly enriched stores (tasks 2 and 6), as the manager planned.
- Merger bumps to 0.3.35 in the three version files and re-runs `pnpm bundle` (CLI source changed). Ticket 060 is queued behind this and shares CLAUDE.md, the bundle and the versions.
- Docs touched: root CLAUDE.md, docs/evals.md, docs/usage.md, packages/code-graph/CLAUDE.md.
