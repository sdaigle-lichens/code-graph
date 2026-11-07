# Follow-up to 075: scout proposal paths relative to the git root (direction review)

This stop is a direction check (the manager-review step, run as a human review because no task is active for this follow-up). @test, @reviewer and @scribe still follow.

## Goal

The user's smoke run printed absolute proposal paths (`- /home/superadmin/gits/code-graph/packages/...: ...`). The contract with Maestro task 158 says git-root-relative (`- packages/...: ...`). Aim (from the epic's manager): every printed proposal path is git-root-relative whatever form the agent answers in; a path outside the repository is kept as given and flagged; pinned by a test.

## Changed

- `packages/code-graph/src/scout/proposals.ts` (new): parses the sessions' `PROPOSALS:` sections and rewrites each path.
- `packages/code-graph/src/cli.ts`: new form `code-graph scout --proposals` reads the sections on stdin and prints one block; `scout <scope-file>` became `scout [scope-file]`.
- `plugin/skills/refactor-scout/SKILL.md` step 3: pipes the returned sections through `scout --proposals` with a quoted heredoc, and prints its output as is.
- `docs/usage.md`: `--proposals` and its exit codes; exit 13 troubleshooting row.
- `plugin/scripts/code-graph.cjs`: regenerated.

## Did

- @backend: added the normaliser and CLI form, rewired the skill, documented it, regenerated the bundle, and smoke-tested the bundle with no model.

## Decisions

- Normalisation is in code, not the prompt, so the model's path form doesn't matter.
- Absolute in-repo paths lose the root; `./` and `a/../` are cleaned. With a config in a subdirectory, a relative path is taken from the git root if the file exists there, else from the config root; for a new file the same test runs on its directory, and the git root wins a tie.
- Outside-repo paths are kept and named on a line `outside the repository: <n> path(s) kept as given: ...` printed before the block.
- `:12` / `:12-30` line refs are kept; backticks dropped; `* ` bullets become `- `; anything before the first `PROPOSALS:` is ignored. All sections `none` gives `PROPOSALS: none`.
- New exit 13: stdin has no `PROPOSALS:` line (never prints `PROPOSALS: none`). Exit 1 for a scope file or `--json` combined with `--proposals`, or neither form. Exit 5 no config.
- Version stays 0.3.43 (unreleased).

## Deviations from the ticket

1. No pinning test yet: @backend's role doesn't write tests. @test writes it next (targets are in its channel file).
2. Prettier was run on `cli.ts`; `just regraph` may show it as changed.
3. `--proposals` also exits 8 without `node:sqlite` although it opens no store (`scout` is in `STORE_COMMANDS`); documented.
4. **Unverified risk:** whether the skill's `allowed-tools` pattern `Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" scout *)` accepts a command carrying a heredoc. Only a real skill run shows it; the fallback is passing the sections as an argument.

## Verified

Working tree on top of commit 740b987 (branch `075-refactor-scout`, fix uncommitted): `node_modules/.bin/turbo run check typecheck test --force`, 14 of 14 tasks, 0 cached, code-graph 813 tests, 812 pass, 0 fail, 1 todo (the known exit 3 gap). The new code has no test of its own yet; @test adds it next.

## Questions

- Is a new CLI form (`scout --proposals`) and exit 13 the right shape, or should normalisation stay inside the existing command?
- Accept the heredoc risk until the next smoke run, or switch to passing the sections as an argument now?
