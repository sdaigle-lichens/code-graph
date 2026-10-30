# Report r003: 044-measure-whether-the-graph-improves-haiku-test-and-scribe-work-against-sonnet.md

- Task: 044-measure-whether-the-graph-improves-haiku-test-and-scribe-work-against-sonnet.md
- Written: 2026-10-30T01:18:04.383Z
- From session: haiku-subagents-with-graph-044

## Outcome

Ticket 044 is done. Paid run: 24 of 24 runs valid, no 429s, $1.34 spent. With the pilot, the ticket spent about $1.71 of its $8 cap. Results are in `docs/evals.md` under "Ticket 044 → Results".

| arm | points | cost per run |
|---|---|---|
| haiku-nograph | 46/52 | $0.015 |
| haiku-graph | 45/52 | $0.017 |
| sonnet-nograph | 44/52 | $0.136 |

Verdict against the rule:
- **The graph doesn't help Haiku.** The rule needed haiku-graph at 52.9 points or more.
- **There is no gap to close.** haiku-nograph already matches or beats Sonnet at about 1/9 of the cost.
- **On cost alone, the graph fails.** haiku-graph costs about 14% more than haiku-nograph.

Confidence is low at n=2: t1 and t2 score full marks in every arm and d1 nearly does (47/48).

## Findings

- **On edit tasks, Haiku never reaches the graph.** haiku-graph made no code-graph CLI call in any of its 8 runs. It loaded code-graph-retrieval twice (t1 run 2, t2 run 2) and code-graph:scribe once (d2 run 1). By contrast, in 043 (read-only questions) it called the CLI in 14 of 14 runs.
- **d2 has a miss shared by every arm.** None of the 6 runs, Sonnet's included, fixed the stale "up to 5 at once" in the frontmatter description of `maestro-manager/SKILL.md`. Every run fixed line 55.
- **Sonnet often edits through Bash `sed -i`.** Grading looks only at the outcome, so this doesn't affect scores.

## Bench fixes during the run

These are uncommitted, in `bench/lib.mjs`, `bench/lib.test.mjs` and `bench/README.md`.
1. `nodeTestSummary` now also reads spec-reporter summaries (`ℹ pass N`).
2. Edit cases now run under `bypassPermissions` with `--tools` restricted to Bash, Read, Grep, Glob, Skill, Edit and Write. Under `dontAsk`, Claude Code refused every edit in `.claude/`, even with explicit allow rules. A new validity check rejects a run whose init event lists any other tool.
3. The maestro path comes from `MAESTRO_DIR`, set to `~/Documents/gits/maestro` on this machine.

## Post-mortem notes

1. No skill covers `bench/`.
2. A user-run pilot caught three bench bugs that the reviewed checks missed.
3. The orchestrator fixed those bugs inline, outside a workflow.
4. `pnpm check` wasn't run, because the sandbox blocks pnpm.

## Suggested ticket changes

- **Primer before output trimming.** Haiku never ran the CLI, so trimming its output can't matter yet. Discovery (a primer) is the open question.
- **Harder edit tasks first.** A primer can only show a gain on tasks that don't saturate, so the next measurement needs those. Fix the shared d2 frontmatter miss too, or keep it as a deliberate hard case.
- **New ticket: a `bench/` skill, or an offline smoke test.** It would cover the runner and graders, plus a pre-pilot check of claude flags and the Node test-reporter format.
- **New ticket: default MAESTRO_DIR.** Make the default work on this machine.
