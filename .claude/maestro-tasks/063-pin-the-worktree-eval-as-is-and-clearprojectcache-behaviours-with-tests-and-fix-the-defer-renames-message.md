# Pin the worktree, eval-as-is and clearProjectCache behaviours with tests and fix the defer-renames message

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Four small leftovers from tickets 056, 058, 059 and 060, bundled because each is a test or a one-line message and they touch the same test area. (1) `--defer-renames` message: with `apply --defer-renames` (exit 10, EXIT_RENAMES_DEFERRED) the orphan remap from 060 is already written to scribe-output/<concept>.enriched.json before apply prints that nothing was written, which is true only of the store. Change the message so it says the store was not written and, when a remap was persisted, that the enriched file was updated; keep the exit code and the --json shape unchanged unless the report says otherwise; add a test (orphans.test.ts has a defer-renames case to extend) and fix the sentence in docs/usage.md and the scribe-pipeline skill that currently describe it. (2) A test that `code-graph eval --store as-is` (what `just eval-as-is` runs) exits non-zero when a task regresses, and that the default stripped-copy mode still exits 0 on the same store; build the regression with a small fixture store like eval-cli.test.ts does. (3) A test for `clearProjectCache()` in extract.ts (the ts-morph Project cache kept per tsconfig for the process life): a second extract in the same process after a source file changes must see the change once the cache is cleared, and the test must fail if clearProjectCache is a no-op. Use the smallest temp project; if ts-morph cannot be resolved inside a test, say how you resolved it and keep the test sandbox-safe (no network, no install). (4) A real git-worktree test for the global `--root` option and the CLAUDE_PROJECT_DIR fallback from 056: create a temp git repo with a scribe.config.json, add a linked worktree with `git worktree add`, run a read command (for example `skills status` or `drift`) from the main checkout with `--root <worktree>` and assert it reads the worktree's config and writes only under the worktree's scribe-output; also assert a create-mode command (`skills stamp` first write or `extract`) does not land in the main checkout. Use git through the child process the way the existing CLI tests spawn it; clean up the worktree in the test's after hook. Do not merge the two --root options and do not touch the refresh lock: those stay parked. Regenerate the bundle with pnpm bundle if CLI source changes; whoever merges bumps the version.

## Acceptance criteria

- [ ] With `apply --defer-renames` that persisted an orphan remap, the final message says the store was not written and the enriched file was updated; without a remap the wording stays accurate; exit code 10 and the --json shape are unchanged; a test covers both cases and docs/usage.md and the scribe-pipeline skill match
- [ ] A test shows `eval --store as-is` exits non-zero when a task regresses and the default mode exits 0 on the same store; it fails if the as-is exit code is made 0
- [ ] A test shows a second extract in the same process sees a changed source file only after clearProjectCache(), and fails when clearProjectCache is a no-op
- [ ] A test using a real `git worktree add` shows `--root <worktree>` reads and writes the worktree's own config and scribe-output, and that a create-mode command does not write into the main checkout; the worktree is removed afterwards and `git worktree list` shows only the main checkout
- [ ] No network, pnpm or install in any test; if CLI source changed the plugin bundle is regenerated; `pnpm check`, `pnpm test` and `just eval` are green on the committed result

## Touched surfaces

- packages/code-graph/src/scribe/apply.ts and/or cli.ts (the defer-renames message)
- packages/code-graph/src/scribe/orphans.test.ts, src/eval/eval-cli.test.ts, a test for extract.ts clearProjectCache, a new worktree-root test
- docs/usage.md, .claude/skills/scribe-pipeline/SKILL.md (defer-renames sentence; stamp is the scribe's, not yours)
- plugin/scripts/code-graph.cjs and the three version files (whoever merges bumps)
- does not overlap ticket 062 (ensure-store.test.ts and scripts/ensure-store.mjs); both add tests, so the merger rebases and regenerates the bundle

## Blocked by

None — can start immediately
