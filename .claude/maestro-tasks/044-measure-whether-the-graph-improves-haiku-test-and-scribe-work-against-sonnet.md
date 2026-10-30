# Measure whether the graph improves Haiku test and scribe work against Sonnet

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Epic `haiku-subagents-with-graph`, first ticket. For background, read that epic's `EPIC.md`, the
"Status: closed" section of `.claude/epics/absorb-concept-skills/EPIC.md`, and `docs/evals.md`
"Ticket 043".

### Why this ticket

Ticket 043 showed that graph context lifts Haiku 5.5 on read-only questions about maestro
(91/108 without it, 107/108 with the plugin). maestro's `test` and `scribe` agents already run on
Haiku (`~/gits/maestro/.claude/agents/{test,scribe}.md`). The open question: does the graph make
their actual work better? That work is edits, not answers:
- **test:** writing tests that run and catch a real bug.
- **scribe:** updating a SKILL.md or doc so it states the correct facts after a code change.

Sonnet 5.5 is the reference for how good that work could be.

### Tasks

Propose 4 to 6 tasks on the maestro copy the bench already pins (`3814a30`, via
`bench/maestro-setup.sh`): about half test, half scribe. Each task must:
- **resemble what maestro's agent is really handed:** the same kind of prompt, run with that
  agent's prompt as the system prompt (for example `--append-system-prompt` from the agent file's
  body);
- **be graded on the outcome, automatically:**
  - **test tasks:** the new tests pass on the original code and at least one fails on a planted
    bug (a mutant the harness applies after the run);
  - **scribe tasks:** `must` regexes for the facts the change introduced, plus `must_not` regexes
    for stale or wrong statements, each with a paraphrase test (see the `bench/README.md` rule
    from 042);
- **need cross-file knowledge** (a caller, an invariant, a second module), so the graph has
  something to add. State per task what the graph should contribute.

The user approves the task list before any paid run, as in 042.

**Check feasibility first:** the test tasks have to run maestro's tests inside the bench workspace.
- Find a way that needs no package install from the sandbox: a test runner already available, a
  module testable with `node --test`, or reusing an installed `node_modules`.
- If none works, stop and report. Don't install anything; installs are the user's to run with `!`.

### Arms

All arms use the existing bench machinery, extended for edit tasks:
- `haiku-nograph`: `claude-haiku-5-5`, concept skills plus Grep. Today's maestro setup.
- `haiku-graph`: `claude-haiku-5-5` with the code-graph plugin.
- `sonnet-nograph`: `claude-sonnet-5-5`, concept skills plus Grep. The reference.

If a per-arm model needs a runner change, make it. Keep `--model` working as it does today.

### Decision rule, written into `docs/evals.md` before the paid run

- **The graph helps Haiku** if `haiku-graph` scores clearly above `haiku-nograph`: at least 15% more
  graded points over the set, and no task lower in both runs.
- **It closes the gap** if `haiku-graph` recovers at least half of the gap between `haiku-nograph`
  and `sonnet-nograph`, at under half of Sonnet's cost per task.
- **If `haiku-nograph` already matches Sonnet,** say so: there is no quality gap to close, and the
  graph is judged on cost only.

### Paid run

- Run the `--init-check` preflight for each model first.
- The user runs everything from a plain terminal.
- 3 arms × tasks × 2 runs. Propose a cap from a 1-run pilot of one task per arm (the pilot is
  also user-run). Suggested ceiling: $8.
- 429 runs aren't counted; rerun them with `--rerun`.
- If more than two runs are invalid for any other reason, stop and report.

### Report

Write a "Ticket 044" section in `docs/evals.md`:
- per task and arm: score, cost, turns, tokens and tool counts;
- whether `haiku-graph` loaded the retrieval skill and called the CLI;
- a plain verdict against the rule, with confidence at n=2;
- which steps of the epic's friction work (trimming output, a primer) the data argues for.

### Out of scope

- changes under `plugin/` or `packages/`, and a version bump;
- changes in `~/gits/maestro`;
- building a primer or trimming output (later tickets in this epic);
- an Opus arm.

## Acceptance criteria

- [ ] Feasibility of running maestro tests in the bench workspace confirmed without installs, or reported as a blocker
- [ ] 4–6 test and scribe tasks with automatic outcome grading (mutant check; `must`/`must_not` with paraphrase tests), approved by the user
- [ ] Arms `haiku-nograph`, `haiku-graph`, `sonnet-nograph`, with agent-prompt framing and unit tests for the new runner paths
- [ ] Decision rule written in `docs/evals.md` before the paid run; preflight passes for both models
- [ ] User-run pilot and paid run within the agreed cap, every counted run valid, 429s rerun
- [ ] `docs/evals.md` "Ticket 044" section with the per-task table and a verdict against the rule
- [ ] `node --test bench/lib.test.mjs` and `pnpm check` green

