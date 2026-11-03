# A claude -p runner that measures graph vs no-graph with working Bash

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

`claude plugin eval` can't measure the graph on this machine. Its runs nest Claude Code's sandbox, and
in 035's paid run every Bash call failed with `apply-seccomp: write /proc/self/setgroups ...
Permission denied`, so no code-graph command ever returned output (see "Maestro benchmark findings" in
`docs/evals.md`). Build a small runner on `claude -p` instead. The user starts it from a plain terminal,
so nothing is nested.

The runner:
- **Input:** a case list. Each case has a question, a workspace setup command, and two arms: without
  the code-graph plugin, and with it (`--plugin-dir plugin`). Same prompt, same workspace, same model.
- **Per run:** a fresh workspace under `$TMPDIR`, then `claude -p` with `--output-format stream-json`,
  `--model`, `--max-budget-usd`, `--no-session-persistence` and a fixed `--allowedTools` set that
  includes Bash. Keep each transcript.
- **Isolation:** the no-graph arm must not see the code-graph plugin from the user's own install.
  - Use the documented flags (`--setting-sources`, `--strict-mcp-config`).
  - Check that the transcript's init event confirms it.
  - A run whose init event shows the wrong plugins or skills is marked invalid, not counted.
  - Use the user's normal login. Don't require an API key or a separate config dir unless isolation
    can't be had otherwise; if it can't, stop and report rather than building around it.
- **Metrics per run:** cost, turns, input/output/cache tokens, counts of Read, Grep, Glob, Bash and Skill,
  and for each code-graph CLI call its exit code and output size.
- **Bash check:** any `apply-seccomp`, or any other Bash failure that isn't a documented code-graph exit
  (0, 4, 6, 7), marks the run invalid and is reported first.
- **Budget:** a total cap; the runner stops when it's reached.
- **Output:** a table per case and arm, results gitignored. Keep it to a couple of scripts. No
  generated plugins, no re-extraction, no copies of maestro.

Location: a new top-level `bench/`, outside `plugin/`, with a short `bench/README.md` covering the
command, the flags and the validity checks. Link it from `docs/evals.md`.

Check, user-run from a plain terminal, under $1:
- one case on the `plugin/evals` fixture (`02-impact-movetask`'s question; reuse
  `plugin/evals/scaffold-lib.sh` for setup), 1 run per arm.
- **Pass:** the graph arm makes at least one code-graph call that exits 0 with real output, no run has a
  Bash failure, and the no-graph arm's init event shows no code-graph plugin.

Verify the flag names against `claude -p --help` on the user's machine (ask them to run it with `!`).
Don't build on documentation alone.

Out of scope:
- the maestro measurement (ticket 039);
- an LLM judge (answers are checked by regex only);
- changes under `plugin/` or `packages/`;
- a version bump.

## Acceptance criteria

- [ ] `bench/` runner: fresh workspace per run, both arms, kept transcripts, the metrics above, a total budget cap
- [ ] A run is marked invalid on a seccomp or other non-code-graph Bash failure, or on wrong plugins/skills in its init event, and the report says so first
- [ ] Flag names checked against `claude -p --help` on the user's machine
- [ ] User-run check on the fixture (1 run per arm, under $1) passes: a code-graph call exits 0 with output, no Bash failure, the no-graph arm has no code-graph plugin; the report includes its table
- [ ] `bench/README.md` written, linked from `docs/evals.md`; results gitignored
- [ ] pnpm check and the full `pnpm test` from the root green

## Blocked by

- `036-make-the-desktop-canvas-test-count-cross-concept-edges-from-the-store.md` (green full test suite)
