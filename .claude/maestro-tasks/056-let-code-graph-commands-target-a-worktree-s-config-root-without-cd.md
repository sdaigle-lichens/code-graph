# Let code-graph commands target a worktree's config root without cd

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Follow-up from 050's report: run from a session whose cwd is the main checkout, `code-graph extract` used the main checkout's scribe.config.json even when the work was in a git worktree and CLAUDE_PROJECT_DIR pointed at it. Likely cause, to confirm first: the config loader walks up from the process cwd only, and sessions here never cd (a guardrail), so a worktree can't be targeted. Add a global way to choose the config root: a --root <dir> option on every command that loads scribe.config.json, and possibly CLAUDE_PROJECT_DIR as a fallback when no --root is given. Settle the precedence (--root, then the env var, then the cwd walk) and whether the env var is safe for the plugin's own sessions before implementing. This is a code change in the config loading and CLI options, with tests, docs/usage.md, the plugin skills that run the CLI if they should pass --root, and a regenerated plugin bundle via pnpm bundle.

## Acceptance criteria

- [ ] The report confirms why extract resolved to the main checkout from a worktree
- [ ] `--root <dir>` makes extract, apply, drift, enrich, skills and the query commands load that dir's scribe.config.json and store; without it behaviour is unchanged unless the agreed env fallback applies
- [ ] The precedence between --root, CLAUDE_PROJECT_DIR and the cwd walk is documented in docs/usage.md and covered by tests
- [ ] Plugin bundle regenerated; `just eval` 7/7 and `pnpm check` green (or its parts, in the sandbox)

## Blocked by

- `049-batch-the-per-concept-stamp-extract-apply-and-drift-steps.md`
