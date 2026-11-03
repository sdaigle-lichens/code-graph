# Report r054: 062-test-ensure-store-against-the-real-cli-so-a-stub-that-drifts-from-it-fails-pnpm-test.md

- Task: 062-test-ensure-store-against-the-real-cli-so-a-stub-that-drifts-from-it-fails-pnpm-test.md
- Written: 2026-11-02T16:50:25.269Z
- From session: absorb-concept-skills-062

## Outcome
Task 062 done in worktree /home/superadmin/gits/code-graph-task-062 (branch task-062), changes uncommitted. Added packages/code-graph/src/ensure-store-cli.test.ts (3 tests) that runs scripts/ensure-store.mjs against the real dist/cli.js, no stub: (1) no graph.db builds the store and prints `store: built just now from <root> (a; extract + apply)`, with live vertices; (2) a second run is a no-op (empty stdout, db mtime and size unchanged); (3) adding concept b builds only b, and a's rows, a.enriched.json and a.ast.json stay byte-identical.

## Verified
Full suite green in the worktree (pnpm test 705 pass, 0 fail; pnpm check 6/6; just eval 7/7), run by @test on the uncommitted tree, not on a commit. Nothing was committed, so there is no commit to name. @reviewer re-ran the new file (3 pass, about 4.6s), prettier and tsc: clean.

## Findings
- No mismatch between ensure-store.mjs and the real CLI; the script is unchanged.
- Mutation check: `--root` changed to `--rooot` in the script made all 3 tests fail (CLI printed `unknown option '--rooot'`); reverted.
- ts-morph resolution: the test clears CLAUDE_PLUGIN_DATA, points XDG_CACHE_HOME at an empty temp dir and symlinks the repo's packages/code-graph/node_modules/ts-morph into the temp project. No install or network. Runtime about 4.5s.
- Pre-existing order dependency: in a fresh worktree, code-graph-desktop graph-canvas-real-store.test.ts fails on the first `pnpm test` if scribe-output/graph.db does not exist yet (turbo runs it in parallel with just eval, which builds the store). It passes once the store exists.
- pnpm-lock.yaml shows 25 inserted lines in the worktree; the task did not touch it (the main checkout was already modified at session start). Check before merging.
- @scribe: no doc change needed.

## Suggested ticket changes
- Whoever merges bumps the version (0.3.39 or 0.3.40 per the manager's ordering with 063) and re-runs pnpm bundle.
- Possible follow-up: make the desktop real-store test build or skip when graph.db is missing.
