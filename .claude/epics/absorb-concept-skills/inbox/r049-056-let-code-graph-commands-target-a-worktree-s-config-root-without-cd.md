# Report r049: 056-let-code-graph-commands-target-a-worktree-s-config-root-without-cd.md

- Task: 056-let-code-graph-commands-target-a-worktree-s-config-root-without-cd.md
- Written: 2026-11-01T23:08:11.944Z
- From session: absorb-concept-skills-056

## Outcome
Ticket 056 done. Global `--root <dir>`, then `$CLAUDE_PROJECT_DIR`, then the cwd walk, for every command, through one helper `chooseStartDir` with read and create modes. The preAction hook in cli.ts chdirs to the chosen root.

## Verified
Commit 2546650 (code and tests). pnpm check 6/6 green; code-graph tests 654/654; desktop 115/115; pnpm build leaves the bundle unchanged. `just eval` 5/7 (task-2-traversal-expansion, task-6-docs-only-concept): the known ticket-059 result on an enriched store, not a regression. Version unbumped, bundle regenerated.

## Findings
- Root cause: loadConfig/tryLoadConfig walked up from process.cwd() only, and sessions never cd.
- @test found two defects in round 1 (stale CLAUDE_PROJECT_DIR broke every command; `skills` took a config-less env dir). Fixed. The manager's round 2 redirect kept `skills stamp`/`agents-set` first-write at the project root (create mode).
- Reviewer: no blocking findings. Warnings: the global `--root` overlaps the `skills` group's own `--root`; in create mode a config-less env dir can make a cwd-project skill report not found (documented); no dedicated git worktree test (probe only).
- @scribe (uncommitted, after 2546650): new "Project root" section in concept-skills-layer SKILL.md (marker 1.1), a trap bullet in scribe-pipeline SKILL.md (marker 1.2), a Gotchas bullet in packages/code-graph/CLAUDE.md. `skills stamp` exited 9 in the sandbox (EROFS), so the markers were set by hand with Edit; extract + apply ran for both concepts.
- scribe-pipeline.enriched.json has an orphan enriched vertex c8e3ece74edc328ce6f50721df4f86fb not in ast.json (needs remap or re-enrich).

## Post-mortem
Round 2 manager redirect (skills first-write regression from one shared rule); test agent's `HANDOFF: success` carried real defects and was looped back to @backend.

## Suggested ticket changes
Consider a dedicated git worktree test; consider consolidating the two `--root` options. Merger bumps to 0.3.34 and re-runs pnpm bundle.
