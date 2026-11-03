# Review — 044, round 1

## Changed

- Added: `bench/edit.mjs` (prepare, protect/restore, test runner, graders), `bench/edit-check.mjs` ($0 grader proof), `bench/edit/ts-resolve.mjs`, `bench/edit/ref/` (reference answers for t1, t2, d1, d2)
- Modified: `bench/lib.mjs` (`MODEL_ARMS`, edit-run args, `--append-system-prompt`, parse/validity/grading, `editSection`), `bench/run.mjs`, `bench/cases.json`, `bench/lib.test.mjs`, `bench/README.md`
- Docs: `docs/evals.md` — "Ticket 044" section: feasibility, task table, confounds, arms, decision rule (set before any paid run), commands
- Channel: `.claude/channels/test/backend.1.md`

## Did

- @backend: feasibility confirmed with no installs (Node 22.19 type stripping + a resolve hook that maps `.js` to `.ts`; `node --test` on maestro@3814a30). Built 4 tasks (2 test, 2 scribe) with automatic grading, the 3 model arms and the edit-run support; `lib.test` 79/79, `edit-check` all graders correct (0 when nothing is done, full marks on the reference answers), `pnpm check` green

## Proposed tasks (awaiting approval)

| id | kind | grading | graph should add |
|---|---|---|---|
| t1-test-close-task | test | 5 pts: green on original code + 4 mutants (tasks.ts ×3, worktree.ts) | claim liveness (`claims.ts`), how linked worktrees are made |
| t2-test-epic-ready | test | 5 pts: green on original code + 4 mutants (epics.ts ×3, claims.ts) | state writers (`createEpic`, `linkTasks`, `addWorker`, `claimTask`), `status.json` shape |
| d1-scribe-claim-cap | scribe | 8 pts: 3 must + 5 must_not | impact through `SESSION_DELETE_IDLE_CAP_MS = CLAIM_IDLE_CAP_MS`; stale "15 min" lines a grep for the name misses |
| d2-scribe-spawn-cap | scribe | 8 pts: 4 must + 4 must_not | users of `DEFAULT_SPAWN_CAP`; 2 plugin docs are outside every concept's globs (partial graph coverage) |

Paid plan: pilot t1 + d1 × 3 arms × 1 run ($1 cap each); full run 24 runs at `--budget 6`; total ≤ $8.

## Deviations from the ticket

- 4 tasks, the low end of 4–6
- d2's graph contribution is only partial (2 of its docs are outside every concept's globs); kept and reported as such
- `pnpm check` doesn't cover `bench/` or `docs/`; `bench/` is covered by `lib.test` and `edit-check`
- Unverified until the user's preflight: `--append-system-prompt` support, whether `dontAsk` refuses Edit/Write under `.claude/**` (d1, d2), and the model IDs
- Pilot, paid run and results report are user-run and come later; this round approves the task list
