# Report r020: 022-tell-an-unreadable-deps-dir-from-a-missing-one-in-a-sandboxed-session.md

- Task: 022-tell-an-unreadable-deps-dir-from-a-missing-one-in-a-sandboxed-session.md
- Written: 2026-10-20T01:28:11.730Z

Outcome: task 022 done, nothing committed.

- `deps status` and the missing-dependency error now name `sandbox.filesystem.allowRead` and the absolute cache dir when SANDBOX_RUNTIME=1 or a deps dir stat gives EACCES/EPERM. The non-sandboxed message (`deps install`) and the exit code are unchanged.
- `code-graph-install` step 7 offers the allowRead edit with consent, only when the sandbox is enabled, user settings by default, idempotent.
- Install target stays ~/.cache: no documented way to locate the plugin data dir from the user's shell (CLAUDE_PLUGIN_DATA is unset there, `claude` is not on PATH in the sandbox).
- Version 0.3.15 in all three files, bundle regenerated, docs updated (CLAUDE.md, installation, usage, development).

Findings: 329/329 package tests, pnpm check, just eval 7/7 green. Not verified: `claude plugin validate` and the step 7 flow end to end. Plain `pnpm test` from the root fails in this sandbox (tsx needs /tmp/tsx-1000); it passes with TMPDIR=/tmp/claude-1000.

Post-mortem: none, clean session. One note: the scribe first ended with `HANDOFF: scribe complete` (no route); resumed and corrected to `HANDOFF: success`.

Suggested ticket changes: none. The task was not linked to the epic when the run started, so the report is filed late.
