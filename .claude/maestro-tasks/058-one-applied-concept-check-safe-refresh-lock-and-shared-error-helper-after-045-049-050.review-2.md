Round 2. Previous redirect (m005): "brief doesn't meet the verification bar yet."

## Goal
Ticket 058: one applied check (`isConceptApplied`), owner-checked refresh lock, shared print-then-throw helper, defined outcome for unmatched globs.

## Done
Unchanged from round 1 (see .review.md), plus the points below.
- Point 1 (understand the 5/7 eval): investigated in a throwaway worktree at untouched HEAD with copies of the enriched files; the user's files were not mutated. Still 5/7 on HEAD after `just regraph`. Task 2 `expand graph traversal impact`: `vertex "expandDoc" not in top 6 (found at 9)`. Task 6 `docs-only concept skill resolution skillsDir`: `concept "concept-skills-layer" not in top 3 clusters`. Cause: the local store is enriched for code-graph-search (67 purposes) and scribe-pipeline (84) but concept-skills-layer has no .enriched.json, so enriched purposes of `extractDocsOnly`/`extract` outrank the un-enriched doc (task 6), and the `expandDoc` purpose carries fewer query words (task 2). eval/tasks.code-graph.json says task 2 was reworded in 0.3.28 to pass "on an un-enriched store". The enriched files are gitignored, so the committed gate and an enriched local store disagree. On an un-enriched store HEAD and this change are both 7/7. Not fixed or ticketed, per your instruction; for you to escalate.
- Point 2: committed on new branch `feat/058-applied-check-lock-error-helper` as 595137c (13 files; epic files, pnpm-lock.yaml and the review files left out).
- Point 3: behaviour change (archived-only concept with no doc row no longer refreshed) recorded as a decision in the scribe-pipeline SKILL.md refresh-skills bullet.
- Point 4: cli.ts untouched.
- Point 5: the channel payload task-058/test/backend.1.md names ticket 058.

## Deviations
`just eval` is 5/7 on this machine's enriched store (same as HEAD); 7/7 on an un-enriched store.

## Decisions
As accepted in round 1, plus the archived-only decision now in the skill text.

## Touches
Same as round 1; no cli.ts.

## Sibling impact
056 rebases on 058.

## Verified
Commit 595137c: `pnpm check` green (6/6 tasks); `pnpm test` green (code-graph 612 pass, 0 fail; 5/5 tasks); `just eval` 5/7 (tasks 2 and 6 fail), identical on untouched HEAD. @test and @reviewer have not yet run.

## Questions
Escalation needed on the enriched-store eval gap (5/7 vs the 7/7 gate)?
