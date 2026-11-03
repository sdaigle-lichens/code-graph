# Report r004: 006-dogfood-parity-check-and-publish-the-code-graph-plugin.md

- Task: 006-dogfood-parity-check-and-publish-the-code-graph-plugin.md
- Written: 2026-10-14T15:03:56.290Z
- From session: code-graph-24

# Task 006 report: dogfood, parity check, publish

**Outcome:** done. **Published version: 0.3.0.** `plugin/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` both carry 0.3.0 (no double bump). Nothing is committed. For maestro tasks 105-107 (epic code-graph-cutover), the version to pin is 0.3.0.

## Findings
- code-graph's own skills are stamped (`code-graph-search`, `scribe-pipeline` at 1.0). New eval task-7-marker-stamped-skill; `just eval` is 7/7.
- Maestro scratch copy: `skills list --json` is byte-identical to `concept-skills.cjs list --json` (17 skills). After a committed edit to a glob file, `skills status --json` lists the changed files; status is a commit window, so uncommitted edits do not show. Update simulated by hand: only `task-queue` got a minor bump (1.4 to 1.5), repo record 1.29 to 1.30.
- Terraform sample (no tsconfig, no node_modules): `search` returns the `network-vpc` skill doc.
- Defect fixed: in docs-only repos, `search` warned "0/1 concepts enriched" and `concept <docs-only>` exited 6. `query/gaps.ts` and `query/run.ts` now skip docs-only concepts. Regression tests added.
- Fixed 9 desktop tests that hardcoded counts from the gitignored graph.db; they now derive counts from the store.
- `claude plugin validate` passes. Isolated install of `code-graph@code-graph` from the marketplace gave 0.3.0, enabled.
- Gates: code-graph 241/241, desktop 114/114, `pnpm check` clean, eval 7/7.

## Not verified
- create / update / install skill flows were NOT run inside Claude (only their CLI steps); update was a manual simulation.
- No Node older than 22.5 available; a `node:sqlite`-throws shim was used instead (simulation).
- The reviewer did not re-run the maestro-copy or Terraform dogfood itself.

## Suggested ticket changes
- A follow-up to run the create/update/install flows live inside Claude, and `skills list` on a real Node <22.5.
- Untracked `plan.md` at the repo root: confirm it is intentional before committing.
