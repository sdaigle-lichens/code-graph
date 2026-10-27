# bench: graph vs no-graph on `claude -p`

`claude plugin eval` nests Claude Code's sandbox, so Bash fails there with `apply-seccomp` and no
code-graph command returns output (see "Maestro benchmark findings" in `docs/evals.md`). This runner
calls `claude -p` directly, so run it from a plain terminal, not from inside a Claude Code session.

## Command

```sh
node bench/run.mjs                 # fixture check: 1 run per arm, total cap $1
node bench/run.mjs --dry           # scaffold + print the claude commands, spend nothing
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--runs` | 1 | Runs per case and arm. |
| `--budget` | 1 | Total USD cap; the runner stops when it is reached. |
| `--run-budget` | 0.75 | Per run, passed as `--max-budget-usd`. |
| `--model` | claude-opus-5-5 | Same model for both arms (always passed explicitly). |
| `--init-check` | off | $0 preflight: runs `claude` against a dead API endpoint and checks each arm's init event (project skills in both arms, code-graph only in the graph arm). |
| `--only` | all | Substring filter on case id. |
| `--group` | all | Substring filter on the case's `group` field (the maestro cases have `maestro@3814a30`, so `--group maestro` skips the fixture case). Combined with `--only`, a case must match both; no match exits 2. `--init-check` uses the first selected case that has `skills`. |
| `--keep-ws` | off | Keep the fresh workspaces under `$TMPDIR`. |

Cases live in `bench/cases.json`: `question`, `setup` (shell command run in the fresh workspace;
`{REPO}` is the repo root) and `must` (regexes the final answer is checked against, no LLM judge).
Both arms get the same prompt, a fresh workspace from the same setup, and the same model. Only the
graph arm gets `--plugin-dir plugin`. The first case reuses `plugin/evals/scaffold-lib.sh` through the
`02-impact-movetask` scaffold.

Cases may also carry `skills` (project skill names the init event must list in both arms) and, for
the maestro cases, `expected`, `why_grep_expensive` and `proxy` notes. `setup` also gets `{ARM}` and
`{MAESTRO}` (`$MAESTRO_DIR`, default `~/gits/maestro`, only ever read through `git archive`).
`bench/maestro-setup.sh` builds the maestro workspace from a pinned sha: graph arm = `apply` of each
concept from the committed `.ast.json` (no extract, no ts-morph); no-graph arm = same tree with no
`scribe-output/` directory at all. Both arms keep maestro's own `.claude/skills` and both lose
`.claude/settings.json` (it enables `code-graph@code-graph` and maestro's hooks).

**Selection bias.** The maestro questions were kept because an offline proxy showed the graph covers
the answer; questions it missed were dropped. Results therefore favour the graph and overstate its
advantage on questions in general. The report repeats this note.

## Flags

All claude flag names are in the `FLAGS` object in `bench/lib.mjs`. Per run:
`-p <question> --model --output-format stream-json --verbose --max-budget-usd --no-session-persistence
--allowedTools Bash,Read,Grep,Glob,Skill --permission-mode dontAsk --setting-sources project,local
--strict-mcp-config` (+ `--plugin-dir <repo>/plugin` in the graph arm). It uses your normal login.
`--setting-sources local` alone loaded no project skills, so the runner uses `project,local`: that
loads the workspace's `.claude/skills` and skips your user settings (installed plugins). Project
settings would still apply, which is why `maestro-setup.sh` deletes `.claude/settings.json`. Check
the names against `claude -p --help`. The init-event check proves on each run that code-graph is in
the graph arm only and the concept skills are in both. `--init-check` streams progress and stops
as soon as the init event arrives.

## Validity checks

A run is marked INVALID, listed first in the report and not counted, when:

- any Bash result contains `apply-seccomp`;
- any Bash call fails other than a code-graph call exiting 0, 4, 6 or 7;
- the init event shows code-graph (plugins, skills, slash commands, agents) in the no-graph arm, or
  does not show it in the graph arm;
- the result event is an error or missing.

If seccomp is seen the runner aborts so nothing more is spent. Metrics per run: cost, turns,
input/output/cache tokens, Read/Grep/Glob/Bash/Skill counts, and each code-graph call's exit code and
output size (`exit:chars`).

## Output

`bench/results/<timestamp>/` (gitignored): `<case>/<arm>-run<N>.jsonl` transcripts, stderr files, and
`report.md` (also printed). The run ends with `check: PASS|FAIL`: PASS needs both arms run, every run
valid, and a graph-arm code-graph call that exited 0 with output.
