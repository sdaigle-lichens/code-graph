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
- **Paid run (Opus 5.5, 2 runs, 5 questions, $4.96): no graph-vs-Grep result.** Every Bash call in the run failed with `apply-seccomp: write /proc/self/setgroups ... Permission denied`, in both arms, so no code-graph call ever returned output. Superseded by the working-Bash `claude -p` run in "Ticket 039" below. Before trusting any paid `claude plugin eval` run that uses `--allow-tools Bash`, check one kept trace (`--keep-temp`) for `apply-seccomp`.
- **What the paid run did show:** the retrieval skill loads even when a loaded concept skill already names the files. On the two questions where that happened, the graph arm cost 34% and 51% more (about +60-70k input and cache tokens per run) for the same answer. Ticket 037 targets this.
- **Eval workspaces don't load project `.claude/skills`** (per the `claude plugin eval` docs): only plugins under test supply skills. A project's concept skills have to be shipped as a plugin to be part of an eval.
- **Follow-up:** `bench/` (ticket 038) runs graph vs no-graph on `claude -p` from a plain terminal, so Bash works and invalid runs are flagged; see [bench/README.md](../bench/README.md). Its first paid use is "Ticket 039" below.
- **Main session only:** the eval drives a main session. In real maestro runs the work happens in subagents, which don't receive the SessionStart context line; no eval here covers that case.

## Ticket 039: graph impact and cross questions on maestro (bench/, 2026-10-27)

Question: does code-graph save cost where it should be strongest, "what breaks if I change Y" (`query impact`) and "how do A and B interact" (`query cross`)? Setup: `bench/` runner (`claude -p`, working Bash), Opus 5.5, maestro pinned at `3814a30` (workspaces from `git archive`, `apply` from the committed 0.3.27 `.ast.json`, nothing extracted, nothing enriched). Both arms have maestro's own concept skills; the graph arm adds the code-graph plugin (checked in the init events). Results are in `bench/results/` (gitignored): `2026-10-27T16-28-06-917Z` and `2026-10-27T19-03-18-336Z`.

### Runs

- **First invocation** (`16-28-06-917Z`): 20 runs, $4.302. m1 to m3 have two valid runs per arm. m4 and m5 have one valid run per arm.
- **The four m4/m5 run-2 runs are invalid and not counted.** Cause: `api_error` `usage_limit_reached` (HTTP 429, an account usage limit), not a Bash failure. m4 nograph run 2 had got partway in ($0.221); the other three never started a turn.
- **Second invocation** (`19-03-18-336Z`, `--only -cross- --runs 1`): a separate invocation that reran only m4 and m5, 4 runs, all valid, $1.076. In the tables, m4 and m5 "run 2" is this rerun.
- Total spend $5.378 of the $6 cap. Every counted run passes the Bash validity check.
- Questions: m1 `readAllProjectTags` callers, m2 duplicate agent types, m3 `readAllAgentTypes` callers (impact); m4 install/config, m5 IPC/config (cross). They were kept because an offline proxy showed the graph covers the answer (selection bias, below).

### Per question and arm

Sums over n=2 valid runs. Cost in $; tokens are the input, output, cache-read and cache-create counts summed; tool counts are Read/Grep/Bash/Skill; `cg` = code-graph CLI calls (all exit 0) and their total output chars; pass = graded `must` regexes matched.

| Question | Arm | Cost | Turns | In / out tok | Cache read / create | Read/Grep/Bash/Skill | cg calls (chars) | Pass |
|---|---|---|---|---|---|---|---|---|
| m1 impact | nograph | 0.388 | 13 | 26 / 169 | 269,389 / 28,795 | 0/4/7/0 | - | 12/12 |
| m1 impact | graph | 0.440 | 13 | 24 / 138 | 272,021 / 36,331 | 0/3/6/1 | 1 (798) | 11/12 |
| m2 impact | nograph | 0.539 | 15 | 30 / 236 | 362,138 / 41,633 | 0/3/10/0 | - | 8/10 |
| m2 impact | graph | 0.596 | 20 | 34 / 185 | 435,577 / 49,005 | 0/5/9/2 | 6 (2,159) | 10/10 |
| m3 impact | nograph | 0.482 | 18 | 32 / 191 | 365,108 / 35,885 | 0/7/9/0 | - | 12/14 |
| m3 impact | graph | 0.469 | 15 | 26 / 145 | 311,626 / 40,348 | 0/4/5/2 | 3 (1,314) | 14/14 |
| m4 cross | nograph | 0.566 | 14 | 20 / 98 | 223,117 / 53,423 | 6/6/0/0 | - | 18/18 |
| m4 cross | graph | 0.475 | 10 | 16 / 68 | 187,166 / 45,031 | 0/0/4/2 | 0 | 18/18 |
| m5 cross | nograph | 0.605 | 16 | 24 / 131 | 286,733 / 56,873 | 5/9/0/0 | - | 16/18 |
| m5 cross | graph | 0.597 | 18 | 30 / 220 | 361,606 / 51,868 | 3/8/5/0 | 0 | 14/18 |

