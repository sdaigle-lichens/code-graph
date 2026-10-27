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
| `06-neg-no-config` | Reordering question, no `scribe.config.json` | Correct answer from source, never claims to have used the graph, never runs `init`/`extract`/`apply`. |
| `07-neg-literal` | Find every place the string TODO appears. | Exactly the three real TODOs; grep, not the graph. |
| `08-skill-has-answer` | Which function decides a task is overdue, and in which file? (ticket 037) | A concept skill quoted in the prompt already names `isOverdue` in `src/reminders/overdue.ts`; correct answer, and the retrieval skill should NOT load. |

`08-skill-has-answer` ships its concept skill by quoting it in `prompt.md` ("already loaded in this session"), because eval workspaces do not load project `.claude/skills`. That is the simplest route that needs no extra plugin and no change to the shared fixture. Its `skill-fired` grader is display-only like the others, but here the expected value is 0 Skill calls; read it from the trace, not as a pass/fail.

Scored: the `llm` outcome graders on the final answer, plus a few regex graders. The `tool_used` graders (skill fired, command chosen, CLI used) are display-only indicators (the runner never scores a `Skill` check; the others are `arm: with-only`). The one exception is `06-neg-no-config`'s `did-not-build-graph`, which is scored in both arms.

`06-neg-no-config`'s `says-no-graph` grader used to be an LLM grader demanding that the answer mention the missing graph. A correct run never does, so every judge vote failed. It is now a regex `not_contains` check that the answer does not claim to have used the graph. It is weaker, and negated phrasing ("did not rely on the code graph") can still false-fail.

## Refreshing the fixture

After any change to the fixture source:

