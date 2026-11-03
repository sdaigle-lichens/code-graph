## Goal
Make `just eval` give the same verdict (7/7) on an enriched and an un-enriched local store, and name the store kind it measured.

## Done
- Reproduced first: `just eval` on the enriched local store scored 5/7 (task 2: expandDoc at rank 9, wanted top 6; task 6: concept-skills-layer not in top 3 clusters). 150 of 226 vertices carried a purpose.
- Decision: gate made independent of enrichment. `code-graph eval` now measures a stripped temp copy (VACUUM INTO, purposes/tags removed, FTS index rebuilt), deleted afterwards. The real store is untouched.
- New `--store as-is` flag and `just eval-as-is` recipe for the untouched store (informational; 5/7 on a partly enriched store).
- Eval prints a `store:` line (after `build:` and after the verdict) and each results JSON has a `store` field.
- Ranking not changed; search.ts untouched; search exit codes and `--json` shape unchanged.
- Docs: root CLAUDE.md working rules and docs/evals.md.

## Deviations
- **Acceptance criterion 2 is NOT met.** It requires 7/7 on a store enriched for code-graph-search and scribe-pipeline but not concept-skills-layer. `just eval-as-is` on that store scores 5/7 (tasks 2 and 6). The stripped copy only tests the un-enriched case; the earlier claim that one run covers both kinds was wrong.
- Alternative not taken: a ranking change so partly enriched stores also pass (risk to the other eval tasks).
- Manager verdict: escalate. Lazy enrichment is the steady state, so a gate that strips enrichment can stay green for a ranking regression that real users see.

## Decisions
- Gate-only fix, no ranking change, so no search.ts review request was needed.
- Version not bumped; whoever merges bumps to 0.3.35 (CLI source changed) and re-runs `pnpm bundle`.

## Touches
- packages/code-graph/src/eval/store.ts (new), store.test.ts (new), harness.ts
- packages/code-graph/src/cli.ts
- justfile, CLAUDE.md, docs/evals.md
- plugin/scripts/code-graph.cjs (generated)

## Sibling impact
- 057 (fresh-worktree store) untouched. Shares justfile/CLAUDE.md/bundle with 057; later merges rebase and regenerate the bundle.
- Local scribe-output/*.enriched.json and graph.db untouched.

## Verified
Working tree on top of 0ef4ef3 (0.3.34), uncommitted. `pnpm build`, `pnpm check` green, `pnpm test` 658/658, `just eval` 7/7, `just eval-as-is` 5/7 labelled `store: enriched`. @test and @reviewer still to run after this stop.

## Questions
- (a) Accept gate-only; `eval-as-is` stays informational; open a ranking ticket for partly enriched stores (manager's recommendation).
- (b) Require the ranking fix in 059 (needs a manager review of the search.ts change first; risk to other eval tasks).
- (c) Keep the stripped gate and also make `eval-as-is` a gate with a stated threshold.
Note: the work is uncommitted, so no commit has been verified yet; the final report must name one.
