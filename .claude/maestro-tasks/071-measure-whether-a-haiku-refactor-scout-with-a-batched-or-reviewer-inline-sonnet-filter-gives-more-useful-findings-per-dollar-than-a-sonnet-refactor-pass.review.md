## Goal
Extend the 070 refactor bench so a Haiku scout with a batched or reviewer-inline Sonnet filter can be compared with a Sonnet refactor pass on useful findings per dollar. Pre-register the design in docs/evals.md. No paid run started by the agent.

## Deviations
- Three 070 cases (f-s6, f-c1, f-c4) retired to the 070 set; three latent cases added (f-l1-tasks-sections, f-l2-session-sweep, f-l3-atomic-json-writes), 6 cases total.
- The pilot runs sonnet-plain only, so review and batch costs are estimated from 070, not measured.
- The 071 runner refuses the 070 per-case filter and spawn arms (still defined and tested in bench/refactor.mjs).

## Decisions
- Caps from the user: $0.60 per session, $3 pilot, $7 paid, $10 total.
- Batch size 3 (B1: f-r5, f-c2, f-l1; B2: f-s5, f-l2, f-l3), pre-registered.
- Runs per cell: largest r in {1,2,3} with 18*r*c <= $5.60 (c = mean pilot session cost); if r = 1, amend the design before paying.
- Inline arm cost = scout + (inline review - control review); control arm sonnet-review-plain hidden from tables.
- Audit: scriptable registry + git grep at pinned commit + blinded hand-verdict pool; unjudged proposals count as noise; 070 figures shown beside.

## Touches
bench/refactor.mjs, refactor-run.mjs, refactor-cases.mjs, refactor-audit.mjs (new), review.mjs, refactor-071.test.mjs (new), refactor-audit.test.mjs (new), refactor.test.mjs, refactor-cli.test.mjs, bench/README.md, bench/refactor/*.txt (new), docs/evals.md (new "Ticket 071" section).

## Sibling impact
None outside bench and docs/evals.md; nothing in the maestro repo, code-graph package or plugin bundle.

## Questions
None. Tests, dry run, prep --check and pnpm check pass; pnpm verify is left to the test step before the measured commit.
