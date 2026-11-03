# Report r039: 039-measure-graph-impact-and-cross-questions-on-maestro.md

- Task: 039-measure-graph-impact-and-cross-questions-on-maestro.md
- Written: 2026-10-27T19:07:46.938Z
- From session: absorb-concept-skills-039

Outcome: done. Paid run completed, results in docs/evals.md (Ticket 039 section). Maestro pinned at 3814a30, Opus 5.5, 20 valid runs, spend 5.378 of 6 dollars.

Findings:
- The graph does not save cost on these questions: five-question total 2.577 dollars graph vs 2.580 no-graph. Impact questions m1-m3 are about 7 percent dearer with the graph; cross questions m4-m5 are 8 percent cheaper, but that is a concept-skill effect, because the agent never invoked the CLI on m4 or m5. Pass rate 67/72 vs 66/72. Confidence is low (n=2, one model, selection bias favouring the graph).
- The retrieval skill and CLI fired together in only 5 of 10 graph runs.
- isCg missed nothing; no bench change needed.

Post-mortem notes:
- Preflight showed project skills load in neither arm under --setting-sources local; fixed by removing .claude/settings.json in both arms and using project,local.
- Four m4/m5 run-2 runs were lost to a 429 usage limit, not Bash failures; rerun with --only -cross- as a separate invocation.
- The runner has no resume option, which made the rerun awkward.

Suggested ticket changes: none required. The user decides the stage-2 options (enrichment arm, Haiku 5.5 arm, or stop investing in retrieval).