Per question, graph against nograph: m1 +13%, m2 +11%, m3 -3%, m4 -16%, m5 -1%. Impact questions (m1 to m3) +7% ($1.505 against $1.409); cross questions (m4, m5) -8% ($1.072 against $1.171); all five $2.577 against $2.580, flat. Turns total 76 against 76. Pass rate 67/72 (93%) graph, 66/72 (92%) nograph.

### Did the graph arm really not call the CLI?

Checked in the transcripts, not only the report.

- **m4 and m5 graph, all four valid runs (both invocations): the agent never invoked code-graph.** No tool_use input mentions `code-graph` or `code-graph.cjs`; the only transcript hits are the plugin name in the init event. `isCg` in `bench/lib.mjs` (the CLI binary or `node <path>code-graph[.cjs]` as a command word) did not miss a form; there was nothing to match.
- m4 graph's `Skill` call is the project concept skill `installing-maestro`, not `code-graph:code-graph-retrieval`; its `Bash` calls are `grep`/`awk`/`sed` over the source. m5 graph never called `Skill` and used Grep/Read/Bash `sed`.
- **m1 graph run 2 made no CLI call either:** it never loaded the retrieval skill and used Grep plus Bash `grep`/`sed`. In m1 graph, only run 1 used the CLI (1 call, 798 chars).
- Across the 10 graph runs, the retrieval skill fired in 5 (m1 run 1, m2 both, m3 both) and the CLI was used in those same 5. On cross questions it fired 0 of 4.
- So the m4 saving (-16%) is not a graph result. The graph arm loaded the concept skill and went straight to the files; the nograph arm had the same skill available, never loaded it, and spent 6 Reads and 6 Greps instead. It shows a concept skill saving cost, with the graph idle.

### Verdict

**On these questions the graph does not save cost.** Over all five it is flat ($2.577 against $2.580, 0%). Where the CLI was actually used (m1 to m3), the graph arm is 7% dearer overall: the Skill load and an extra round trip or two cost about what the CLI output (300 to 800 chars per call) saves. m3 is the only question where the CLI-using arm is slightly cheaper (-3%), which is inside run-to-run noise (single runs differ by 10 to 30% in the same arm). The only clear difference, m4 at -16%, comes from a concept skill, not from the graph. Accuracy is a wash: the graph arm scores 67/72 against 66/72, and its misses (m1 run 2, m5) came on runs with no CLI call.

Confidence is low. n=2 per arm, one model, five questions, no variance estimate; a 10% gap is not distinguishable from noise. The direction (no saving, at best a wash) is the supported claim; the exact percentages are not.

Caveats:

- **Selection bias favours the graph.** Questions were kept because the offline proxy showed the graph covers the answer. Even so the graph did not win, so a random question set would likely look no better.
- **Grep stayed cheap on m1 to m3.** A single Grep for the symbol found the callers in 2 to 4 calls, so there was little for the graph to save. These questions did not make Grep expensive.
- **Nothing is enriched,** so `search` was not exercised and graph vertices carry no `purpose`; this measures `impact`/`cross` on structure alone.
- **Retrieval is rarely chosen on cross questions:** the skill never fired on m4 and m5, so `cross` was not measured at all.
- Four runs were lost to a usage limit (429), and m4/m5 run 2 comes from a separate invocation; same model and pin, but not the same session.
- Main session only; real maestro work happens in subagents.

### Stage 2: for the user to decide

1. **Enrichment arm:** enrich only the concepts these questions touch and rerun m1 to m5. Tests whether `purpose` and edge reasons change the agent's choice or the answer cost; costs enrichment tokens plus another paid run.
2. **Haiku 5.5 arm:** rerun the same set on Haiku 5.5. Tests whether a cheaper model leans on the graph more or loses accuracy without it.
3. **Stop investing in the retrieval side:** these results, together with the fixture pilots, show no cost saving to date.

## Ticket 041: best-case saving if graph answers were free (bench/, 2026-10-27)

Question: before reworking how the graph is delivered (a Grep hook, native tools), how much cheaper does an answer get when the graph's output costs nothing to obtain? If even that ceiling isn't clearly cheaper than Grep, no delivery rework will pay off.

### Decision rule (fixed before the run)

For a question group (m1 to m3 impact, m4 and m5 cross, m6 and m7 deep), the oracle is **clearly cheaper** only if:

- `oracle` is at least 20% cheaper than `nograph` on the group total; **and**
- both runs of each question point the same way (oracle cheaper in each run).

Otherwise the ceiling is too low for that group to justify a delivery rework.

### Setup

