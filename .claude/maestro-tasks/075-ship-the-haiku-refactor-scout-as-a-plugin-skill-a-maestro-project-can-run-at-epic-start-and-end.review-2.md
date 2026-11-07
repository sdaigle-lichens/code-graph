# Task 075 direction brief

Round 2

## Redirect note (m024) and how each point was addressed

As reported by @backend; @test and @reviewer have not checked it yet.

1. **"Agent form: not `Explore` ... read-only by its tool list, with a minimal system prompt and Haiku as the model, as close as possible to the benched plain session ... Keep the differences in the skill's 'Not measured' list."**
   The skill now spawns `code-graph:refactor-scout`, from the new `plugin/agents/refactor-scout.md`: `model: haiku`, `tools: Read, Grep, Glob`, one-line system prompt. No fallback to another agent: if it is unavailable the skill prints one line and stops. Checked against `.claude/rules/plugin-skills.md`. "Not measured" lists the remaining differences: the one-line system prompt, the prompt read from a file, no `Bash` or `Skill` tools.
2. **"Resolve scope lines from the git root, to match task 158 ... Map them to the config root internally and cover a config in a git subdirectory with a test."**
   Lines resolve from the nearest `.git` (directory or worktree file); outside a git repository the config root stands in. Plan, prompts and proposals all speak git-root paths; only the store lookup uses config-root paths. The plan gained a `root:` line (`root` in `--json`). Tests cover a config in a git subdirectory on dist and bundle. An existing file outside the config root is named under `skipped lines:` and the run continues.
3. **"A scope where nothing was scanned must not read as a clean result ... `PROPOSALS: none` alone stays reserved for a scan that ran."**
   The CLI never prints `PROPOSALS: none`; exit 0 stays. An empty plan prints one line, for example `nothing scanned: no file in scope is in the code index (1 ignored); this is not a clean result, the scout read no code`. `--json` gets `nothingScanned` (the reason, or `null`). The skill reserves `PROPOSALS: none` for sessions that actually answered and prints a `nothing scanned:` line when every session failed. Tests cover plain and `--json` on dist and bundle, and pin the skill text.
4. **"Keep the benched wording, and add to 'Not measured' that an arbitrary scope has no added neighbours, unlike the bench scopes."**
   Done.
5. **"Put one short command in your report for the user to try the skill on a small scope."**
   @backend supplied one; it goes in the final report to the user. Not run: it spends on Haiku, and `claude` is not on the sandbox's PATH.

## Goal

Unchanged from round 1.

## Deviations

The round 1 deviations 3, 5 and 6 are replaced by the points above. New:

- The agent definition adds one line to the Agent tool's listing in every session using the plugin. Its description says it is spawned only by the skill.

## Decisions

- Cap of 5 sessions (55 files), as accepted.
- `formatPlan` pluralisation fixed.
- Version stays 0.3.43, unshipped.

## Touches

Added since round 1: `plugin/agents/refactor-scout.md`. Changed again: `packages/code-graph/src/scout/` (scope, run, tests), `packages/code-graph/src/cli.ts`, `plugin/skills/refactor-scout/SKILL.md`, `plugin/.claude-plugin/plugin.json`, `plugin/scripts/code-graph.cjs`, `docs/usage.md`, `docs/development.md`.

## Sibling impact

Task 158 gets git-root paths back in the proposals. Two limits remain for a config in a git subdirectory; both fail loudly:

- From the git root the command does not find the config (exit 5), so the session must start in that subdirectory or pass `--root`.
- A relative `<scope-file>` resolves against that directory, not the git root (exit 11 if it is not there). An absolute path works.

## Questions

1. If task 158 prints a relative scope-file path, the second limit is a mismatch. Is a small fallback wanted here, or does the contract use an absolute path? It was not in the redirect, so it was not added.
