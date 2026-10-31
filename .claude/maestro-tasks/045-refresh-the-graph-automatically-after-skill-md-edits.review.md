# 045 — manager review, round 1

## Goal

Refresh a concept's graph automatically after its SKILL.md is edited, using a plugin Stop/SubagentStop hook that runs extract then apply. The hook applies only clean cases. A concept that needs a rename decision is never applied: the session is told to run `apply <concept>` by hand. Renames are never recorded as an insert plus an archive.

## Done

@backend, in worktree `code-graph-task-045` (uncommitted):
- New `apply <c> --defer-renames`: never prompts. If there are rename candidates, it prints the drift report, writes nothing and exits 10. Otherwise it behaves exactly like `apply`. It can't be combined with `--approve-drift`. Interactive apply is unchanged.
- New `refresh-skills [--hook] [--json]` command. It finds each applied concept whose SKILL.md hash differs from its `docs/<c>::skill` row in the store, then runs `extract` and `apply --defer-renames` for it as child processes.
- `plugin/hooks/hooks.json` runs `refresh-skills --hook` on Stop and SubagentStop, with a 120 s timeout. A lock file next to graph.db keeps overlapping runs from applying at the same time.
- The hook reports through `{"systemMessage": ...}` and always exits 0. It names the refreshed concepts, gives each deferred concept with the manual `apply` command, and lists failures.
- Measured on a copy of maestro (16 concepts): 0.07 s with no change, about 15 s to refresh 11 concepts (about 1.4 s per concept), 9.6 s for 10 refreshed plus 1 deferred.
- Version bumped from 0.3.29 to 0.3.30 and the bundle regenerated. Build, check and the 515 code-graph tests pass, and eval is 7/7. Tests for the new behaviour are next (@test).

## Deviations

- Deferred concepts are reported through `systemMessage`, not `decision: block`. Blocking would force a model turn at every stop and keep re-firing, and no agent can answer the interactive prompt anyway. Side effect: a deferred concept is reported again at every stop until someone applies it by hand.
- Concepts that were never applied are skipped. A first ingest stays with add-concept.
- `refresh-skills` is kept out of `STORE_COMMANDS`, against a package CLAUDE.md note. That way it stays silent on a Node without `node:sqlite` instead of exiting 8.

## Decisions

- A changed SKILL.md is detected by comparing the hash on disk with the store's skill doc `body_hash`, not by mtime or git.
- The deferred path writes nothing, not a partial apply.
- With no tsconfig, the hook does nothing, as the ticket asks. A docs-only concept in a repo without TypeScript therefore gets no auto-refresh.

## Touches

- packages/code-graph/src/scribe/skill-refresh.ts (new)
- packages/code-graph/src/scribe/apply.ts
- packages/code-graph/src/cli.ts
- plugin/hooks/hooks.json (new)
- the three version files
- plugin/scripts/code-graph.cjs (regenerated)
- coming next: the scribe skill and docs/usage.md (@scribe)

## Sibling impact

- Worktrees 048, 049 and 050 may also bump the version to 0.3.30, so there will be version conflicts at merge.
- Sibling tickets that change apply.ts or cli.ts will get merge conflicts there.

## Questions

1. Is `systemMessage` with re-reporting at every stop the right channel, rather than blocking?
2. Is it acceptable to have no auto-refresh for docs-only concepts in repos without a tsconfig?
3. Which task should own version 0.3.30 among 045, 048, 049 and 050?
