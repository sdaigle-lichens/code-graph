# Task 078: review round 2 (manager direction check)

Round 2. The manager's round 1 redirect asked for three changes:

> 1. An ambiguous rename must not block its whole concept. Apply the concept, re-key the unambiguous renames, keep the ambiguous entries as orphans and list them in update-skills-report.md on every run until a person settles them. Exit 10 stays for an interactive apply without --approve-unambiguous-renames.

**Addressed.** With `apply --approve-unambiguous-renames`, the concept is applied and the clear renames are re-keyed. An ambiguous entry stays in `<concept>.enriched.json` untouched, and nothing is deleted. Each one is recorded in `scribe-output/ambiguous-renames.json` and appended to every report until it is settled, by `enrich prune` or by a re-enrich. With the flag, apply exits 0. Exit 10 remains for `--defer-renames` and `refresh-skills`. This was checked on a fixture with one clear and one ambiguous rename in the same concept. The code is in the new `src/scribe/pending-renames.ts`.

> 2. Narrow the headless allowlist: only `Bash(node <plugin root>/scripts/code-graph.cjs:*)` (real path, resolved at spawn time) plus the read-only git entries.

**Addressed.** `unattendedAllowedTools(cliScript)` allows:
- Read, Edit, Write, Glob, Grep, Skill, Agent, TaskCreate, TaskUpdate
- `Bash(node <realpath>/plugin/scripts/code-graph.cjs:*)`
- git diff, log, show, status, rev-parse, rev-list and ls-files

`Bash(node:*)` is gone.

> 3. Run the real claude -p path end to end once, on a small temporary fixture.

**Addressed, in three real runs by the user from a plain terminal.** The fixture is `/tmp/claude-1000/e2e-078/repo`, with two concepts: alpha is one commit behind, beta is current. The command was `node /tmp/claude-1000/e2e-078-scripts/run-e2e.mjs <fixture> <checkout>`.

- **Run 1**, exit 0. The headless session could not write `.claude/skills/alpha/SKILL.md`: the sandbox refuses writes under `.claude/` in every permission mode. It still advanced the repo-level `skills.last_update` past the stale concept. Two defects.
- **Fixes after run 1:**
  - The session now writes each revised SKILL.md and a `manifest.json` to a `staging:` directory named in the prompt. After claude exits 0, the runner (a plain node process that holds the lock) installs and stamps them, runs extract and apply, and stamps the repo-level record last. The code is in the new `src/scribe/update-staging.ts`.
  - Any failure makes the run INCOMPLETE: no manifest, a missing or failed concept, a missing staged file, or a non-zero exit. An incomplete run advances nothing and keeps the staging directory. The report header and the state file (`complete: false`) say so.
- **Run 2**, exit 0, `result: INCOMPLETE`. The fail-safe held and the diff was empty. The cause: the session ran `--claim-update`, which exited 14 because the runner holds the lock. It could not read `CODE_GRAPH_UNATTENDED` under the allowlist.
  - Fix: the -p prompt now carries `claimed: by the runner; do not run --claim-update or --finish-update`, and the skill's Unattended mode keys on that line. A session-started run, such as the scribe subagent's, still claims and finishes.
  - Staged-run partials, including an enrichment subagent's `outPath`, go to `<staging>/partials/` instead of `$TMPDIR`.
- **Run 3**, exit 0, `result: complete`. The output is in `result.log` at the repo root (untracked).
  - It revised and installed `.claude/skills/alpha/SKILL.md`, documenting the new `computeDiscountedTotal`, and stamped it from 1.0 to 1.1 at HEAD.
  - `scribe.config.json` skills moved from 1.0 to 1.1 at HEAD.
  - `alpha.ast.json` gained the new vertex and its `calls` edge.
  - beta was untouched. The state file shows `complete: true` and the lock was released.

## Goal
Unchanged from round 1.

## Deviations
- A failed concept leaves its own stamp and the repo-level stamp untouched. A concept that installed successfully keeps its stamp.
- An unproven assumption: a runner started by the real Stop hook is outside the Claude Code sandbox (hooks are not sandboxed, Bash tool calls are), so it can write `.claude/skills`. Run 3 was started from a terminal, so it does not prove the hook case.

## Decisions
- The runner installs the files the session staged. The headless session never writes `.claude/` and never stamps.
- The prompt line, not an env var, tells the session that the runner holds the claim.

## Touches
- New since round 1: `src/scribe/pending-renames.ts`, `src/scribe/update-staging.ts`.
- Changed: `src/scribe/update-run.ts`, `apply.ts`, `cli.ts`, `plugin/skills/update-concept-skills/SKILL.md`, `plugin/skills/scribe/refresh-hook.md`, `docs/usage.md`, and the regenerated bundle.
- `scribe/SKILL.md` is untouched since round 1 and stays within its 9216-byte budget.

## Sibling impact
Unchanged: task 077 merges first.

## Questions
- Is the staging and runner-install design acceptable?
- Is the open assumption about the hook-spawned runner acceptable to carry into @test and @reviewer? It would be confirmed in the first real consumer session.

## Verified
Uncommitted working tree on HEAD 6c9cc33:
- `pnpm build`, `pnpm check`, `pnpm test` (971/971) and `just eval` (7/7) pass, as reported by @backend in round 4.
- The tests for the ticket's cases are not written yet: the @test step writes them from `.claude/channels/task-078/test/backend.1.md`.
