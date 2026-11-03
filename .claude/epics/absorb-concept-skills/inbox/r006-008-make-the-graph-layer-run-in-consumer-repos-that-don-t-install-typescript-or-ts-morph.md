# Report r006: 008-make-the-graph-layer-run-in-consumer-repos-that-don-t-install-typescript-or-ts-morph.md

- Task: 008-make-the-graph-layer-run-in-consumer-repos-that-don-t-install-typescript-or-ts-morph.md
- Written: 2026-10-15T22:23:32.679Z

Outcome: task 008 done (uncommitted, main checkout). Graph layer: extract/apply/drift exit 0 with a skip message when no concepts are configured (no ts-morph/typescript/node:sqlite load). ts-morph resolves from CLAUDE_PLUGIN_DATA/deps, then the XDG cache dir, then the project install; the error names `code-graph deps install`. New `deps install` and `deps status` commands. code-graph-install skill adds the db gitignore step and offers deps install. Docs, plugin.json and marketplace.json (0.3.2) and the bundle are updated. Reviewer: pnpm test 252/252, pnpm check, just eval 7/7, plugin validate all green.

Findings: only ts-morph is installed, since ts-morph carries its own compiler and code-graph imports nothing from typescript directly. The monorepo end-to-end (real npm download) was verified by hand by backend only, not in automated tests. The gitignore idempotency lives in skill prose and is not executable.

Post-mortem: the first test agent was stopped by the user mid-run after a template-literal backtick syntax error left cli.test.ts failing at file level, and a fresh test agent finished the fix. Backend left 4 old-behaviour tests failing for the test agent, as designed.

Suggested ticket changes: none. Consider a follow-up to add a networked CI check of deps install.
