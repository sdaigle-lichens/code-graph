Round 3

Previous redirect note (round 2): the `skills stamp` / `agents-set` first-write change regressed the bootstrap flow and the ticket never asked for it.
1. Keep one `chooseStartDir` with a mode. Read mode needs a config at or above `CLAUDE_PROJECT_DIR`. Create mode (`stamp`, `agents-set`) keeps the old rule, so an existing env dir wins even with no config yet. A stale or deleted env dir is ignored in both. Addressed: `chooseStartDir` takes `mode` `"read"` (default) or `"create"`; `skills/commands.ts` passes `"create"` for `stamp` and `agents-set`; a missing, deleted or non-directory env value is ignored in both modes.
2. Revert the changed `skills/cli.test.ts` test. Addressed: back to its original form, passing unchanged.
3. Add tests for the first write at the project root with the cwd in a subdirectory, and for a stale or missing env dir. Addressed: `skills/cli.test.ts` runs `agents-set` with the env at the repo root and the cwd in a subdirectory of a fresh repo (config lands at the root), and checks a missing env dir falls back to the cwd walk for create and read commands. `skills/state.test.ts` covers both modes.
4. Update usage.md with both rules and why they differ. Addressed.
5. Commit first and name the commit. Addressed: commit 2546650.

## Goal
Let every code-graph command target a chosen config root (a worktree) without `cd`. Ticket 056.

## Done
- Global `--root <dir>`, then `$CLAUDE_PROJECT_DIR`, then the cwd walk, with the read and create modes above.
- Empty or non-directory `--root` exits 1 before any store is opened.
- A stale `CLAUDE_PROJECT_DIR` no longer breaks commands.
- Docs and tests as in rounds 1 and 2. Bundle regenerated, version unbumped.

## Deviations
None beyond the ticket. Plugin skills are left unchanged (accepted in round 1).

## Decisions
One helper, two modes (per the manager). The preAction chdir is documented as intended (relative paths resolve against the chosen root).

## Touches
`config.ts`, `cli.ts`, `skills/state.ts`, `skills/commands.ts`, `skills/cli.test.ts`, `skills/state.test.ts`, `root-option.test.ts`, `docs/usage.md`, `plugin/scripts/code-graph.cjs` (generated).

## Sibling impact
`skills` read commands now share the graph commands' rule; the create commands keep their old rule. Ticket 059 is unaffected.

## Verified
Commit 2546650. `pnpm check` green (6/6). `pnpm --filter code-graph test`: 654/654 pass. Desktop vitest: 115/115 pass (run by @backend on the same tree). `just eval`: 5/7 (task-2-traversal-expansion and task-6-docs-only-concept fail), the known ticket-059 result on an enriched local store, same as untouched HEAD per the manager.

## Questions
None.