## Blocked by

None - can start immediately.

## Remaining work (handover)

The setup is done, reviewed and approved: 4 tasks (t1, t2, d1, d2) and the $8 cap approved by the user, `proposal` fields removed, three arms in `bench/lib.mjs` (`MODEL_ARMS`), decision rule in `docs/evals.md` "Ticket 044". Checks: `node --test bench/lib.test.mjs` 88/88, `node bench/edit-check.mjs` all graders behave, `pnpm check` green. Review rounds: `044-*.review.md`, `044-*.review-2.md`.

Still to do, from a plain terminal (not inside Claude Code) at the repo root. On a new machine you need Node 22.19+ and a maestro clone containing commit `3814a30` at `~/gits/maestro` (or set `MAESTRO_DIR`); the runner builds each workspace from it with `bench/maestro-setup.sh` through `git archive`, and the graph arm uses the committed `plugin/` bundle.

1. **Preflight ($0).** Init event MISSING means `--append-system-prompt` isn't accepted: fix `FLAGS.appendSystemPrompt` in `bench/lib.mjs`.
   ```
   node bench/run.mjs --set 044 --arms haiku-nograph,haiku-graph,sonnet-nograph --init-check
   ```
2. **Pilot (6 runs, at most $2).**
   ```
   node bench/run.mjs --set 044 --only t1 --arms haiku-nograph,haiku-graph,sonnet-nograph --runs 1 --budget 1 --run-budget 0.75
   node bench/run.mjs --set 044 --only d1 --arms haiku-nograph,haiku-graph,sonnet-nograph --runs 1 --budget 1 --run-budget 0.75
   ```
   In each `bench/results/<timestamp>/report.md`: every run valid, no Edit/Write refused (d1 edits `.claude/skills` docs), no Sonnet run at the $0.75 per-run cap (if one is, use `--run-budget 1` below).
3. **Paid run (24 runs).** `--budget` = 8 minus the pilot's spend (6 at most).
   ```
   node bench/run.mjs --set 044 --arms haiku-nograph,haiku-graph,sonnet-nograph --runs 2 --budget 6 --run-budget 0.75
   ```
4. **429s** aren't counted: rerun after the limit resets with `node bench/run.mjs --rerun bench/results/<timestamp>`. More than two other invalid runs: stop and report.
5. **Report** (a `/maestro` session on this ticket, given the pilot and paid-run `bench/results/<timestamp>` folders; `bench/results/` is gitignored, so do it on the machine that ran them): fill "Ticket 044 → Results" in `docs/evals.md` with the per-task/arm table (points, grade detail, cost, turns, tokens, tool counts), whether `haiku-graph` loaded the retrieval skill and called the CLI, a verdict against the rule with confidence at n=2, d2 on its own, and which friction steps (trimming output, a primer) the data argues for. Then `node .claude/scripts/maestro-task-status.cjs done` and report to the epic `haiku-subagents-with-graph`.
   - **Results written** (paid run `2026-10-30T00-43-25-519Z`, 24/24 valid, $1.339; about $1.71 in all with pilots). Verdict: the graph does not help Haiku (45 vs 46/52), there is no gap to close (haiku-nograph 46 vs Sonnet 44 at about 1/9 the cost), and haiku-graph fails the cost-only test (+14%). haiku-graph never called the CLI. Still to do: the status `done` and the epic report.

## Post-Mortem

- **Problem:** @backend's first pass had `parseStream` treat any Edit/Write error containing "permission|denied|not allowed" as a refused edit, including the old_string Claude Code repeats in the error; 3 graded docs contain "permission", so valid paid runs would have been marked INVALID. @test caught it, @reviewer returned FAIL, and it took a loop-back to @backend (`editErrorHead`).
  **Fix:** none
- **Problem:** no skill covers `bench/` (runner, graders, case format); every agent reported working from `bench/README.md` and the code alone.
  **Fix:** none
- **Problem:** the "setup is done and approved" handover had three bugs the reviewed checks couldn't catch, each found only by a user-run pilot. The runner defaulted to `~/gits/maestro` (the clone is at `~/Documents/gits/maestro`). `nodeTestSummary` read only TAP summaries, so every test task graded 0 under the user's Node (spec reporter, `ℹ pass N`); the `edit-check` dry run hadn't exercised that. Edit cases under `dontAsk` couldn't edit protected `.claude/` paths. A first fix with explicit `Edit(**/.claude/skills/**)` allow rules, made from a guess about Claude Code's behaviour, cost a wasted run before the switch to `bypassPermissions` plus `--tools`. No offline check runs real `claude -p` and Node-version paths before the user-run pilot.
  **Fix:** none
- **Problem:** the orchestrator fixed the three bench bugs inline, outside any workflow, instead of routing them to @backend/@test; `pnpm check` was never run, because the sandbox blocks pnpm's lockfile read.
  **Fix:** none
