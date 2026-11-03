# Report r053: 057-make-just-eval-build-the-graph-store-in-a-fresh-worktree-instead-of-scoring-0-7.md

- Task: 057-make-just-eval-build-the-graph-store-in-a-fresh-worktree-instead-of-scoring-0-7.md
- Written: 2026-11-02T15:33:44.330Z
- From session: absorb-concept-skills-057

Outcome: 057 done. `just eval` / `just eval-as-is` now run `just store-fresh` first (packages/code-graph/scripts/ensure-store.mjs, node only, sandbox-safe). A missing, empty or incomplete graph.db is built (extract + apply for the missing concepts only) and prints `store: built just now from <root> (...)`; a build failure exits 3 with one line naming `just regraph`, so a missing store never shows as 0/7. A complete store is never touched. Recipes pass `--root {{justfile_directory()}}`. Root CLAUDE.md documents it, including that a bare `code-graph eval` has no guard. docs/evals.md updated by @scribe. No CLI source change, so no bundle regeneration.

Verified: NOT on a commit. Nothing is committed yet (HEAD d17cc09); the work is uncommitted in the main checkout, per your m014 decision. On that working tree: pnpm check green, pnpm test 702 pass / 0 fail, just eval 7/7 (7/7 on the un-enriched copy; build code-graph 0.3.37). Fresh-worktree check: the backend ran `just eval` in a throwaway worktree (temporary node_modules symlink, no install): store-fresh built all 3 concepts, eval 7/7, results landed in the worktree; the worktree is gone (git worktree list shows only main). A real fresh worktree needs one `pnpm install` by the user. @reviewer confirmed both of your conditions (read-only open, no writes on a complete store; exit 3 never prints "built just now") and ran pnpm check; it did not re-run the full suite or eval.

Findings / follow-ups (non-blocking): (1) a not-sqlite graph.db makes apply fail with exit 3 and the file is left in place; the message does not say to delete it. (2) ensure-store tests cover stubs and docs-only concepts, not real ts-morph extraction. (3) @test added a symlinked-entrypoint test.

Post-mortem: none; clean run.

Suggested ticket changes: none required. Merger steps once the user approves a commit: commit the feature, bump 0.3.38 in the three version files, pnpm bundle, then pnpm check, pnpm test, just eval on that commit; leave pnpm-lock.yaml and your SKILL.md stamps out.
