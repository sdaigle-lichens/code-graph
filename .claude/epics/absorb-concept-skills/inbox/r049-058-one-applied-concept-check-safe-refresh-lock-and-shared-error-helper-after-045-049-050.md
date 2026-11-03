# Report r049: 058-one-applied-concept-check-safe-refresh-lock-and-shared-error-helper-after-045-049-050.md

- Task: 058-one-applied-concept-check-safe-refresh-lock-and-shared-error-helper-after-045-049-050.md
- Written: 2026-11-01T13:39:09.756Z
- From session: absorb-concept-skills-058

## Outcome
Ticket 058 done on branch feat/058-applied-check-lock-error-helper. Commits 595137c (implementation, bundle regenerated) and ccd2b19 (reportAndThrow test, scribe-pipeline exit-codes row and lock-race limitation). Not merged or pushed.

## Verified
Implementation commit 595137c: `pnpm check` green (6/6), `pnpm test` green (612 pass, 0 fail), `just eval` 5/7 (tasks 2 and 6), identical on untouched HEAD and 7/7 on an un-enriched store; user accepted this and it is ticketed as 059. After ccd2b19: @test reported the full suite 613/613 with the new test, `pnpm check` green (turbo cache hits); `just eval` was not rerun because no source changed.

## Findings
- @reviewer PASS. Residual race: a three-run window in the takeLock/releaseLock link-back path (stale lock plus three racing runs) can let two runs both believe they hold the lock. Recorded as a known limitation in the scribe-pipeline skill; the link-back branch has no direct test. A lock directory or an inode re-check would close it; follow-up ticket suggested.
- Unmatched globs: extract is a clear error naming the concept and globs (an empty extract would make apply archive every vertex).
- Behaviour change accepted: a concept with only archived vertices and no doc row is no longer refreshed.
- scribe-pipeline.enriched.json has a stale entry (apply warns that enriched vertex c8e3ece... is not in ast.json).
- The scribe-pipeline skill text changed but was not stamped (metadata.version 1.1 unchanged); needs a bump decision via update-single-concept-skill.
- The cached ts-morph Project is documented with clearProjectCache() exported; clearProjectCache itself is untested.

## Post-mortem notes
Round 1 redirected by the manager (brief lacked a committed, verified state); round 2 escalated the eval gap to the user. @backend ran `git stash -u` once, which failed partway; it restored everything by hand.

## Suggested ticket changes
059 (enriched/un-enriched eval) stays blocked by 058. Consider a ticket for the lock link-back race and a clearProjectCache test.
