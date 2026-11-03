# Report r038: 038-a-claude-p-runner-that-measures-graph-vs-no-graph-with-working-bash.md

- Task: 038-a-claude-p-runner-that-measures-graph-vs-no-graph-with-working-bash.md
- Written: 2026-10-27T14:54:52.099Z
- From session: absorb-concept-skills-038

Outcome: done. bench/ (run.mjs, lib.mjs, lib.test.mjs, cases.json, README.md) is a claude -p runner, graph vs no-graph, fresh workspace per run, validity checks, budget cap. bench/results/ gitignored; linked from docs/evals.md; one bullet in CLAUDE.md.
Flags verified against the user's `claude -p --help`: all exist, dontAsk is a valid permission-mode choice.
User-run fixture check (02-impact-movetask, 1 run per arm, $0.113 total): PASS. Both runs valid, no Bash failure, graph arm made one code-graph call exit 0 (197 chars), no-graph init had no code-graph plugin. Both scored 2/2. Graph arm: 0 Read, 1 Grep, 1 Bash, 1 Skill, $0.066; no-graph: 3 Read, 1 Grep, $0.048.
Findings: on this question the no-graph arm answered correctly and cheaper, so the fixture does not show a graph advantage. pnpm check/test green, 16 bench unit tests pass.
Nits (unfixed): isCg regex matches any command mentioning code-graph; check line can print PASS after an early budget stop (exit 3); seccomp-abort, timeout and setup-failure paths untested; --setting-sources local hiding installed plugins is proven only by the per-run init check.
Suggested ticket changes: 039 can reuse bench/lib.mjs; consider tightening isCg first.
