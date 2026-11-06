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
| `--model` | claude-opus-5-5 | Model of every arm except the model arms, which pin their own (always passed explicitly). |
| `--init-check` | off | $0 preflight: runs `claude` against a dead API endpoint and checks each arm's init event (project skills in both arms, code-graph only in the graph arm). |
| `--only` | all | Substring filter on case id. |
| `--group` | all | Substring filter on the case's `group` field (the maestro cases have `maestro@3814a30`, so `--group maestro` skips the fixture case). Combined with `--only`, a case must match both; no match exits 2. `--init-check` uses the first selected case that has `skills`. |
| `--set` | all | Keep only the cases whose `sets` list contains this exact name (e.g. `--set 042`). Combines with `--only` and `--group`. |
| `--keep-ws` | off | Keep the fresh workspaces under `$TMPDIR`. |
| `--arms` | nograph,graph | Comma list from `nograph`, `oracle`, `graph`, `skills`, `noskills`, and the 044 model arms `haiku-nograph`, `haiku-graph`, `sonnet-nograph`, and the 051 arms `haiku-noskills`, `haiku-oracle`. Unknown names exit 2. `skills`/`noskills` exit 2 on a case with no `skills` list. |
| `--graph-cases` | all | Comma list of case-id substrings: the graph arm runs only on these cases (the other arms still run on every selected case). |
| `--rerun <dir>` | off | Finish an earlier invocation: rerun its usage-limit runs and run any planned run that has no row yet. Takes the model, run-budget and budget from `<dir>/runs.json` (pass `--budget` to raise the cap). Refuses if that invocation had more than one invalid run. Results go to a new directory. |

## Oracle arm

The `oracle` arm asks: what if the graph's answer cost nothing to get? It runs in the no-graph
workspace (no plugin, no `scribe-output/`), and its prompt is the question plus the stored output
of the case's `proxy_cmd`, framed as context from a code index:

```
<question>

Context from a code index of this repository, retrieved for this question. Each `@path:line` points into the source.

<code-index>
...bench/oracle/<case>.txt...
</code-index>
```

The init check requires that code-graph does not appear in this arm, just as in `nograph`. The
oracle-vs-nograph delta is the best-case saving. The graph-vs-oracle delta is what the model pays to
reach the graph itself (skill load, CLI calls, reading the output).

The stored outputs come from `node bench/capture-oracle.mjs` ($0, no model call). It builds each
case's graph-arm workspace under `$TMPDIR`, runs `node plugin/scripts/code-graph.cjs <proxy_cmd>`
with that workspace as cwd, and writes `bench/oracle/<case>.txt`. `--check` compares against the
stored files without writing, and `--only <substring>` filters cases. Re-capture after any change to
the CLI's output format. A missing file makes the runner exit 2 before anything is spent.

## Skills and noskills arms (ticket 042)

These arms ask whether concept skills save cost on their own, with no graph in either arm. Both
use the no-graph flags (no `--plugin-dir`, no `scribe-output/`).

- `skills` is the no-graph workspace as it is: maestro's `.claude/skills` are kept.
- `noskills` is the same workspace after `node bench/strip-concept-skills.mjs .` (called by
  `maestro-setup.sh`). It removes every skill dir, in any `.claude/skills` at any depth, whose
  `SKILL.md` frontmatter has `metadata.type: concept-skill`. Other skills (e.g. the `maestro`
  orchestrator skill, `test-maestro`) stay. The script exits 1 if it found no concept skill, which
  fails the setup, and exits 2 on a path inside a git work tree.

