## Goal
Add an opt-in `haiku-decided-against` scout arm to the refactor bench (usual metrics primer plus decided-against entries for the case neighbourhood), paired against the plain scout, with a hand-built $0 list and a pre-registered design. No paid run started.

## Deviations
- Set 073 has 5 cases (f-r5, f-s5, f-c2, f-l1, f-l3); f-l2 is excluded because no list entry concerns its files. Set 071 is unchanged (6 cases).
- The measured-commit hash in docs/evals.md is not filled in yet: nothing is committed, so it is added after the commit (docs only).
- `--init-check` could not run in the sandbox (`claude` not on PATH); the user must run it.
- One existing test (`refactor.test.mjs`) was loosened to allow latent sets 071 plus 073.

## Decisions
- 14 hand entries (file, symbol, symbol-level contentHash, claim, reason) from 071 non-expected proposals; a test enforces that no expected improvement is in the list.
- Entries expire when the contentHash changes; only neighbourhood-file entries are injected.
- Caps: $0.15 per session, $0.50 pilot, $1.50 paid, $2 total. Decision thresholds: REPEAT_CUT 0.5, RECALL_KEEP 0.9, NEW_KEEP 0.5.

## Touches
bench/refactor.mjs, refactor-run.mjs, refactor-cases.mjs, new refactor-decided.mjs, refactor-decided-prep.mjs, refactor-decided.test.mjs, bench/refactor/decided-against.json, bench/README.md, docs/evals.md. Nothing in packages/code-graph/src or the maestro repo.

## Sibling impact
None known. The list file must be committed before any paid run.

## Questions
None.
