Round 1

## Goal
Let every code-graph command target a chosen config root (a worktree) without `cd`. Ticket 056.

## Done
- Root cause confirmed: `loadConfig`/`tryLoadConfig` in `config.ts` walk up from `process.cwd()` only, and `cli.ts` passed `process.cwd()` everywhere. Sessions never `cd`, so the main checkout's scribe.config.json always won. `skills` already had `--root` plus `CLAUDE_PROJECT_DIR`; the graph commands did not.
- Global `--root <dir>` on the program (before or after the subcommand), applied once in a `preAction` hook (chdir to the start dir and mirror into `CLAUDE_PROJECT_DIR` for the `skills` group).
- Precedence: `--root`, then `$CLAUDE_PROJECT_DIR` (only if a scribe.config.json sits at or above it), then the cwd walk. A bad `--root` exits 1.
- `docs/usage.md` has a "Choosing the project" section. The plugin bundle is regenerated with `pnpm build`.

## Deviations
- Plugin skills not changed to pass `--root`: the env fallback already targets the right project.
- No version bump, as the epic manager asked; the merger bumps to 0.3.34 and re-runs `pnpm bundle`.

## Decisions
- Env fallback is safe for plugin sessions: it agrees with the cwd walk except in the worktree case, and the config-presence guard ignores a stray value. Residual risk: a stale `CLAUDE_PROJECT_DIR` that does have a config at or above it redirects commands, as it already did for `skills`.
- chdir in a preAction hook rather than editing ~10 `process.cwd()` call sites.

## Touches
`packages/code-graph/src/config.ts` (`resolveStartDir`), `cli.ts`, new `root-option.test.ts`, `docs/usage.md`, `plugin/scripts/code-graph.cjs` (generated).

## Sibling impact
`skills` commands unchanged in behavior; they now also honor the global `--root`. Ticket 059 (eval on enriched and un-enriched stores) is unaffected.

## Verified
Working tree on top of HEAD de2229b, not yet committed. `pnpm --filter code-graph test`: 633/633 pass. Desktop vitest: 115/115 pass. `pnpm check` green. `just eval` is 5/7 (tasks 2 and 6), the same as untouched HEAD on an enriched local store (ticket 059); retrieval was not touched.

## Questions
None.
