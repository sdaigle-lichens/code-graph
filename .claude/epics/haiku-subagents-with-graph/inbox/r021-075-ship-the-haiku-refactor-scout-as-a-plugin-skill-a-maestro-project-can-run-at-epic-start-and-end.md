# Report r021: 075-ship-the-haiku-refactor-scout-as-a-plugin-skill-a-maestro-project-can-run-at-epic-start-and-end.md

- Task: 075-ship-the-haiku-refactor-scout-as-a-plugin-skill-a-maestro-project-can-run-at-epic-start-and-end.md
- Written: 2026-11-07T14:05:54.946Z
- From session: haiku-subagents-with-graph-075

# Task 075 report: Haiku refactor scout shipped as a plugin skill

## Outcome

Done; nothing committed, pushed or merged. The changes are uncommitted in the main checkout on `main`, at HEAD 518d088.

- New `code-graph scout <scope-file> [--json]` command (`packages/code-graph/src/scout/`). It reads the scope with lines relative to the git root, splits it by import neighbourhood (11 files per session, 5 sessions at most, largest sessions first so the smallest are cut and named), builds the bench's metrics primer from the store plus ts-morph, and writes the per-session prompt files.
- New plugin skill `plugin/skills/refactor-scout/SKILL.md` and agent `plugin/agents/refactor-scout.md` (Haiku; Read, Grep, Glob; one-line system prompt). The skill prints `PROPOSALS:` or `PROPOSALS: none`, and `none` only when a session actually ran. A run that scanned nothing prints a `nothing scanned:` line instead.
- Exit codes: 11 bad scope file; 12 no `tsconfig` key, no index, or no ts-morph; 5 no config; 8 no `node:sqlite`; 1 other failure; 3 documented but unreachable (see findings).
- Version 0.3.42 to 0.3.43 in all three files; bundle regenerated; `bench/` unchanged, with a byte-parity test pinning the primer and prompt to the bench.

## Verified

Working tree on top of 518d088, after the last edit (scribe's docs): `node_modules/.bin/turbo run check typecheck test --force`, 14 of 14 tasks, 0 cached, code-graph 813 tests, 812 pass, 0 fail, 1 todo (the exit 3 gap, pinned on purpose). Bench `node --test bench/*.test.mjs`: 244 of 244 pass. `just eval` 7/7 in round 1; retrieval code not touched since. A forced bundle rebuild reproduced the shipped bundle.

**Unproven:** acceptance criterion 1. The Haiku spawn has never run, because no paid run was allowed and `claude` is not on the sandbox PATH. The plugin does load the agent and skill: this session lists `code-graph:refactor-scout` with Read, Grep and Glob. The user can try it with:
`ls packages/code-graph/src/scout/*.ts > /tmp/scope-try.txt && claude --plugin-dir plugin "/code-graph:refactor-scout /tmp/scope-try.txt"`

## Findings

- **Shared defect, predates this ticket:** `preflight` runs `bootstrapStore`, whose `applySchema` writes `PRAGMA user_version` before `checkSchemaVersion` reads it. Exit 3 is unreachable for `status`, `search`, every `query` subcommand, `eval` and `scout`, and a newer store is silently downgraded to 1. `apply`, `enrich` and `delete-concept` have no version check at all. It is documented as a known limitation in `docs/usage.md` and as a Trap in the scribe-pipeline skill, and is not fixed.
- A config in a git subdirectory needs an absolute scope-file path, and a session started in that subdirectory or `--root`. Both limits fail loudly (exit 5 or 11), and the skill and usage docs say so. Task 158 should print an absolute path, as the manager arranged with `maestro-bf`.
- The `findTsconfig` auto-detection fallback was removed. A store built before the `tsconfig` key was removed now stops at exit 12 instead of scanning.
- Parallel scout runs overwrite each other's prompt directory (`scribe-output/scout/`).
- Grep and Glob may be missing on some builds; the agent's behaviour with Read alone is untested.
- `pnpm` keeps adding `@pnpm/exe` 12.10.1 to `pnpm-lock.yaml` (left dirty, unrelated to this ticket). Turbo's test task does not list `plugin/skills` as an input, so a skill-only edit stays cached.
- Scribe edited `.claude/rules/plugin-skills.md` (the refactor-scout exception to "work with no tsconfig") and `.claude/skills/scribe-pipeline/SKILL.md` (extract and apply run; stamp not run, because `rows.ts` changed since the last stamp and was not reviewed).

## Post-mortem notes

Manager redirect m024 (agent form, git-root paths, false all-clear); reviewer FAIL in round 1 (tsconfig key misreported, cap cut the wrong sessions, exits missing from the docs); a session restart lost every task-075 channel file and stopped @test mid-round; false `handoff-issues` flags on every interim stop. Details are in the task file's `## Post-Mortem`.

## Suggested ticket changes

- New ticket: fix shared `preflight` so the schema version is read before `applySchema` writes it (or the write is skipped when the stored version is higher), with a test per store command. Then remove the todo in `scout-cli-exits.test.ts` and the known-limitation notes.
- New ticket, user-run: a small paid smoke run of the `refactor-scout` skill to prove criterion 1.
- Optional: add `plugin/skills/**` to turbo's test inputs; decide about the `pnpm-lock.yaml` `@pnpm/exe` diff; deep-review and stamp scribe-pipeline.
