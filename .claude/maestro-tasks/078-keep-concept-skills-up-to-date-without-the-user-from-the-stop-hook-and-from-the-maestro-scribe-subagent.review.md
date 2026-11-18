# Task 078: review, round 1 (manager review run as a human review; the task is in no epic)

## Goal
Keep concept skills current with no user involved, from the Stop/SubagentStop hook and from the scribe subagent. One run at a time, a minimum interval between runs, a rename applied only when unambiguous, and no orphaned enriched entries.

## Changed
- New: `packages/code-graph/src/scribe/update-run.ts`. Contains the trigger `maybeStartUpdate`, a detached runner, the run state file `.update-skills.json`, the HEAD cache `.update-skills.head` and the report file `scribe-output/update-skills-report.md`.
- `skill-refresh.ts`: `--hook` now calls `maybeStartUpdate` after the existing refresh. `LOCK_FILE` is exported.
- `cli.ts`: new `refresh-skills` flags `--run-update <token>`, `--claim-update [--concepts]`, `--finish-update` and `--update-interval`. New `apply --approve-unambiguous-renames` and `delete-concept --keep-enriched`.
- `apply.ts`: a rename candidate gets an `ambiguous` flag. Unambiguous renames are re-keyed in `<concept>.enriched.json`. When any candidate is ambiguous, the concept is not written, the candidates are listed in the output and apply exits 10.
- `delete-concept.ts`: `--keep-enriched` moves the enriched file to `scribe-output/deleted/` instead of deleting it.
- `config.ts`: new `dbPathFor`; `resolveDbPath` delegates to it. `db.ts` and `exit-codes.ts` gain `EXIT_UPDATE_NOT_CLAIMED` = 14.
- Skills:
  - `update-concept-skills/SKILL.md`: new Unattended mode, a scoped inline fallback (up to 20 files) for the large-diff step when there is no Agent tool, and the known limit on Haiku quality. The first concept list still asks the user.
  - `scribe/SKILL.md`: no longer says the proposal step ends the turn. New end-of-task rule: run the update for the touched concepts that are behind HEAD.
  - `scribe/refresh-hook.md`: holds the detail, because SKILL.md has a 9 KB budget and is now at 9200 of 9216 bytes.
- `docs/usage.md`, version 0.3.46 in the three version files, bundle regenerated.

## Did
- @backend: implemented all of the above and wrote test hints for @test.

## Deviations from the ticket
- `plugin/hooks/hooks.json` is unchanged: the trigger runs inside the existing `refresh-skills --hook` command.
- No new test files yet. The ticket's "tests cover both" cases are left to the @test step, which has the hints in `.claude/channels/task-078/test/backend.1.md`.
- A run that is found ambiguous writes nothing for that concept and exits 10. It does not apply the unambiguous renames and defer only the ambiguous one.
- A change to the agents list stays a proposal in the report rather than being applied.
- The real headless `claude -p` call has not been run end to end. All runs so far use injected fakes.

## Decisions
- Minimum interval: 60 minutes by default. It can be changed with `CODE_GRAPH_UPDATE_INTERVAL_MINUTES` or `--update-interval`.
- An unfinished run blocks new ones for up to 2 hours.
- `CODE_GRAPH_AUTO_UPDATE=0` turns the trigger off.
- `CODE_GRAPH_UNATTENDED` stops the headless run from starting another run.
- `CODE_GRAPH_UPDATE_MODEL` sets the model.
- The headless run uses `acceptEdits` with a read-only git allowlist.

## Sibling impact
Task 077 merges first; this task rebases on it, regenerates the bundle and bumps the version on top.

## Questions
- Is the 60-minute default interval right?
- Is it fine to leave hooks.json unchanged?
- Should an ambiguous rename block the whole concept (current behaviour), or only itself?

## Verified
- At HEAD 6c9cc33 plus the uncommitted working tree, nothing committed: `pnpm test` gives 971/971, fail 0, run by me just now.
- @backend reports that typecheck, build, check and `just eval` (7/7) pass.