- **Oracle arm** (`bench/`, see [bench/README.md](../bench/README.md)): same workspace as `nograph` (maestro's concept skills, no plugin, no `scribe-output/`). The prompt is the question followed by the stored output of the case's `proxy_cmd` (`bench/oracle/<case>.txt`, captured once with `bench/capture-oracle.mjs`), framed as context from a code index. The `graph` arm is unchanged from 039.
- **New deep questions** (maestro pinned at `3814a30`), each with an expected answer, `must` regexes, an offline proxy and a `why_grep_expensive` note:
  - **m6** `listSessionIds` callers two levels deep (13 `must`). Grep cost: six direct callers in four files, then seven second-level callers across six files; each hit needs a Read to name its enclosing function, and the name also hits tests, re-exports, compiled `.cjs` copies and concept skills. Proxy: `query impact listSessionIds --direction in`, 1307 chars, complete.
  - **m7** `decideSync` callers two levels deep (5 `must`). Grep cost: a common name, `grep -rw decideSync` returns 85 lines in 31 files and only 3 are TypeScript calls; `buildEntry` is a private helper whose caller needs another Grep and a Read. Proxy: `query impact decideSync --direction in`, 598 chars, complete.
- **Scope change (user decision):** the full 32-run plan (m1 to m7, about $7 to $8) did not fit the $7 cap. The user chose the deep questions only: m6 and m7, arms `nograph`, `oracle` and `graph`, 2 runs each, 12 runs in one invocation (`--only deep --arms nograph,oracle,graph --runs 2 --budget 5 --run-budget 0.75`). **m1 to m5 were not run.**
- Opus 5.5, user-run from a plain terminal. Results: `bench/results/2026-10-27T20-22-02-156Z` (gitignored).
- **Runs:** 12/12 valid, $2.467 spent of the $5 cap, no usage-limit failures, no Bash failures. The `--init-check` preflight passed: `nograph` and `oracle` listed 25 skills and plugins, none from code-graph; `graph` listed 37 including code-graph.
- **Selection bias:** m6 and m7 were kept because the offline proxy showed the graph output covers the answer, so these results favour the graph and the oracle.

### Per question and arm

Sums over n=2 valid runs. Cost in $; tool counts are Read/Grep/Bash/Skill (Glob was 0 everywhere); pass = graded `must` regexes matched.

| Question | Arm | Cost | Turns | In / out tok | Cache read / create | Read/Grep/Bash/Skill | Pass |
|---|---|---|---|---|---|---|---|
| m6 deep | nograph | 0.399 | 13 | 26 / 230 | 269,865 / 30,299 | 0/3/8/0 | 26/26 |
| m6 deep | oracle | 0.475 | 13 | 20 / 75 | 256,002 / 42,296 | 2/8/1/0 | 26/26 |
| m6 deep | graph | 0.397 | 11 | 22 / 203 | 237,537 / 32,521 | 0/3/6/0 | 24/26 |
| m7 deep | nograph | 0.437 | 15 | 30 / 206 | 328,740 / 35,747 | 1/6/6/0 | 10/10 |
| m7 deep | oracle | 0.386 | 8 | 14 / 47 | 155,403 / 38,727 | 1/5/0/0 | 10/10 |
| m7 deep | graph | 0.373 | 12 | 24 / 227 | 266,076 / 31,215 | 0/4/6/0 | 10/10 |
| **deep total** | nograph | **0.836** | 28 | 56 / 436 | 598,605 / 66,046 | 1/9/14/0 | 36/36 |
| **deep total** | oracle | **0.861** | 21 | 34 / 122 | 411,405 / 81,023 | 3/13/1/0 | 36/36 |
| **deep total** | graph | **0.770** | 23 | 46 / 430 | 503,613 / 63,736 | 0/7/12/0 | 34/36 |

Single runs, cost in $ (nograph / oracle / graph): m6 run 1 0.201 / 0.217 / 0.188, run 2 0.198 / 0.258 / 0.209; m7 run 1 0.195 / 0.205 / 0.211, run 2 0.242 / 0.181 / 0.162.

### Oracle vs nograph (the ceiling)

- **Group total: oracle $0.861 against nograph $0.836, +3% (dearer).**
- m6: +19% ($0.475 against $0.399). Oracle is dearer in **both** runs (0.217 vs 0.201, 0.258 vs 0.198).
- m7: -12% ($0.386 against $0.437). The runs **disagree**: run 1 oracle is dearer (0.205 vs 0.195), run 2 cheaper (0.181 vs 0.242).
- Accuracy is equal: 36/36 both.

### Graph vs oracle (meant as the friction cost)

- Group total: graph $0.770 against oracle $0.861, -11%; m6 -16%, m7 -3%. Graph against nograph: -8%.
- **The graph arm made no code-graph CLI call in any of its 4 runs** (`graphCalls` empty in `runs.json`, the report's code-graph column is `-`, real code-graph call exit 0: false) and no `Skill` call: the retrieval skill never loaded. It answered with Grep and Bash `grep`/`sed`, like `nograph`.
- So graph vs oracle here compares a graph arm that didn't use the graph with the oracle; it does not measure friction. The graph arm's -8% against nograph is the same arm doing the same Grep work, within run-to-run noise.
- Graph scored 24/26 on m6: run 1 missed `registerIpc` (named the `sessionsDeletable` handler without its function), run 2 missed `createWorktreeTabs`.

### Observations

- **The oracle still grepped.** It ran 13 Greps (plus 3 Reads, 1 Bash) over its 4 runs to check the index output rather than trust it, against 9 Greps and 14 Bash calls for nograph.
- **Bigger prompt, more cache-create tokens.** Oracle cache-create was 81,023 against 66,046 for nograph: the index text is in the prompt from turn one.
- **Fewer turns, similar cost.** Oracle took 21 turns against 28 and wrote far less output (122 against 436 tokens), but the saving in turns and cache reads (411k against 599k) was eaten by the extra cache-create and verification calls.

### Verdict

**Deep group: the ceiling is too low to justify a delivery rework.** Applying the rule literally: oracle is +3% against nograph on the group total, not at least 20% cheaper, and m7's two runs point opposite ways. Even with the graph's answer handed over for free, the model spent about what Grep costs.

Confidence is low to moderate. n=2 per arm, one model, two questions; single runs vary 10 to 30% within an arm, so the per-question percentages are noise-sized. The supported claim is the direction: no clear saving at the ceiling, on the questions picked to favour the graph (selection bias).

**m1 to m3 (impact) and m4 and m5 (cross) were not measured, so there is no verdict for those groups.**

## Ticket 042: do concept skills save cost on their own (bench/, 2026-10-27)

Question: every earlier paid run had concept skills in both arms. With no graph in either arm, do maestro's concept skills make answers cheaper or better than the same workspace without them?

### Setup

- **Arms** (`bench/`, see [bench/README.md](../bench/README.md), "Skills and noskills arms"): `skills` is the `nograph` workspace (maestro's concept skills, no plugin, no `scribe-output/`). `noskills` is the same workspace after `bench/strip-concept-skills.mjs` removed every skill with `metadata.type: concept-skill`, at any depth. Other skills (`maestro`, `test-maestro`) stay in both arms.
- **Questions** (maestro pinned at `3814a30`, approved by the user): m2 (`duplicateAgentTypes` callers, impact) and m4 (install/config, cross) from 039, and three new `concept` questions, each with an expected answer, `must` regexes and a `skill_note` naming the covering skill:
  - **s1** session state on disk and session-id resolution (7 `must`). Covering skill: `maestro-architecture`.
  - **s2** what uninstall and purge remove and what survives, app and terminal (9 `must`). Covering skill: `installing-maestro`.
  - **s3** where the task-ready cascade lives and what to change so app and orchestrator agree (5 `must`). Covering skill: `task-queue`.
- Opus 5.5, 2 runs per arm, $7 cap, user-run from a plain terminal. Results (gitignored): `bench/results/2026-10-27T21-09-20-941Z` (first invocation) and `2026-10-28T00-10-53-507Z` (rerun; its report merges both).

### Runs

- **First invocation** (`21-09-20-941Z`): stopped on a usage limit (429) at s2 skills run 2 ($0.206 spent on that run, not counted). s2 noskills run 2 and both s3 run 2s never started.
- **Rerun** (`00-10-53-507Z`, `--rerun`): only those 4 runs, all valid. In the tables, s2 and s3 run 2 come from this rerun.
- Total spend $5.363 of the $7 cap.
- **One invalid run, m2 noskills run 1:** one `sed` in a Bash chain exited non-zero. It still scored 4/5. It is the only invalid run that is not a 429, so the stop rule (more than one invalid) did not fire. m2 therefore has 2 valid `skills` runs against 1 valid `noskills` run.
- Every counted run passed the in-run init-event checks: the concept skills listed in `skills` only, code-graph in neither arm, `maestro` kept in both. No `noskills` run called a concept skill.

### Per question and arm

Sums over valid runs (n=2 except m2 noskills, n=1). Cost in $; tool counts are Read/Grep/Glob/Bash/Skill; pass = graded `must` regexes matched; "skill loaded" = `skills` runs that called the covering skill through the Skill tool.

| Question | Arm | Runs | Cost | Turns | In / out tok | Cache read / create | Read/Grep/Glob/Bash/Skill | Pass | Skill loaded |
|---|---|---|---|---|---|---|---|---|---|
| m2 impact | skills | 2 | 0.500 | 14 | 28 / 143 | 324,766 / 38,618 | 0/2/0/10/0 | 8/10 | 0/2 |
| m2 impact | noskills | 1 | 0.241 | 8 | 16 / 110 | 179,900 / 18,093 | 0/1/0/6/0 | 4/5 | - |
| m4 cross | skills | 2 | 0.489 | 11 | 20 / 111 | 210,670 / 43,868 | 2/3/0/4/0 | 18/18 | 0/2 |
| m4 cross | noskills | 2 | 0.442 | 14 | 22 / 170 | 218,244 / 37,790 | 5/2/0/5/0 | 17/18 | - |
| s1 concept | skills | 2 | 0.470 | 7 | 12 / 57 | 103,230 / 49,666 | 3/2/0/0/0 | 14/14 | 0/2 |
| s1 concept | noskills | 2 | 0.471 | 11 | 16 / 95 | 146,421 / 47,860 | 4/3/2/0/0 | 14/14 | - |
| s2 concept | skills | 2 | 0.673 | 15 | 20 / 95 | 255,738 / 65,192 | 5/4/0/0/2 | 18/18 | 2/2 |
| s2 concept | noskills | 2 | 0.625 | 13 | 20 / 89 | 247,906 / 60,401 | 6/5/0/0/0 | 18/18 | - |
| s3 concept | skills | 2 | 0.525 | 18 | 20 / 69 | 220,373 / 49,658 | 3/9/0/0/2 | 10/10 | 2/2 |
| s3 concept | noskills | 2 | 0.454 | 19 | 24 / 95 | 251,610 / 36,949 | 5/11/0/1/0 | 9/10 | - |

Single runs, cost in $ (skills / noskills): m2 run 1 0.253 / (0.267 invalid), run 2 0.247 / 0.241; m4 run 1 0.254 / 0.253, run 2 0.236 / 0.189; s1 run 1 0.257 / 0.216, run 2 0.213 / 0.255; s2 run 1 0.359 / 0.308, run 2 0.314 / 0.317; s3 run 1 0.248 / 0.218, run 2 0.277 / 0.237.

- **m2, per run:** the report's +107% is a sum artefact (2 runs against 1). Per run, skills averages $0.250 against $0.241 for the one valid noskills run (+4%); the invalid noskills run cost $0.267. Every m2 run in both arms scored 4/5 and missed `registerIpc`.
- **m4, s1, s2, s3 (balanced, n=2):** skills $2.157 against noskills $1.992, +8%. m4 +11%, s1 0%, s2 +8%, s3 +16%.
- **Accuracy:** on the balanced four, skills 60/60 against noskills 58/60. The two misses are single `must` items on one run each: m4 noskills run 1 (`maestroConfigRefusal`) and s3 noskills run 1 (`status.json`).

### Skill never loaded: m2, m4, s1

The covering skill was not loaded in any of the 6 `skills` runs (no Skill call at all). These questions mostly measure the concept skills **sitting in the context** (their names and descriptions in the init skill list), not their content. On m4 and s1 that gives +5% together ($0.959 against $0.913), with fewer turns (18 against 25) and more cache-create tokens. The runs point both ways (s1 run 1 dearer, run 2 cheaper; m4 run 1 equal, run 2 dearer). s1's `maestro-architecture` description already names the session directory, files and resolution order, so the listing alone may carry part of that answer; nothing here separates that effect from noise.

### Skill loaded: s2 and s3

The covering skill was loaded in all 4 `skills` runs. This is the actual test of skill content.

- **s2: +8%** ($0.673 against $0.625), 18/18 both arms. The runs disagree (run 1 +17%, run 2 -1%). The skill saved about one Read and one Grep over two runs, and the model still read the source files after loading it.
- **s3: +16%** ($0.525 against $0.454), 10/10 against 9/10. **Both runs are dearer** (+14%, +17%). The skill saved 2 Reads, 2 Greps and 1 Bash over two runs, but the Skill calls and the loaded text added about 13k cache-create tokens (49,658 against 36,949), which cost more than the calls saved. The one noskills miss is `status.json`, not the generation fact the skill was chosen for (see confounds).

### Confounds

- **Selection bias favours the skills arm.** The new questions were chosen where a concept skill should help, and m4 was kept because of the 039 hint. Even so the skills arm was not cheaper, so a random question set would likely look no better.
- **Auto-loaded memory reaches both arms.** maestro's `CLAUDE.md` and `.claude/rules/*.md`, including `plugin-publishing.md`, are not skills and are not stripped. `plugin-publishing.md` says `maestro-tasks.cjs` is the exception to plugin-lib generation, so s3's key fact is in the `noskills` context too.
- **The m2 invalid run** leaves m2 unbalanced (2 against 1); compare it per run, not by sums.
- **The s3 generation grader is still loose on keywords.** After the fix in this ticket it accepts many phrasings (pinned by a paraphrase test in `bench/lib.test.mjs`), including an "except ... generated" pattern within 80 characters. Every s3 run in both arms passed it, so it does not separate the arms, and a vaguely worded answer could pass it.
- **Nested skills** (e.g. `maestro-config-model` in `apps/maestro/.claude/skills`, a covering skill for m2) are not in the init list; the strip removes them on disk, but in the `skills` arm they are only reachable if the model finds them.
- 4 runs came from a separate invocation after a 429; same model and pin, not the same session. Main session only.

### Verdict

**On these questions, concept skills do not save cost, and they barely change answers.** Over the four balanced questions the skills arm is 8% dearer ($2.157 against $1.992) for 60/60 against 58/60. Where the covering skill was actually loaded (s2, s3), it is 11% dearer ($1.198 against $1.079): loading a skill saves a Read or a Grep or two, but the model still reads the source to confirm, and the skill text costs more in cache-create tokens than the saved calls. Where the skill was never loaded (m2, m4, s1), the arms are within noise of each other.

The answer gain is two `must` items out of 60, one per arm-run, neither on the fact the skill was chosen for. That is not distinguishable from run-to-run variance.

Confidence is low. n=2 per arm (n=1 for m2 noskills), one model, five questions; single runs vary up to about 30% within an arm (m4 noskills $0.253 against $0.189). Only s3 points the same way in both runs (+14%, +17%). The supported claim is the direction: **no cost saving from concept skills on Opus 5.5 in a main session**, even on questions picked to favour them. This does not contradict the 039 m4 hint (-16%), which compared an arm that loaded the skill against one that had it and didn't. It does mean that hint did not reproduce as a skills-vs-noskills effect. Not measured here: subagents, cheaper models, and whether skills prevent wrong edits rather than save tokens on questions.

## Ticket 043: can graph context let Haiku match Opus (bench/, rule written before the paid run)

Question: tickets 039, 041 and 042 found that on Opus 5.5 neither the graph nor concept skills cut cost on maestro questions (Opus scores near full marks with Grep alone; even the pasted graph answer cost 3% more). Does graph context let a cheaper Haiku 5.5 reach Opus-level answers? If it does, the gain shows as accuracy and the saving is the price gap between the models.

### Bash rule change

Before this ticket any non-zero Bash exit invalidated a run (042 lost m2 noskills run 1 to a `sed` that exited 1 inside a chain). Now a non-zero exit from a read-only `grep`, `sed`, `rg`, `cat`, `head`, `tail`, `ls` or `find`, alone or chained only with each other, is recorded (`readOnlyFailures`) and does not invalidate. Seccomp, a code-graph exit outside 0/4/6/7, and any other failing command still invalidate. See [bench/README.md](../bench/README.md), "Validity checks".

### Decision rule (fixed before any result)

- **Graph context helps Haiku** if `oracle` scores clearly above `nograph` on pass rate: at least 3 more `must` hits over the whole set (m1-m7, both runs), with no question going the other way in both runs.
- **It matters** only if Haiku `oracle` comes within 10% of Opus's pass rate at less than half of Opus's cost per question.
- If `oracle` does not beat `nograph`, no starting context will: say so, and say there is no reason to build a primer.
- The `graph` arm is reported separately: does Haiku pick the retrieval skill and call the CLI on its own? It does not enter the rule.
- If the verdict is positive, the user decides on the follow-up (a realistic primer built from the task text at subagent start, measured the same way). Not part of this ticket.

### Run plan

- Model `claude-haiku-5-5`; arms `nograph` (maestro's concept skills plus Grep, the baseline), `oracle` (stored graph output pasted after the question, the best possible starting context) and `graph` (the code-graph plugin).
- Questions m1-m7 (maestro pinned at `3814a30`), unchanged, with their `must` regexes and stored oracle output; selected with `--set 043`. s1-s3 are out (no oracle output). No new questions or graders.
- 3 arms x 7 questions x 2 runs = 42 runs, total cap $4 (`--budget 4`, $0.75 per run). User-run from a plain terminal; `--init-check` first.
- Commands, from a plain terminal at the repo root. Preflight ($0, stops at the init event):

  ```
  node bench/run.mjs --set 043 --arms nograph,oracle,graph --runs 2 --budget 4 --run-budget 0.75 --model claude-haiku-5-5 --init-check
  ```

  Paid run (same command without `--init-check`):

  ```
  node bench/run.mjs --set 043 --arms nograph,oracle,graph --runs 2 --budget 4 --run-budget 0.75 --model claude-haiku-5-5
  ```

- Usage-limit (429) runs are not counted; rerun them once the limit resets with `node bench/run.mjs --rerun bench/results/<timestamp>` (same model, cap and plan as that invocation).
- If more than two runs are invalid for any other reason, stop and report.
- Opus reference: pass rate and cost per question from the 039 and 041 runs in `bench/results/`. m1-m5 have no Opus oracle run, so only its `nograph` and `graph` arms are used there. It is a reference from separate invocations, not a paired comparison.
- Report per question and arm: cost, turns, tokens, tool counts, pass rate; whether the graph arm loaded the retrieval skill and called the CLI; the Opus reference beside it; a plain verdict against the rule, with confidence at n=2.

### Results

Haiku 5.5, user-run, `bench/results/2026-10-28T14-34-17-686Z` (gitignored). **42/42 runs valid, $0.335 spent of the $4 cap, no 429s, `--init-check` PASS.** Selection bias applies as before: m1-m7 were kept because an offline proxy showed the graph covers the answer.

#### Per question and arm (Haiku 5.5)

Sums over n=2 valid runs. Cost in $; tool counts are Read/Grep/Glob/Bash/Skill; pass = graded `must` regexes matched.

| Question | Arm | Cost | Turns | In / out tok | Cache read / create | Read/Grep/Glob/Bash/Skill | Pass |
|---|---|---|---|---|---|---|---|
| m1 impact | nograph | 0.021 | 22 | 36 / 135 | 447,042 / 50,984 | 0/15/0/5/0 | 11/12 |
| m1 impact | oracle | 0.013 | 11 | 14 / 40 | 161,785 / 42,392 | 5/4/0/0/0 | 12/12 |
| m1 impact | graph | 0.013 | 12 | 20 / 89 | 232,038 / 39,152 | 0/3/0/3/2 | 12/12 |
| m2 impact | nograph | 0.017 | 13 | 20 / 89 | 242,266 / 51,684 | 1/4/2/4/0 | 6/10 |
| m2 impact | oracle | 0.013 | 7 | 10 / 26 | 105,135 / 41,780 | 1/4/0/0/0 | 10/10 |
| m2 impact | graph | 0.016 | 16 | 28 / 113 | 347,195 / 41,675 | 0/5/0/5/2 | 10/10 |
| m3 impact | nograph | 0.016 | 12 | 22 / 81 | 257,673 / 44,219 | 0/4/0/6/0 | 8/14 |
| m3 impact | oracle | 0.012 | 5 | 10 / 26 | 94,950 / 39,756 | 0/3/0/0/0 | 14/14 |
| m3 impact | graph | 0.012 | 10 | 16 / 57 | 174,038 / 37,659 | 0/2/0/2/2 | 14/14 |
| m4 cross | nograph | 0.020 | 21 | 22 / 74 | 281,919 / 68,258 | 4/8/3/4/0 | 18/18 |
| m4 cross | oracle | 0.012 | 8 | 12 / 26 | 113,628 / 41,905 | 2/4/0/0/0 | 18/18 |
| m4 cross | graph | 0.022 | 17 | 20 / 70 | 269,215 / 77,683 | 4/3/0/2/3 | 18/18 |
| m5 cross | nograph | 0.019 | 19 | 28 / 115 | 358,245 / 58,655 | 2/6/1/8/0 | 16/18 |
| m5 cross | oracle | 0.016 | 11 | 16 / 57 | 186,931 / 57,374 | 5/3/0/1/0 | 18/18 |
| m5 cross | graph | 0.025 | 23 | 24 / 77 | 341,147 / 82,097 | 10/5/0/2/2 | 17/18 |
| m6 deep | nograph | 0.020 | 20 | 20 / 98 | 233,098 / 57,853 | 9/8/0/1/0 | 22/26 |
| m6 deep | oracle | 0.013 | 6 | 10 / 24 | 103,831 / 43,458 | 0/4/0/0/0 | 26/26 |
| m6 deep | graph | 0.013 | 12 | 20 / 83 | 232,348 / 38,249 | 0/4/0/2/2 | 26/26 |
| m7 deep | nograph | 0.016 | 18 | 32 / 140 | 377,881 / 37,421 | 0/7/0/9/0 | 10/10 |
| m7 deep | oracle | 0.013 | 8 | 14 / 35 | 162,091 / 42,487 | 0/4/0/2/0 | 10/10 |
| m7 deep | graph | 0.013 | 13 | 18 / 62 | 204,457 / 45,999 | 1/4/0/2/2 | 10/10 |
| **all** | nograph | **0.129** | 125 | - | - | - | **91/108** (84%) |
| **all** | oracle | **0.092** | 56 | - | - | - | **108/108** (100%) |
| **all** | graph | **0.114** | 103 | - | - | - | **107/108** (99%) |

Cost per run (14 runs per arm): nograph $0.0092, oracle $0.0066, graph $0.0081. Oracle is 29% cheaper than nograph and graph 12% cheaper. Per-question costs are rounded to $0.001, so single-question percentages are coarse.

Per group, oracle against nograph (cost): impact -31%, cross -27%, deep -27%. Graph against oracle: impact +9%, cross +62%, deep +2%.

#### Did the graph arm load the retrieval skill and call the CLI?

Checked per run in `report.md`. **Yes, in all 14 graph runs.** Every run made exactly one `Skill` call that loaded `code-graph:code-graph-retrieval`, except m4 run 1, which also loaded the project skill `installing-maestro` (2 Skill calls). Every run then called `code-graph`, all with exit 0. m1, m3, m4, m5, m6, m7 made one call each; m2 made 3 calls in run 1 and 2 in run 2.

Output size differs by group: impact and deep calls returned 266 to 1,313 chars, the cross calls (m4, m5) 9,920 to 15,390 chars. That is the cost story for cross (+62% over oracle; cache-create 159,780 against 99,279 for the group). On Opus (039) the retrieval skill fired in 5 of 10 graph runs and never on cross; Haiku used it every time, including on cross.

Graph arm accuracy: 107/108, one miss (m5 run 1, 8/9).

#### Opus reference (separate invocations, not a paired comparison)

From 039 (`2026-10-27T16-28-06-917Z`, plus the m4/m5 rerun `2026-10-27T19-03-18-336Z`) and 041 (`2026-10-27T20-22-02-156Z`), as tabulated in those sections. Opus has no oracle run for m1-m5, so its `nograph` and `graph` arms are shown; m6 and m7 have all three. Same questions, same maestro pin, different date, session and model. Sums over n=2.

| Question | Opus nograph cost / pass | Opus graph cost / pass | Opus oracle cost / pass | Haiku oracle cost / pass | Haiku oracle cost as % of Opus nograph |
|---|---|---|---|---|---|
| m1 | 0.388 / 12/12 | 0.440 / 11/12 | - | 0.013 / 12/12 | 3.4% |
| m2 | 0.539 / 8/10 | 0.596 / 10/10 | - | 0.013 / 10/10 | 2.4% |
| m3 | 0.482 / 12/14 | 0.469 / 14/14 | - | 0.012 / 14/14 | 2.5% |
| m4 | 0.566 / 18/18 | 0.475 / 18/18 | - | 0.012 / 18/18 | 2.1% |
| m5 | 0.605 / 16/18 | 0.597 / 14/18 | - | 0.016 / 18/18 | 2.6% |
| m6 | 0.399 / 26/26 | 0.397 / 24/26 | 0.475 / 26/26 | 0.013 / 26/26 | 3.3% |
| m7 | 0.437 / 10/10 | 0.373 / 10/10 | 0.386 / 10/10 | 0.013 / 10/10 | 3.0% |
| **all** | **3.416 / 102/108 (94%)** | **3.347 / 101/108 (94%)** | - | **0.092 / 108/108 (100%)** | **2.7%** |

For scale, Haiku `nograph` costs $0.129 against Opus `nograph` $3.416 (3.8%): nearly all of the cost gap is the model price, not the context.

#### Verdict

**Graph context helps Haiku: yes.** Oracle scores 108/108 against 91/108 for nograph, 17 more `must` hits (rule: at least 3). No question goes the other way: checked per run, oracle is at or above nograph in all 14 run pairs (above in 9, equal in 5). The gain by question: m1 +1, m2 +4, m3 +6, m5 +2, m6 +4; m4 and m7 were 100% in both arms. Oracle was also cheaper per run ($0.0066 against $0.0092, -29%) with less than half the turns (56 against 125), so on Haiku the pasted graph answer improves accuracy and cuts cost together.

**It matters: yes, by the rule as written.** Haiku oracle's pass rate (100%) is above Opus's (94% nograph, 94% graph), so it is within 10% on the overall set and on every question individually, and its cost is 2.1% to 3.4% of Opus nograph per question (2.7% overall), far under half. Two caveats on how to read that:

- **Not like for like.** Haiku oracle has the graph answer pasted in; Opus nograph (m1-m5) does not. Only m6 and m7 have an Opus oracle arm (26/26 and 10/10, the same as Haiku oracle), and there Haiku oracle is 2.7% to 3.4% of Opus oracle's cost.
- **Ceiling.** Opus nograph already scores 94% on these questions, so there was little accuracy to gain. The result shows Haiku with the answer in hand matching Opus, not Haiku overtaking Opus on hard questions. Haiku nograph (84%) is 10 points under Opus's 94%, just outside "within 10%" if read as points, at 3.8% of the cost.

**Graph arm (reported separately, not in the rule):** Haiku loaded the retrieval skill and ran the CLI on its own in 14 of 14 runs, scored 107/108, and cost 12% less than nograph but 24% more than oracle ($0.114 against $0.092). The friction is small on impact (+9%) and deep (+2%) and large on cross (+62%), where CLI output is 10k to 15k chars.

**Confidence: low to moderate.** n=2 per cell, one model pair, seven questions; single runs differ widely within an arm (for example m6 nograph 10/13 and 12/13, m3 nograph 5/7 and 3/7). The direction (oracle >= nograph, at about 30% lower cost) is consistent across five of seven questions and never reversed, which is why it is supported; the exact percentages are not. **Selection bias favours the graph and the oracle:** questions were kept only where the proxy showed the graph covers the answer, so this overstates the advantage on questions in general. The Opus numbers come from earlier invocations, so model, date and session differ. Main session only.

Follow-up (a realistic primer built from the task text at subagent start) is the user's decision and is not part of this ticket.
