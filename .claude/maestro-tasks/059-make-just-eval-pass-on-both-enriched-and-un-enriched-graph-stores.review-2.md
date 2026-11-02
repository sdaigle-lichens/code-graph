Round 2 (after @test FAIL, not a manager redirect; the round-1 verdict was escalate and the user chose option (a): accept gate-only).

## Goal
Make `just eval` give a deterministic 7/7 independent of local enrichment, and name the store kind measured.

## Done
- Round 1 work stands: stripped temp copy gates `just eval`; `--store as-is` / `just eval-as-is` is informational (5/7 on a partly enriched store); `store:` line and results JSON `store` field; docs in CLAUDE.md and docs/evals.md.
- Corrections since round 1, from @test's two defects:
  1. `runEval` no longer calls `ensureSearchIndexFormat` on the real store, so a stale-format store is not rewritten. As-is measures the store exactly as stored; docs/evals.md says so and points to `code-graph reindex`.
  2. `openEvalStore` now cleans up its temp dir and closes the copy if VACUUM INTO, the strip or the index rebuild fails, then rethrows.
- @test added eval-cli.test.ts and extended store.test.ts; the 3 defect tests are no longer `todo` and pass.

## Deviations
- Acceptance criterion 2 (7/7 on a store enriched for code-graph-search and scribe-pipeline but not concept-skills-layer) is still NOT met. The user accepted this (option a). A separate ranking ticket for partly enriched stores is a follow-up.
- No version bump; the merger bumps to 0.3.35 and re-runs `pnpm bundle`.

## Decisions
- Gate-only fix, search.ts untouched. User decision recorded in round 1.
- As-is skips the FTS format check on purpose, so it reflects the store as it is.

## Touches
- packages/code-graph/src/eval/store.ts, harness.ts, store.test.ts, eval-cli.test.ts
- packages/code-graph/src/cli.ts, justfile, CLAUDE.md, docs/evals.md
- plugin/scripts/code-graph.cjs (generated)

## Sibling impact
- 057 untouched. Shares justfile/CLAUDE.md/bundle; later merges regenerate the bundle.

## Verified
Uncommitted working tree on top of 0ef4ef3 (0.3.34), as reported by @backend after the fixes: `pnpm build`, `pnpm check` green, `pnpm test` 671 pass / 0 fail / 0 todo, `just eval` 7/7, `just eval-as-is` 5/7. No commit exists yet; @test and @reviewer re-verify after this stop.

## Questions
- None.