Auto-loaded memory (maestro's `CLAUDE.md` and `.claude/rules/*.md`) is not a skill and reaches
both arms. Case fields used by these arms:

- `skills`: the concept skills. The init event must list them in `skills` and must not list any
  of them in `noskills`.
- `keep_skills`: non-concept skills that must still be listed in both arms. This catches a strip
  that dropped `.claude/skills` wholesale.
- `covering_skills`: the skill(s) expected to answer the question. The report counts, per case,
  how many valid `skills` runs called one of them through the Skill tool.
- `skill_note`: why that skill covers the question and what else leaks the answer to both arms.
- `sets`: named case sets for `--set`.
- `proxy_extra` (optional, 051): a list of extra argv lists. `capture-oracle.mjs` runs them after
  `proxy_cmd` and appends their output to `bench/oracle/<case>.txt`, so a case can store a `search`
  plus an `impact`. A `search` that exits 7 (low confidence) is accepted; any other non-zero exit fails.
- `proposal`: a question not yet approved by the user. The runner refuses to start a paid run on
  any selected case that still has it (`--dry` and `--init-check` are allowed). Delete the field
  once the question is approved.

Nested skills (e.g. `apps/maestro/.claude/skills`) do not appear in the init event, so they are
only covered by the on-disk strip and by a Skill-call check: a Skill call to a concept skill in
`noskills` makes the run invalid. The report adds a "skills loaded" column per run and a
"skills vs noskills per case" section with cost, delta, pass rate and covering-skill loads. It
also carries a bias note: the questions were chosen where a skill should help.

### 042 command

Preflight ($0, checks the init event of both arms):

```sh
node bench/run.mjs --set 042 --arms skills,noskills --init-check
```

Then the paid run (the user approved the 042 set):

```sh
node bench/run.mjs --set 042 --arms skills,noskills --runs 2 --budget 7 --run-budget 0.6 --model claude-opus-5-5
```

That is 5 cases x 2 arms x 2 runs = 20 fresh runs on Opus 5.5 under a $7 total cap. With
`--run-budget 0.6`, no run starts once more than $6.40 is spent, so the cap holds. Single runs in
039 cost at most about $0.33.

If a run hits a usage limit (429), the invocation stops at that run and prints the rerun command.
Wait for the limit to reset, then run:

```sh
node bench/run.mjs --rerun bench/results/<timestamp>
```

This reruns only the usage-limit runs and the planned runs that never started. It takes the model,
run-budget and budget from that directory's `runs.json` and counts what was already spent; pass
`--budget` to raise the cap. Results go to a new directory. It refuses if the first invocation
had more than one invalid run. In that case, look at the INVALID section of the report before
spending more.

## Model arms and edit cases (ticket 044)

**Model arms.** `haiku-nograph`, `haiku-graph` and `sonnet-nograph` pin their own model
(`MODEL_ARMS` in `bench/lib.mjs`: `claude-haiku-5-5`, `claude-haiku-5-5`, `claude-sonnet-5-5`) and
behave as their base arm (`nograph` or `graph`) in everything else: workspace, flags, validity
checks, the graph-call check. `--model` still sets the model of every other arm, and `--rerun` still
refuses a `--model` that differs from the first invocation. The report header lists the model of
each arm when they differ.

**Edit cases** have an `edit` field and a `kind` of `test` or `scribe`. The model edits the
workspace, and the harness grades the files it leaves, not its answer. `bench/edit.mjs` does the work:

- Before the run (after `maestro-setup.sh`): delete `edit.remove` (existing tests that would hand
  over the answer); apply `edit.plant` (the code change a scribe task documents); copy
  `bench/edit/ts-resolve.mjs` to `<ws>/.bench/` for test cases; snapshot the `edit.protect` paths.
  Every plant and mutant is an exact string that must occur exactly once, or the case is refused.
- The run: `Edit,Write` join the allowed tools, and the session runs under `--permission-mode
  bypassPermissions` with `--tools` set to the same list. `.claude/` is a protected path: under
  `dontAsk` every Edit there is refused, even with an explicit `Edit(**/.claude/skills/**)` rule
  (Claude Code 2.1.312). A run whose init event lists any other tool is invalid. And the body of `.claude/agents/<agent>.md` (the
  maestro `test` or `scribe` agent, frontmatter stripped) goes in `--append-system-prompt`.
- After the run, before the workspace is removed: any change to a protected path is undone and
  listed in the report. Then:
  - test cases run `node --import ./.bench/ts-resolve.mjs --test <edit.test>` (Node 22.18+ strips
    the types; the hook maps maestro's `./x.js` imports to `./x.ts`, so no `node_modules` is
    needed). That is 1 point if the suite is green on the original code, plus 1 per `edit.mutants`
    entry it fails on (each mutant applied alone, then undone). A suite that is not green scores 0.
  - scribe cases read each file in `edit.docs`: 1 point per `must` regex it matches and per
    `must_not` regex it does not. A missing file scores 0 on its regexes. `must_not` holds only the
    stale wording, so a history note ("was 15") is not penalised. Every regex has paraphrase tests
    in `bench/lib.test.mjs`.
- The test file or the graded docs, and the test output, are saved next to the transcript.

On an edit case a failing Bash call does not invalidate the run, because running a failing test is
part of the work. The exits are listed in the report instead. Seccomp still invalidates. So does an
Edit or Write refused by the permission layer (for example a protected `.claude/` path under
`dontAsk`): that is a harness problem, not a result. The report adds an "Edit grading" section with
points, the grade detail, Edit/Write counts, restored files and Bash exits, and a per-arm total
against cost.

Other edit-case fields:

- `agent`: the maestro agent file the run uses.
- `graph_contribution`: what the graph should give that Grep would not.
- The reference solutions under `bench/edit/ref/` are never shown to a model.

`node bench/edit-check.mjs [--only <substring>] [--set 044] [--keep-ws]` is the $0 proof of the
graders. It needs no claude call and exits 1 on any FAIL. For each edit case in the set (default
`044`) it builds the no-graph workspace, prepares it as the runner does, and grades it twice:

- untouched: must score 0;
- with the reference solution: must score full marks. For test cases this means green on the
  original and every mutant killed, and a stray edit to protected code must be undone.

Run it after any change to a case, an `edit` entry or the maestro pin.

The user approved the 044 set (t1, t2, d1, d2) and its $8 cap, so the four cases carry no
`proposal` field. The preflight, pilot and paid commands are in
[docs/evals.md](../docs/evals.md), "Ticket 044", step 2 onwards.

## Budget, usage limits and reruns

No run starts when `spent + run-budget > budget`. Runs skipped this way are listed as NOT RUN in
the report and can be finished with `--rerun`. A run whose result event reports a usage limit
(`api_error_status: 429`) is marked USAGE-LIMIT. It is not counted as valid or invalid, and it
stops the invocation, which prints the `--rerun` command to use. The runner also stops on seccomp,
on a second invalid run, or on a run that exits without a result event. `runs.json` is rewritten
after every run with `{meta, planned, rows, spent, stop}`, so `--rerun` works after a crash or Ctrl-C.

Cases live in `bench/cases.json`: `question`, `setup` (shell command run in the fresh workspace;
`{REPO}` is the repo root) and `must` (regexes the final answer is checked against, no LLM judge).
A `must` regex that grades a negative fact ("X is NOT generated") needs a paraphrase test in
`bench/lib.test.mjs`: positive phrasings taken from each arm's source, and negatives that lack the
fact (see the s3 test).
Every arm gets the question, a fresh workspace from the same setup, and the same model (except the
044 model arms); the oracle
arm appends `bench/oracle/<case>.txt` to it. Only the graph arm gets `--plugin-dir plugin`. The first case reuses `plugin/evals/scaffold-lib.sh` through the
`02-impact-movetask` scaffold.

Cases may also carry `skills` (project skill names the init event must list in every arm except
`noskills`, where it must list none of them) and, for
the maestro cases, `expected`, `why_grep_expensive` and `proxy` notes. `setup` also gets `{ARM}` and
`{MAESTRO}` (`$MAESTRO_DIR` when set, else the first git checkout among `~/Documents/gits/maestro` and `~/gits/maestro` (`bench/maestro-dir.mjs`); with none, a case whose setup uses `{MAESTRO}` exits with one line naming `MAESTRO_DIR`; `--dry` needs a checkout only if a selected case uses `{MAESTRO}`; only ever read through `git archive`). Run the tests with `node --test bench/*.test.mjs` (`node --test bench/` fails on Node 25).
`bench/maestro-setup.sh` builds the maestro workspace from a pinned sha: graph arm = `apply` of each
concept from the committed `.ast.json` (no extract, no ts-morph); no-graph arm = same tree with no
`scribe-output/` directory at all. Both arms keep maestro's own `.claude/skills` and both lose
`.claude/settings.json` (it enables `code-graph@code-graph` and maestro's hooks). Because it
extracts a whole repo into its cwd and deletes files there, the script refuses to run (exit 2, one
stderr line) unless the cwd is an empty directory outside any git work tree. The runner and
`capture-oracle.mjs` always give it a fresh `mkdtemp` directory under `$TMPDIR`.

**Selection bias.** The maestro questions were kept because an offline proxy showed the graph covers
the answer; questions it missed were dropped. Results therefore favour the graph and overstate its
advantage on questions in general. The report repeats this note. The `deep` cases (m6, m7: callers
plus callers-of-callers) went through the same filter. These candidates were dropped because
`query impact` missed callers that grep finds, truncated at the default `--max 20`, or exited 4
(ambiguous): `parseFrontmatter`, `withinDirectory`, `getInstalledPlugins`, `bareAgentName`,
`tasksDirFor`, `mainCheckoutRoot`, `orchestratorSkillPath`, `isValidHandoffId`, `runtimeAssets`.

Cases with `proxy_cmd` (code-graph CLI arguments) can run in the oracle arm. Their stored output is
`bench/oracle/<id>.txt`, which is committed.

## Flags

All claude flag names are in the `FLAGS` object in `bench/lib.mjs`. Per run:
`-p <question> --model --output-format stream-json --verbose --max-budget-usd --no-session-persistence
--allowedTools Bash,Read,Grep,Glob,Skill --permission-mode dontAsk --setting-sources project,local
--strict-mcp-config` (+ `--plugin-dir <repo>/plugin` in the graph arm; on edit cases, `Edit,Write` in
`--allowedTools` and `--tools`, `--permission-mode bypassPermissions` and `--append-system-prompt <agent body>`). It uses your normal login.
`--setting-sources local` alone loaded no project skills, so the runner uses `project,local`: that
loads the workspace's `.claude/skills` and skips your user settings (installed plugins). Project
settings would still apply, which is why `maestro-setup.sh` deletes `.claude/settings.json`. Check
the names against `claude -p --help`. The init-event check proves on each run that code-graph is in
the graph arm only and the concept skills are in both. `--init-check` streams progress and stops
as soon as the init event arrives.

## Validity checks

A run is marked INVALID, listed first in the report and not counted, when:

- any Bash result contains `apply-seccomp`;
- any Bash call fails other than a code-graph call exiting 0, 4, 6 or 7, except (043) a non-zero
  exit of a read-only `grep`, `egrep`, `fgrep`, `sed` (without `-i`), `rg`, `cat`, `head`, `tail`,
  `ls` or `find` (without `-delete`/`-exec`), alone or chained only with each other (`&&`, `||`,
  `;`, `|`, redirects to `/dev/null` or a file descriptor): those are recorded in
  `readOnlyFailures` and do not invalidate. Seccomp, a chain with any other command, a write
  redirect and `$(...)` still do;
- the init event shows code-graph (plugins, skills, slash commands, agents) in the no-graph,
  oracle, skills or noskills arm, or does not show it in the graph arm;
- the init event lacks a case's `skills` (every arm except `noskills`), lists any of them in
  `noskills`, or lacks a `keep_skills` entry in `skills`/`noskills`;
- a `noskills` run calls a concept skill through the Skill tool;
- (044) an Edit or Write call is refused by the permission layer. The refusal wording is matched
  only in the error head (`editErrorHead`), before any echoed `String:`/`old_string:`/`new_string:`/
  `content:` input, so a failed Edit whose echoed text says "permission" is not a refusal;
- the result event is an error or missing.

On edit cases (044), the Bash-failure rule above does not apply; the failures are listed instead.
A model arm is checked as its base arm.

Known limitation: the read-only check (`isReadOnly`) is token-based, so `sed` `w`/`e` commands and
`rg --pre` count as read-only. The only effect is that a failing one is recorded in
`readOnlyFailures` instead of invalidating the run.

If seccomp is seen the runner aborts so nothing more is spent. Metrics per run: cost, turns,
input/output/cache tokens, Read/Grep/Glob/Bash/Skill counts, and each code-graph call's exit code and
output size (`exit:chars`).

## Output

`bench/results/<timestamp>/` (gitignored): `<case>/<arm>-run<N>.jsonl` transcripts, stderr files, and
`report.md` (also printed), plus `runs.json`. The report has sums per case and arm, sums per
`kind` group with the oracle-vs-nograph and graph-vs-oracle deltas, and sections for INVALID,
USAGE-LIMIT and NOT RUN runs. The run ends with `check: PASS|FAIL`. PASS needs every planned run
done and valid, with usage-limit runs not counted. Without the oracle arm, it also needs a
graph-arm code-graph call that exited 0 with output.

## Ticket 051 arms and set

`--set 051` is d2 plus four harder edit cases (t3, t4, d3, d4; 36 points per run). Its arms are
`haiku-nograph`, `haiku-noskills` (concept skills stripped), `haiku-oracle` (stored graph output from
`bench/oracle/<case>.txt` pasted into the prompt) and `sonnet-nograph`. The runner stops a run whose
prompt carries stored graph output outside an oracle arm, or lacks it inside one. The cap, thresholds and
exact commands are in [docs/evals.md](../docs/evals.md), "Ticket 051".

## Review mode (ticket 066)

`node bench/review-run.mjs` measures whether a reviewer catches bugs planted in a diff on the pinned
maestro checkout (same `maestroFor` resolution and `maestro-setup.sh` no-graph workspace as `run.mjs`). It
is separate from `run.mjs`, so the edit and read-only sets are unaffected. Plan, task set, decision rule and
verdict style are in [docs/evals.md](../docs/evals.md), "Ticket 066".

Planned arms (the default, ticket 067): `sonnet-nograph` (baseline), `haiku-nograph`, `haiku-diff-primer`;
the question is whether a Haiku reviewer misses clearly more than Sonnet, and what the primer does for Haiku.
`sonnet-diff-primer` (a primer cannot lift a baseline at the ceiling) and `sonnet-spawns-haiku` are dropped
from the plan but kept, with the spawn-validity check and tests; add them with `--arms`. Each arm pins its
model and its `--tools` set; only `sonnet-spawns-haiku` has the Agent tool. No arm has the code-graph plugin.
Default runs per cell: 3; default cap: $13 in all, pilots included (approved by the user; pass
`--budget` lower by what the pilots cost; see the 067 post-pilot amendment in `docs/evals.md`).

Hardened cases (068, after pilot A saturated: the baseline found 4 of 4 sampled bugs): cross-file bugs
break only outside the diff (a consumer such as the `maestro-task-status.cjs` twin, `handoff-channels`
lane liveness or the sibling entry points of `tasks.ts` is not in the diff), and local bugs are boundary,
ordering or wrong-default mistakes. Each bug case carries `review.source`, the maestro history or invariant
its bug kind comes from (077 resumable SessionEnd, 074 worktree pointers, 45a3583 repo-root queue, 084
optional claim `session_name`, the twin-parity fixes, the 064 session id rule, the 066 liveness rule). The
five clean cases include two plausible correct refactors (`r-c6`, `r-c7`) so false alarms stay measurable.

Files:

- `review.mjs`: arms, prompt, diff builder, primer builder, FINDINGS parser, graders, validity, verdict, report.
- `review-cases.mjs`: 15 cases (5 local bugs, 5 cross-file bugs, 5 clean diffs), each with a planted change,
  a grader and a known-good and a known-bad review text for the grader tests.
- `review-prep.mjs`: the $0 generator. Builds `bench/review/<id>.diff` and `<id>.primer.txt` from the CLI
  (`query file`, `query impact`, `query cross`) on a graph built from the pinned maestro. `--only <substring>`
  limits it; `--check` writes nothing and exits 1 if a stored file differs (deterministic output).
- `review/`: the stored diff and primer of each case, committed. The runner reads these and refuses a case
  whose stored diff differs from the one computed from its workspace.
- `review-run.mjs`: the runner. Options: `--arms`, `--only`, `--runs 3`, `--budget 13`, `--run-budget 0.4`,
  `--dry` (prints prompts and args, no model call), `--keep-ws`, `--init-check`.
- `review.test.mjs`: the unit tests (`node --test bench/*.test.mjs`), all offline.
- `review-cli.test.mjs`: runs the $0 commands as written (`review-run --dry`, `review-prep --check`); skipped without a maestro checkout. Nothing calls `claude`.

Validity: a run is invalid, not counted, if the init event shows another model or tool set than the arm's, if
a non-spawn arm lists or calls the Agent tool, or if a shared `lib.mjs` check fails. A `sonnet-spawns-haiku`
run is also invalid unless the transcript shows a Haiku subagent started (an Agent call with a Haiku model, or
a subagent message from a Haiku model). The runner stops at the cap, on a usage limit or seccomp, and after a
second invalid run.

Commands, from a plain terminal at the repo root (all but the last two are $0):

```
node --test bench/*.test.mjs
node bench/review-prep.mjs --check
node bench/review-run.mjs --dry
node bench/review-run.mjs --init-check
node bench/review-run.mjs --runs 1 --budget 1.1 --arms sonnet-nograph --only r-l1,r-l4,r-x1,r-x4,r-c6  # new pilot A: baseline saturation on the hardened cases
node bench/review-run.mjs --runs 3 --budget 12.19 --run-budget 0.4   # paid run (067): 3 arms x 15 cases x 3 runs, cap $13 less the $0.802 the two pilots cost
```

`--init-check` with no `--arms` checks the three planned arms. Both pilot A screens saturated (stop rule fired
twice); the 067 amendment in `docs/evals.md` records that and what is still decided.

Output: `bench/results/review-<timestamp>/` (gitignored): `<case>/<arm>-run<N>.jsonl` transcripts, `runs.json`
and `report.md` with the per-case table, the per-arm sums by category, and the verdicts against the baseline
with false alarms and cost per run beside them.

## Refactor mode (ticket 070)

`node bench/refactor-run.mjs` measures whether a cheap Haiku refactor scout, filtered by a Sonnet reviewer,
finds code-structure improvements as well as a Sonnet refactor pass, at lower cost. It reuses the review
bench's stream flags, findings parser (`findingsOf(text, 'PROPOSALS')`), spawn evidence, paired-cell rule and
verdict. Plan, case table, decision rule, stop rule, caps and the post-pilot amendment (2026-11-05, the
operative design) are in [docs/evals.md](../docs/evals.md), "Ticket 070".

Default arms (3): `sonnet-plain` (baseline), `haiku-metrics-primer`, `haiku-scout-sonnet-filter` (two sessions
per cell, scored on the proposals the filter keeps, both costs added, anchoring reported). Opt-in, off by default
(name it in `--arms`): `sonnet-spawns-haiku-scouts` (invalid unless a Haiku subagent appears in the transcript;
only this arm has the Agent tool). Default runs per cell: 2. All arms run in the no-graph workspace.

Scoring: every proposal beyond an expected improvement (and the case's `tolerated` list) is a false finding on
every case, clean or not, counted after the filter for the pipeline and split by the proposal's category.

An answer with no `PROPOSALS:` section (or a filter answer with no `VERDICTS:` section) makes the run invalid
(`answerProblems`), is not counted and is listed in the report; `PROPOSALS: none` is valid. The per-case table
has a `structured` column. All-clear text (`PROPOSALS: nothing to do`, `- nothing to change here`, `- Leave it as is.`,
`- No issues found.`, `- Not needed.`, a short bullet saying a thing is fine as written, `PROPOSALS:` followed by
prose that names no file) is its own `all-clear lines` count per case and arm: not a proposal, not sent
to the filter, not a false finding. A line in the `<file>: <kind>: <text>` shape is always a proposal, whatever
its text says; a bullet on the header line (`PROPOSALS: - a.ts: dedupe: x`) is the first item, and an unbulleted shaped line under the header is a proposal too. A bare marker on the header line (`PROPOSALS: -`) is an empty bullet: the dashless shaped line under it is its content, not a second item. Limits: an unshaped line opening with an all-clear phrase ("No changes to X, but ...") counts as an all-clear; unusual unshaped all-clear wordings count as false findings; a
shaped line that says "this is fine" is a false finding (not an all-clear), and header prose that names a file
is kept as one item. The prompt asks for `PROPOSALS: none` and nothing else.

Files:

- `refactor.mjs`: arms, prompts, scope and metrics-primer builders, graders, pipeline grading, validity, verdicts, report.
- `refactor-cases.mjs`: 9 cases (1 reverted real commit naming its maestro source, 5 improvements across
  several files; 2 seeded problems, a three-file near-duplicate and a three-module cycle; 3 clean
  neighbourhoods; 3 latent cases of real, unplanted duplicates), each with plants, expected improvements and
  known-good and known-bad texts. `sets` says which ticket's run uses it (`070`, `071`; `--set`), `batch` the
  071 filter batch.
- `refactor-prep.mjs`: the $0 generator of `bench/refactor/<id>.scope.txt` and `<id>.primer.txt` from the code-graph
  CLI on the pinned maestro. `--only <substrings>` limits it; `--check` writes nothing and exits 1 on drift.
- `refactor/`: the stored scope and primer of each case, committed.
- `refactor-run.mjs`: the runner. Options: `--arms`, `--only`, `--runs 2`, `--budget`, `--run-budget`
  (no defaults; a paid run needs both), `--dry`, `--keep-ws`, `--init-check`. A paid run refuses to start inside a Claude Code session (`--dry` and `--init-check` are exempt).
- `refactor.test.mjs`, `refactor-cli.test.mjs`: offline tests; the CLI tests skip without a maestro checkout.

Commands of the 070 design (superseded by the 071 commands below; the 070 arms and `--set 070` need the 070 runner from git history), from a plain terminal at the repo root (the first four are $0):

```
node --test bench/*.test.mjs
node bench/refactor-prep.mjs --check
node bench/refactor-run.mjs --dry
node bench/refactor-run.mjs --init-check
node bench/refactor-run.mjs --runs 1 --arms sonnet-plain --budget 1.45 --run-budget 0.50   # pilot: baseline, 6 sessions (the $3 pilot cap is cumulative, $1.525 already spent; see docs/evals.md)
node bench/refactor-run.mjs --budget 7 --run-budget 0.60                                   # paid run: 3 arms, 2 runs (the defaults)
```

Output: `bench/results/refactor-<timestamp>/` (gitignored): transcripts, `runs.json` and `report.md`.

### Ticket 071: batched and inline filters, useful findings per dollar

The runner above is the 071 runner now (`--set 071` is the default; `--set 070` selects the retired 070 cases).
Pre-registration, decision rule, caps and the run-count rule are in [docs/evals.md](../docs/evals.md), "Ticket 071".

Default arms (4, plus a control): `sonnet-plain`; `haiku-metrics-primer` (the scout alone); `haiku-batched-filter`
(the scout's list goes, with the other cases of its batch of 3, into one Sonnet filter session; that session's cost
is split over the batch's cases by their share of the proposals); `haiku-reviewer-inline` (the list goes into a
normal Sonnet review of the case's change, which marks each suggestion in a `VERDICTS:` section before its
`FINDINGS:`; costed as the scout plus the review's extra spend over `sonnet-review-plain`, the same review without
the list, which `--arms` pulls in with the inline arm and which is never scored as a refactor arm). One Haiku scout
session per (case, run) is shared by the three scout arms: its cost counts in each, the spend once. A case with no
plant gives the review arms a harmless doc-comment edit (`refactor.reviewChange`) to review. The report adds the
review-verdict shift (cells where the list changes the review's has-findings). The 070 pipeline and spawn arms
stay defined and tested, but this runner refuses them.

Usefulness, the headline: `refactor-audit.mjs`. A useful finding is an expected improvement the arm kept, or a kept
proposal the fixed audit confirms (the registry of improvements the 070 audit confirmed, a grep of the pinned tree
for unused exports and for functions defined twice, else a hand verdict on a blinded, shuffled list); unconfirmed
and unjudged proposals are noise.

```
node bench/refactor-audit.mjs bench/results/refactor-<timestamp> --pool    # audit-pool.json, audit-pool.txt (hand list)
# write audit-verdicts.txt: "<id>: confirmed <issue-key>: <evidence>" or "<id>: unconfirmed: <reason>"
node bench/refactor-audit.mjs bench/results/refactor-<timestamp> --score   # audit-report.md
```

Commands, from a plain terminal at the repo root ($0 first):

```
node --test bench/*.test.mjs
node bench/refactor-prep.mjs --check
node bench/refactor-run.mjs --dry
node bench/refactor-run.mjs --init-check
node bench/refactor-run.mjs --runs 1 --arms sonnet-plain --budget 3 --run-budget 0.60   # pilot (the $3 pilot cap)
node bench/refactor-run.mjs --runs <r> --budget 7 --run-budget 0.60                      # paid run; r from the pilot rule in docs/evals.md
```

Files: `refactor-audit.mjs` (metric and audit), `refactor-071.test.mjs`, `refactor-audit.test.mjs` (offline tests).
