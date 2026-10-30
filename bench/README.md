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
| `--arms` | nograph,graph | Comma list from `nograph`, `oracle`, `graph`, `skills`, `noskills`, and the 044 model arms `haiku-nograph`, `haiku-graph`, `sonnet-nograph`. Unknown names exit 2. `skills`/`noskills` exit 2 on a case with no `skills` list. |
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
`{MAESTRO}` (`$MAESTRO_DIR`, default `~/gits/maestro`, only ever read through `git archive`).
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
