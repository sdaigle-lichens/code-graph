Round 2

Previous redirect note: none. Round 1 was on-track with conditions. Since then @test found two defects and the work looped back to @backend.

## Goal
Let every code-graph command target a chosen config root (a worktree) without `cd`. Ticket 056.

## Done
- Round 1 conditions met:
  - `docs/usage.md` states the preAction chdir is intended, so relative path args resolve against the chosen root. A relative-path test (`eval --tasks`) pins it.
  - A test pins that `CLAUDE_PROJECT_DIR` wins when the cwd points at a different configured project.
  - Version unbumped, bundle regenerated.
- @test found two defects, both fixed:
  1. A stale `CLAUDE_PROJECT_DIR` (a deleted worktree under a configured project) made every command exit 1. It is now ignored.
  2. `skills` took `CLAUDE_PROJECT_DIR` even without a config at or above it, unlike the graph commands. Both now share one helper, `chooseStartDir` in `skills/state.ts`.
- Empty `--root ''` is an error (exit 1, "--root: empty path") for the graph commands and `skills`. Documented and tested.

## Deviations
- Behaviour change in `skills stamp` and `agents-set`: they used to honour a `CLAUDE_PROJECT_DIR` with no config yet, so a first write created the config there. Now they fall back to the cwd walk. A fresh repo whose session cwd is a subdirectory gets its first config in that subdirectory. This is the cost of one shared rule. **Please confirm it is acceptable.**
- One existing test in `skills/cli.test.ts` relied on the old behaviour, so I changed it to seed a config in the env dir.

## Decisions
- One shared rule over two divergent ones, as the ticket and usage.md already claimed.
- Layer 1 (`skills/`) keeps importing only `fs`, so the helper lives there and `config.ts` imports it.

## Touches
`skills/state.ts`, `skills/state.test.ts`, `skills/cli.test.ts`, `config.ts`, `cli.ts`, `root-option.test.ts`, `docs/usage.md`, `plugin/scripts/code-graph.cjs` (generated).

## Sibling impact
`skills` write commands as above. Ticket 059 is unaffected.

## Verified
Working tree on top of HEAD de2229b, not committed. `pnpm --filter code-graph test`: 648/648 pass, 0 todo. `pnpm check` green. The desktop tests and `just eval` are not re-run this round; the last results were desktop 115/115 and `just eval` 5/7 (tasks 2 and 6), the same as HEAD on an enriched store (ticket 059).

## Questions
Is the `skills stamp` and `agents-set` first-write fallback acceptable?
