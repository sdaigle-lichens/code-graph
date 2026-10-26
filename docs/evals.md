# Plugin evals

`plugin/evals/` is a `claude plugin eval` suite for the `code-graph-retrieval` flow. It is a measurement harness, not a gate: the three pilot runs below are the "before" baseline. Tickets 033 (make the skill trigger) and 034 (record cross-concept edges) are meant to change the numbers, and a full run after them is the "after".

## Layout

Each case is a directory under `plugin/evals/`:

| File | Role |
| --- | --- |
| `prompt.md` | The user question, with front matter (`max_turns`, `timeout_seconds`, `allowed_tools`, `runs`). |
| `graders/*.md` | One grader per file: `llm` (outcome on the final answer), `regex`, or `tool_used` (display-only indicator). |
| `case.yaml` | Case name and `context.scaffold_script: scaffold.sh`. `prompt.md` has no setup hook, so setup goes through `case.yaml`. |
| `scaffold.sh` | Resolves the plugin root from its own path and calls `scaffold_workspace` from `plugin/evals/scaffold-lib.sh`. |

`fixture/` is a small task-board app (`src/store`, `src/board`, `src/reminders`) with three concepts (`task-store`, `board-ui`, `reminders`), their SKILL.md files, and a committed `scribe-output/` (`.ast.json` and `.enriched.json`).

### Scaffold

`scaffold-lib.sh` copies `fixture/` into the empty eval workspace, then runs only `apply` for each concept. It never runs `extract`: ts-morph is not available in the workspace. It needs Node >= 22.5 (`node:sqlite`, otherwise `apply` exits 8) and fails fast without it. The plugin root is derived from the script's own path because `CLAUDE_PLUGIN_ROOT` is empty in the setup environment (confirmed). The `nograph` mode (case 06) copies sources and `tsconfig.json` only.

The scaffold runs as the user, outside the sandbox, so it only runs with `--scaffold`.

## Running

```sh
claude plugin eval . --eval-dir plugin/evals --scaffold --allow-tools Bash \
  --judge-model sonnet --ablation with-without --no-publish --trust-plugin
```

| Flag | Why |
| --- | --- |
| `--eval-dir plugin/evals` | Where the cases are. |
| `--scaffold` | Runs each `scaffold_script`; without it the workspace stays empty. |
| `--allow-tools Bash` | Needed in both arms: neither `allowed_tools` nor the skill's `allowed-tools` widens beyond the read-only set. Requires bubblewrap and socat on Linux. |
| `--judge-model sonnet` | Model for the `llm` graders. |
| `--ablation with-without` | Runs each case with and without the plugin, giving a per-case delta. |
| `--no-publish` | Keeps results local (`plugin/evals/results/` is gitignored). |
| `--trust-plugin` | Lets the plugin's skill load in the eval session. |

For a pilot add `--runs 1 --max-cost-usd 5`. To debug add `--verbose --keep-temp`.

Run from the repo root, never from `plugin/`: a session started there creates `plugin/.claude/` and `pnpm check` fails. `claude` must be on `PATH`; it is not available inside the Claude Code sandbox, so the user runs it (`!` prefix).

## Cases

| Case | Question | Checks |
| --- | --- | --- |
| `01-smoke` | How does reordering tasks on the board work? | Answer names `useDragReorder` and `moveTask`; paths cited. |
| `02-impact-movetask` | What would break if I change the signature of `moveTask`? | Both real callers, including the cross-concept `notifyOverdue`. |
| `03-cross-store-reminders` | How do the task store and the reminders feature interact? | Both directions, store to reminders and back, with correct files. |
| `04-locate-overdue` | Where is the logic that decides a task is overdue? | `isOverdue` in `src/reminders/overdue.ts`. |
| `05-not-in-graph` | Where do we export the board to PDF? | Says plainly there is no PDF export; no invented location. |
| `06-neg-no-config` | Reordering question, no `scribe.config.json` | Correct answer from source, says no graph exists, never runs `init`/`extract`/`apply`. |
| `07-neg-literal` | Find every place the string TODO appears. | Exactly the three real TODOs; grep, not the graph. |

Scored: the `llm` outcome graders on the final answer, plus a few regex graders. The `tool_used` graders (skill fired, command chosen, CLI used) are display-only indicators (the runner never scores a `Skill` check; the others are `arm: with-only`). The one exception is `06-neg-no-config`'s `did-not-build-graph`, which is scored in both arms.

## Refreshing the fixture

After any change to the fixture source:

1. Re-run `extract` for each concept with the fixture dir as config root (needs ts-morph; use the repo's deps).
2. Re-run `enrich merge` so entries are not stale.

Never hand-write `.ast.json` or `.enriched.json`. A `pnpm format` pass is a no-op here (`plugin/` is prettier-ignored). Vertex keys include file paths, so moving fixture files orphans their enrichment.

## Pilot baseline

Three user-run pilots, 1 run per arm, about $1.9 and 6 minutes each. In the latest (enriched fixture): 7/7 cases pass, mean delta +0.21. But the with-plugin runs made 0 Skill and 0 Bash calls in all five positive cases and in `07-neg-literal`; the skill fired only in `06-neg-no-config`. The delta comes from two single-run misses in the without-plugin arm and is likely noise, not plugin benefit.

An earlier note said "every search exits 7". That was checked by running the CLI directly in a scaffolded workspace, not observed inside an agent run: the reorder question exits 0 after enrichment; the overdue, interaction and PDF questions exit 7; `query cross` exits 0 but finds no cross-concept edges; `query impact moveTask` lists only callees.

## Known findings

Not fixed here; they are the inputs to tickets 033 and 034.

- The skill's description does not trigger on natural phrasing.
- The graph records edges only within a concept, so `impact` and `cross` cannot see cross-concept callers.