1. Re-run `extract` for each concept with the fixture dir as config root (needs ts-morph; use the repo's deps).
2. Re-run `enrich merge` so entries are not stale.

Never hand-write `.ast.json` or `.enriched.json`. A `pnpm format` pass is a no-op here (`plugin/` is prettier-ignored). Vertex keys include file paths, so moving fixture files orphans their enrichment.

## Pilot baseline

Three user-run pilots, 1 run per arm, about $1.9 and 6 minutes each. In the latest (enriched fixture): 7/7 cases pass, mean delta +0.21. But the with-plugin runs made 0 Skill and 0 Bash calls in all five positive cases and in `07-neg-literal`; the skill fired only in `06-neg-no-config`. The delta comes from two single-run misses in the without-plugin arm and is likely noise, not plugin benefit.

An earlier note said "every search exits 7". That was checked by running the CLI directly in a scaffolded workspace, not observed inside an agent run: the reorder question exits 0 after enrichment; the overdue, interaction and PDF questions exit 7; `query cross` exits 0 but finds no cross-concept edges; `query impact moveTask` lists only callees.

## Pilot after 0.3.26

User-run, 2 runs per arm, 7 cases, $4.09, 755s. All cases score 1.00 in both arms (mean delta 0.00), so the cases do not separate the arms on answer quality; this pilot shows the skill fires, not that it helps. With-plugin runs cost about $0.15-0.20 against $0.11-0.15 without.

| Case | Skill calls (2 runs) | Bash calls (2 runs) |
|---|---|---|
| smoke | 2/2 | 1 each |
| impact-movetask | 2/2 | 1 each |
| cross-store-reminders | 2/2 | 0 (`chose-cross` fails) |
| locate-overdue | 2/2 | 1 each |
| not-in-graph | not graded | 1 each, then Grep |
| neg-no-config | 0 | 0 |
| neg-literal | 0 | 0 (Grep used) |

Baseline was 0 Skill and 0 Bash in every positive case. The without-plugin arm has no Skill or Bash grading. Both negatives still pass without the skill firing. Bash worked in 8 runs, so the seccomp failures did not block the CLI path here.

Open: cross-store-reminders fires the skill but never runs the CLI (likely the cross-concept gap, ticket 034).

## Pilot after 0.3.27 (ticket 034)

0.3.27 records cross-concept calls at extract time. On the fixture, `impact moveTask --direction in` now lists `notifyOverdue` and `useDragReorder`, and `query cross` exits 0 for task-store/board-ui and task-store/reminders.

Two user-run pilots, same suite and flags, 7 cases. Per-case figures are the mean over runs; turns and `costUsd` come from `aggregate-result.json`.

| Case | Pass (with / without) | Skill and Bash, with plugin | Turns with / without | Cost per run with / without |
|---|---|---|---|---|
| smoke | 1.00 / 1.00 | 1 / 1 | 10.3 / 8.7 | $0.209 / $0.151 |
| impact-movetask | 1.00 / 1.00 | 1 / 1 | 8.3 / 7.0 | $0.178 / $0.142 |
| cross-store-reminders | 1.00 / 1.00 | 1 / 0 (`chose-cross` fails) | 10.7 / 9.7 | $0.192 / $0.157 |
| locate-overdue | 1.00 / 1.00 | 1 / 1 | 6.0 / 3.0 | $0.158 / $0.107 |
| not-in-graph | 1.00 / 1.00 | not graded / 1, then Grep | 8.3 / 7.3 | $0.166 / $0.118 |
| neg-no-config | 1.00 / 1.00 | 0 / 0 | 9.0 / 8.7 | $0.163 / $0.144 |
| neg-literal | 1.00 / 1.00 | 0 / 0 (Grep used) | 2.0 / 3.3 | $0.086 / $0.094 |

Enriched fixture, 3 runs per arm: $6.19, 1137s, mean delta 0.00. Compared with earlier pilots:

| Pilot | Runs per arm | Delta | Skill and Bash in positive cases | Total cost |
|---|---|---|---|---|
| 032 baseline (0.3.25) | 1 | +0.21 (noise) | 0 / 0 | about $1.9 each |
| 0.3.26 (033) | 2 | 0.00 | Skill 2/2; Bash 1 each, 0 in cross-store-reminders | $4.09 |
| 0.3.27 (034, enriched) | 3 | 0.00 | Skill 3/3; Bash 1 each, 0 in cross-store-reminders | $6.19 |

The 032 with-plugin arm never used the skill or the CLI in a positive case, so it measured plain Grep and Read. 0.3.26 and 0.3.27 are the first runs that exercise the graph.

Un-enriched fixture (`<concept>.enriched.json` left out of the workspace by a temporary scaffold switch, since removed), 2 runs per arm: $4.05, 861s, mean delta 0.00. Pass rate, Skill use and Bash use are identical to the enriched run in every case, and turns and cost per run are within noise (at most $0.014 apart per case).

What the pilots do and do not show:

- **Cost:** with the plugin, runs cost about 27% more overall (about $3.48 against $2.73 for the 3-run pilot) and about 35% more in the positive cases. Answers score the same in both arms, so on this fixture the plugin costs more and gains nothing measurable. The overhead is the Skill load, the SessionStart context line (`neg-no-config` costs more with the plugin although the skill never fires) and the Bash round trip.
- **Fixture size:** the fixture has three concepts and a handful of files, so Grep finds everything in one or two calls. These pilots cannot show whether the graph saves cost on a repo where Grep is expensive.
- **Cross-store-reminders:** the skill fires but the CLI is never run, in both pilots, even though `cross` now returns results. The graph fix did not change the agent's behaviour there.
- **Enrichment:** no measurable effect on this suite. Whether the scaffold switch took effect is not confirmed (its output line is not shown by `claude plugin eval`); identical results are consistent with it working but would look the same if it had not.
- **Search exit codes (0/6/7):** not captured. The traces live in temporary `/tmp/claude-eval-*` directories that are deleted after the run, and `aggregate-result.json` keeps only turns, cost and grader results. A rerun needs `--keep-temp`, and the CLI exit codes should be read from the saved traces.

## Ticket 037: skip the retrieval skill when a concept skill has the answer

0.3.28 narrows the trigger: the skill description, its "When NOT to use" section and the SessionStart line now say to skip the skill when a loaded concept skill already names the file or symbol, and to keep it for impact, cross and unknown-location questions.

Fixed per-session cost of the plugin, counted offline as chars/4 (rounded up), not from a paid run:

| Item | Before (0.3.27) | After (0.3.28) |
|---|---|---|
| Skill description (always in context) | 517 chars, 130 tokens | 507 chars, 127 tokens |
| SKILL.md body, loaded when the skill fires | 9686 chars, 2422 tokens | 9938 chars, 2485 tokens |
| Full SKILL.md file | 10277 chars, 2570 tokens | 10519 chars, 2630 tokens |
| SessionStart line | 203 chars, 51 tokens | 257 chars, 65 tokens |

The qualifier costs about 14 tokens in the hook line and about 63 in the body; the description got slightly shorter. Follow-up proposal (out of scope here): the body is about 2.5k tokens, of which the gap-reporting and enrichment sections are roughly half; moving them into a second file read only on exit 6/7 would cut the load by about 1k tokens.

### Pilot (user-run, to fill in)

Command: the "Running" command with `--runs 2 --max-cost-usd 5 --keep-temp`.

Before reading any number, grep one kept trace for `apply-seccomp`. If Bash failed, the CLI columns are invalid and no conclusion may be drawn from them; Skill-loading results stay valid either way.

Run on 0.3.28, 8 cases, 2 runs per arm: $4.47, 824s, mean delta -0.09. Results in `plugin/evals/results/2026-10-27T14-02-39-590Z/`.

- **Bash worked (seccomp check): no.** The kept traces of smoke, locate-overdue and not-in-graph all contain `apply-seccomp`, and several answers say the CLI was blocked. Running `claude plugin eval` from a plain terminal does not avoid it: the harness nests the sandbox itself. The CLI and cost columns are invalid, and the earlier pilots (0.3.26, 0.3.27) were never checked for this, so their Bash columns are suspect too. Ticket 038 (`claude -p`) exists for this.
- **Skill calls per case: as expected.** `08-skill-has-answer` loaded the skill 0/2 times. Smoke, impact-movetask, cross-store-reminders and locate-overdue still loaded it 2/2, so dropping "first" did not lose them. neg-literal 0/2. neg-no-config 1/2 (no `scribe.config.json` there; the skill exits early).
- **Cost per run, with / without** (Skill load valid; Bash part invalid):

| Case | With | Without | Turns with / without |
|---|---|---|---|
| smoke | $0.220 | $0.138 | 11 / 8 |
| impact-movetask | $0.178 | $0.136 | 8 / 6 |
| cross-store-reminders | $0.191 | $0.168 | 10.5 / 10.5 |
| locate-overdue | $0.162 | $0.107 | 6 / 3 |
| not-in-graph | $0.167 | $0.123 | 9 / 7 |
| neg-no-config | $0.172 | $0.146 | 9.5 / 8.5 |
| neg-literal | $0.084 | $0.088 | 2 / 2.5 |
| skill-has-answer | $0.081 | $0.077 | 1 / 1 |

- **The 037 target is met:** with a concept skill that has the answer, the plugin now costs about 4% more ($0.081 against $0.077), down from +34–51% in 035's offline estimate. Overall the plugin arm still costs about 28% more ($1.26 against $0.98 per pass over the 8 cases), the same overhead as 0.3.27.
- **The two failures are not caused by the plugin:**
  - impact-movetask with-plugin run 2 named both real callers. The judge failed it, probably for the extra "docs and generated files" list (`scribe-output/*` names).
  - neg-literal with-plugin run 1 reworded two TODO texts, and the grader treats that as invented text. That run loaded no skill and ran no CLI.
  - n=2 noise, but both graders are stricter than the cases need.
  - Ticket 040 loosened both `graders/answer.md` files (eval files only, no version bump): impact-movetask now allows extra real stale-doc or generated-file mentions and fails only on a missing caller or one that does not exist; neg-literal accepts paraphrased TODO text at the three right locations and fails only on a missing location or a nonexistent or different TODO. Not re-run with a paid eval; checked by reading the kept answers.

## Known findings

Not fixed here; they are the inputs to tickets 033 and 034 and to the follow-up benchmark.

- The skill's description does not trigger on natural phrasing. 0.3.26 rewrites it to lead with the question shapes and the `scribe.config.json` signal, and adds a SessionStart hook (`plugin/hooks/graph-context.cjs`) that adds one context line naming the skill, only when `scribe.config.json` is in the cwd. Why it did not fire (from the pilot traces): the first tool call of every with-plugin run was a Grep on a symbol from the question, or `git ls-files`; no run consulted the skill list. Runs that saw `scribe.config.json` in the listing read `skills/<concept>/SKILL.md` directly instead of invoking the skill. Separately, some Bash calls in the eval session failed with `apply-seccomp: write /proc/self/setgroups (nested userns is capability-restricted...)`, so the CLI path may be flaky there regardless of the description.
- Fixed in 0.3.27: the graph recorded edges only within a concept, so `impact` and `cross` could not see cross-concept callers.
- Open: the suite grades only the final answer. It does not measure turns, tokens or file reads per case, and its fixture is too small for Grep to be expensive, so it cannot show whether code-graph saves cost.

## Maestro benchmark findings (ticket 035, set aside)

Ticket 035 tried to measure whether the graph saves cost on maestro (a bigger repo, pinned at `b323aa7`, 16 concepts, nothing enriched), with concept skills alone against concept skills plus the graph. The harness was dropped; what it learned:

- **Offline proxy (graph output vs a scripted Grep, 8 questions):** Grep reached the full answer on all 8, the graph output alone on none. `search` exited 7 almost everywhere because no concept was enriched. The graph was cheaper only on one impact question (205 vs 2887 tokens), and covered a quarter of that answer. On an un-enriched repo, the graph is not yet a substitute for Grep.
- **Paid run (Opus 5.5, 2 runs, 5 questions, $4.96): no graph-vs-Grep result.** Every Bash call in the run failed with `apply-seccomp: write /proc/self/setgroups ... Permission denied`, in both arms, so no code-graph call ever returned output. Bash worked in the 0.3.26 pilot, so whether it works depends on the host and how the eval is started. Before trusting any paid run that uses `--allow-tools Bash`, check one kept trace (`--keep-temp`) for `apply-seccomp`.
- **What the paid run did show:** the retrieval skill loads even when a loaded concept skill already names the files. On the two questions where that happened, the graph arm cost 34% and 51% more (about +60-70k input and cache tokens per run) for the same answer. Ticket 037 targets this.
- **Eval workspaces don't load project `.claude/skills`** (per the `claude plugin eval` docs): only plugins under test supply skills. A project's concept skills have to be shipped as a plugin to be part of an eval.
- **Main session only:** the eval drives a main session. In real maestro runs the work happens in subagents, which don't receive the SessionStart context line; no eval here covers that case.
