# Task 075 direction brief (round 1)

## Goal

Move the Haiku refactor scout out of the bench and into the product: a plugin skill (`refactor-scout`) plus a new CLI command (`code-graph scout <scope-file> [--json]`). The skill takes a scope file, spawns its own Haiku agent(s) and prints a `PROPOSALS:` block or `PROPOSALS: none`. It is advisory: no code changes, no decided-against input, nothing handed to a worker.

## Deviations

As reported by @backend; nothing here has been checked by @test or @reviewer yet.

1. **Primer source.** Built from the store plus the ts-morph catalog, not the store alone, because the store has no import edges. The bench did the same. A missing ts-morph or a broken tsconfig therefore also stops with exit 12, on top of the ticket's "no index or no tsconfig".
2. **Primer is a port, not shared code.** `bench/refactor.mjs` is unchanged so stored primers stay valid; a byte-parity test pins the shipped primer to the bench's.
3. **Agent form differs from the benched form.** The prompt reaches the session through a file, and the agent is `Explore` (read-only) with `model: "haiku"`, rather than a plain session with Bash, Read, Grep, Glob and Skill. Its system prompt differs from the benched one. The skill's "Not measured" list says so. The Haiku spawn itself has never been run (no paid run was allowed); only the CLI half up to the prompt files was exercised.
4. **Prompt wording.** "the maestro repository" became "the repository". The bench's "(a change's files and the files next to them in the import graph)" is kept verbatim although no neighbours are added for an arbitrary scope.
5. **Repo-relative paths** mean relative to the `scribe.config.json` directory. A config in a git subdirectory would not match git-root-relative paths from Maestro; no test covers that case.
6. **Bad scope lines** are skipped and named rather than aborting. An empty or unscannable scope prints `PROPOSALS: none` and exits 0.
7. **No config** exits 5 (existing convention) rather than 12.

## Decisions

- **Session cap:** 5 sessions (55 files). The ticket left the number open. The smallest sessions are the ones cut, and their files are named. Unrelated small groups may share a session.
- **Exit codes:** 11 bad scope file, 12 no index or no tsconfig, 5 no config, 8 no `node:sqlite`.
- **Version:** 0.3.42 to 0.3.43 in all three version files.
- **No change** to the maestro repo, to `bench/`, to retrieval code, or to any project's configuration. No paid run.

## Touches

- `packages/code-graph/src/scout/` (new module: primer, prompt, scope, run, tests)
- `packages/code-graph/src/cli.ts`, `packages/code-graph/src/sqlite-guard.ts`
- `plugin/skills/refactor-scout/SKILL.md` (new)
- `plugin/scripts/code-graph.cjs` (generated)
- `packages/code-graph/package.json`, `plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
- `docs/usage.md`, `docs/development.md`, `packages/code-graph/CLAUDE.md`

## Sibling impact

- None expected on other tickets in the epic: bench code and stored primers are untouched.
- Task 158's scope contract in the maestro repo is the consumer. Deviation 5 matters there: Maestro's scope paths are git-root-relative, so a project whose `scribe.config.json` is not at the git root would see its scope lines rejected.

## Questions

1. Is deviation 3 (read-only `Explore` agent instead of the benched plain session) the right direction, given the skill must change no code but the bench measured a different form?
2. Is deviation 5 acceptable for now, or should scope paths resolve from the git root to match task 158?
3. Is the cap of 5 sessions (55 files) acceptable?
