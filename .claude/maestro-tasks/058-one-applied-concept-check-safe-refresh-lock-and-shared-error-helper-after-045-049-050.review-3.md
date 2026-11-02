## Changed
Commit 595137c on branch feat/058-applied-check-lock-error-helper (13 files): packages/code-graph/src (concept-batch, scribe/{apply,ast-output,enrich,extract,skill-refresh,exit-codes}, skills/commands, two test files), scribe-pipeline SKILL.md, packages/code-graph/CLAUDE.md, plugin/scripts/code-graph.cjs.

## Did
- @backend: isConceptApplied in refresh-skills; token-owned lock with atomic rename takeover; exit-codes.ts; reportAndThrow; clearProjectCache; stampBatch failed[] test; unmatched globs is a clear error; docs and bundle.
- Manager (m005 redirect, m006 escalate): direction on-track; escalated only for the eval gap below.

## Deviations from the ticket
`just eval` is 5/7 on the enriched local store (tasks 2 and 6), not the required 7/7. Identical on untouched HEAD.

## Verified
Commit 595137c: `pnpm check` green (6/6); `pnpm test` green (612 pass, 0 fail); `just eval` 5/7. On an un-enriched store (enriched files hidden, regraph) HEAD and this change both give 7/7. @test, @reviewer, @scribe have not yet run.

## Manager note
Cause: local store enriched for code-graph-search and scribe-pipeline but not concept-skills-layer; enriched purposes outrank the un-enriched doc (task 6) and expandDoc falls to rank 9 (task 2). Enriched files are gitignored, so the committed gate and an enriched local store disagree. Not caused by 058.
