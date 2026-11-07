# Report r023: 075-ship-the-haiku-refactor-scout-as-a-plugin-skill-a-maestro-project-can-run-at-epic-start-and-end.md

- Task: 075-ship-the-haiku-refactor-scout-as-a-plugin-skill-a-maestro-project-can-run-at-epic-start-and-end.md
- Written: 2026-11-07T18:04:42.300Z
- From session: haiku-subagents-with-graph-075

# Task 075 follow-up: scout proposal paths relative to the git root

**Commit 4a6086e** on branch `075-refactor-scout`, on top of 740b987. The user approved the commit at this session's prompt. 8 files. Not pushed or merged.

## Outcome

Every printed proposal path is now relative to the git root, whatever form the agent answers in. The skill's step 3 pipes the sessions' `PROPOSALS:` sections through a new command, `code-graph scout --proposals` (stdin → one block).

- **Absolute in-repo paths** are rewritten relative to the git root, and the root itself prints as `.`.
- **Path cleanup:** `./` and `a/../` are removed.
- **Config in a subdirectory:**
  - A relative path is taken from the git root if the file exists there, otherwise from the config root.
  - A config-relative `../` path is judged after the config root is joined.
  - A path that leaves the git root is flagged as outside.
- **Paths outside the repository** are kept as given and named on a line printed before the block: `outside the repository: <n> path(s) kept as given: ...`.
- **Backticks:** all five layouts are handled: `` `p`:12 ``, `` `p`:12-30 ``, `` `p:12` ``, `` `p` ``, and bare `p:12`. Line refs are kept.
- **Bullets:** `- `, `* `, `1. ` and `1) ` are all printed as `- `.
- **Exit 13** when stdin has no `PROPOSALS:` line. The command never prints `PROPOSALS: none` for a missing section.

## Verified

Results on commit 4a6086e:

- `node_modules/.bin/turbo run check typecheck test --force`: exit 0, 14 of 14 tasks, 0 cached.
- code-graph: 924 tests, 923 pass, 0 fail, 1 todo (the known exit 3 gap, ticket 076).
- Unit tests and CLI tests on dist and on the bundle pin each form.
- 34 mutants (deliberately broken copies of the code) across three test rounds were each caught by at least one test.
- The bundle is byte-identical to a fresh rebuild.
- The reviewer ran the bundle against a temp repo with the config in `pkg/`, and every form printed relative to the git root.

## Review history

- **Round 1, reviewer FAIL:** an absolute repo root was flagged as outside.
- **Round 2, reviewer FAIL:** with `` `abs`:12 `` (the line ref after the closing backtick), the absolute path printed unchanged and was not flagged.
- **Round 3:** both were fixed, together with numbered bullets and the docs wording, and the reviewer passed it.

## Known limits (documented)

- **No realpath:** a symlinked checkout, or macOS `/private/tmp` against `/tmp`, flags in-repo paths as outside.
- **Prose after `PROPOSALS:`:** any bullet after the `PROPOSALS:` line, prose or not, prints as a proposal line, unchanged and unflagged. The reviewer ruled this acceptable: dropping such lines would also drop real proposals.
- **Backticks on outside paths:** a path outside the repository keeps its backticks on its proposal line. This is cosmetic, since the `outside` line lists it cleanly.
- **Exit 8:** `--proposals` exits 8 without `node:sqlite`, although it opens no store.
- **Unverified:** whether the skill's `allowed-tools` pattern accepts the heredoc command. Only a real skill run shows it; the fallback is passing the sections as an argument.
- **Top-level new file:** with the config in a subdirectory, a new top-level file named without a directory resolves to the git root. A test pins this design choice.

## Left out of the commit

`pnpm-lock.yaml`, `docs/report.md`, and the Maestro records (`.claude/epics/`, `.claude/maestro-tasks/`).

## Suggested next step

A user-run smoke run of the skill would confirm both the path output and the heredoc risk.
