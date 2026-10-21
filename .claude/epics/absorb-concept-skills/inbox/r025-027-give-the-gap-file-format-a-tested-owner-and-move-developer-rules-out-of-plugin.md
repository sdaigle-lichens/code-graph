# Report r025: 027-give-the-gap-file-format-a-tested-owner-and-move-developer-rules-out-of-plugin.md

- Task: 027-give-the-gap-file-format-a-tested-owner-and-move-developer-rules-out-of-plugin.md
- Written: 2026-10-21T15:17:51.368Z
- From session: maestro-195f90c4

Task 027 outcome: implemented, tested, reviewed and documented. Nothing committed. Worktree /home/superadmin/gits/code-graph-task-027, branch task-027, rebased onto e876d55 (task 026, 0.3.19).

Shipping version: 0.3.20 in packages/code-graph/package.json, plugin/.claude-plugin/plugin.json and .claude-plugin/marketplace.json. Bundle regenerated with pnpm build.
Fixture path for maestro's parity test: plugin/contracts/skill-gaps.example.json (schema beside it: plugin/contracts/skill-gaps.schema.json).

Change set (027):
- plugin/contracts/skill-gaps.example.json and skill-gaps.schema.json (new)
- packages/code-graph/src/skills/gap-contract.test.ts (new): extracts the skill_gaps examples from the scribe and code-graph-retrieval SKILL.md files, asserts they parse and match the fixture shape, and asserts the scribe skill names .claude/channels/scribe/<agent>.1.md. No contract wording changed; path and block format untouched.
- plugin/skills/scribe/SKILL.md: gaps arrive inlined under maestro; otherwise the scribe reads .claude/channels/scribe/*.md at the start of a run and says which it handled.
- plugin/skills/CLAUDE.md removed; content now in .claude/rules/plugin-skills.md (paths: plugin/skills/**). Root CLAUDE.md layout line updated.
- packages/code-graph/scripts/check-plugin-clean.mjs (new), wired into the code-graph check script: fails if any CLAUDE.md or .claude/ appears under plugin/ (plugin/.claude-plugin/ is allowed).
- packages/code-graph/CLAUDE.md: one bullet on the above.
- Version bumps and the regenerated bundle.

Kept out of the 027 change set (unstaged, for the manager and user to decide): turbo.json, adding globalPassThroughEnv ["TMPDIR"]. Cause: turbo strict env mode drops TMPDIR, so apps/desktop vitest falls back to an unwritable /tmp in the sandbox and root pnpm test fails with an mkdir ENOENT error. With the change, pnpm test --force passed (401 code-graph and 114 desktop tests, before the rebase). Without it, root pnpm test still fails in the sandbox. Reviewer judged it out of scope but justified.

Verification after the rebase: pnpm check green (6/6, includes check-plugin-clean); package tests 440/440; just eval 7/7 (in the worktree and the main checkout).
Not verified: claude plugin validate (claude is not on PATH in the sandbox; please run it outside); root pnpm test through turbo after the rebase (denied by the permission classifier; only the earlier pre-rebase run passed, with the turbo.json change); the exit code of check-plugin-clean.mjs has no automated test (checked by hand with planted files: exit 1 with CLAUDE.md or .claude/ planted, 0 clean).

Findings:
- Task 026 added nothing that needed carrying into the moved rule: STORE_COMMANDS stays in packages/code-graph/CLAUDE.md.
- The worktree had no node_modules and no scribe-output; node_modules were symlinked from the main checkout and code-graph-search.enriched.json was copied from it (both gitignored). Without the enrichment, eval gave 6/7 (task 2 failed).
- Suggested ticket change: add a test for the check-plugin-clean exit code.
