# Make regraph and eval refuse or rebuild a stale CLI build

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The epic's friction work (trimming cross-concept output, a primer) changes retrieval, and CLAUDE.md requires `just eval` at 7/7 before shipping a retrieval change. That gate must measure the code in `packages/code-graph/src/`, but `just regraph` and `just eval` run `node packages/code-graph/dist/cli.js`, which can be older than `src/` with no warning.

What happened on 2026-10-29: `dist/` dated from Oct 20, before `e47e776` (Oct 21) added identifier words to the FTS `name` column (`nameIndexText`). The gate reported 5/7 and looked like a retrieval regression; a session went to wrong leads (Haiku re-enrichment, which made it 4/7, and a worktree build of `6b97d5d`). A plain `tsc` rebuild gave 6/7; the 7th was a fixture wording, fixed in `0f6f93f`. `pnpm build` cannot run in Claude Code's sandbox (pnpm fetches its pinned version from the registry); `packages/code-graph/node_modules/.bin/tsc -p packages/code-graph/tsconfig.json` works there.

Changes needed: the justfile recipes (`eval`, `regraph`, and any other recipe running `dist/cli.js`), possibly a small Node check script, a code change in the CLI's `eval` command so its output names the build it ran (package version plus the `dist/cli.js` mtime or a build stamp), and a one-line rule in the root CLAUDE.md.

Design to settle first, and record why in the report: either **Rebuild** (the recipes depend on a recipe running the tsc above, incremental if that keeps it fast; measure the cost when nothing changed) or **Refuse** (a check fails with one line naming the rebuild command when any file under `packages/code-graph/src/` is newer than its `dist/` output, or has no output). It must work from the sandbox (no pnpm, no network) and from a plain terminal.

Out of scope: the committed plugin bundle `plugin/scripts/code-graph.cjs` (`pnpm bundle` and its git diff check already cover it), anything in the maestro repo, and changing eval tasks or retrieval code.

## Acceptance criteria

- [ ] With `dist/` older than `src/`, `just regraph` and `just eval` either rebuild first or stop with a one-line message naming the rebuild command; they never run the stale build
- [ ] With `dist/` current, both behave as today, and the added cost is measured and recorded in the report
- [ ] `just eval` output names the build it ran
- [ ] Works inside Claude Code's sandbox without pnpm or network access
- [ ] Root CLAUDE.md "Working rules" mentions the guard in one line
- [ ] `just eval` 7/7 and `pnpm check` green

## Blocked by

None — can start immediately

## Post-Mortem

- **Problem:** @backend changed `src/cli.ts` without regenerating `plugin/scripts/code-graph.cjs`; the ticket's "bundle out of scope" line was read as "don't touch the bundle", which contradicts CLAUDE.md's rebuild-after-src rule. @reviewer FAILed it (stale-bundle test red) and forced a loop-back.
  **Fix:** none
- **Problem:** `ensure-dist.mjs` copied the non-symlink-safe run-directly check from `check-versions.mjs`, so it failed open via symlinked paths; @test caught it, @reviewer blocked on it. The same pattern remains in `check-versions.mjs` (one `scribe/ast-stability.test.ts` case fails under a /tmp temp dir).
  **Fix:** none
