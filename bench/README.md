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
| `--run-budget` | 0.45 | Per run, passed as `--max-budget-usd`. |
| `--model` | sonnet | Same model for both arms. |
| `--only` | all | Substring filter on case id. |
| `--keep-ws` | off | Keep the fresh workspaces under `$TMPDIR`. |

Cases live in `bench/cases.json`: `question`, `setup` (shell command run in the fresh workspace;
`{REPO}` is the repo root) and `must` (regexes the final answer is checked against, no LLM judge).
Both arms get the same prompt, a fresh workspace from the same setup, and the same model. Only the
graph arm gets `--plugin-dir plugin`. The first case reuses `plugin/evals/scaffold-lib.sh` through the
`02-impact-movetask` scaffold.

## Flags

All claude flag names are in the `FLAGS` object in `bench/lib.mjs`. Per run:
`-p <question> --model --output-format stream-json --verbose --max-budget-usd --no-session-persistence
--allowedTools Bash,Read,Grep,Glob,Skill --permission-mode dontAsk --setting-sources local
--strict-mcp-config` (+ `--plugin-dir <repo>/plugin` in the graph arm). It uses your normal login.
`--setting-sources local` is what keeps your installed plugins out of the no-graph arm. Check the names
against `claude -p --help`: every flag above, and `dontAsk` as a `--permission-mode` choice, was
confirmed on the author's machine. Whether `--setting-sources local` really hides installed plugins is
not settled by `--help`; the init-event check is what proves it on each run.

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
