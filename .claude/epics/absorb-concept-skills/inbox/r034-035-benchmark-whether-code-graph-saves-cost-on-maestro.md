# Report r034: 035-benchmark-whether-code-graph-saves-cost-on-maestro.md

- Task: 035-benchmark-whether-code-graph-saves-cost-on-maestro.md
- Written: 2026-10-26T19:06:53.278Z
- From session: absorb-concept-skills-035

Outcome: 035 built and verified up to the user-run Stage 1. Stage 1 (paid, ~$4-6, cap $8) is NOT run; the user runs it. Nothing committed.

Stage 0 (b323aa7, un-enriched, tokens = chars/4): Grep reached the full answer on all 8 questions. Graph output alone reached none fully. Search exits 7 almost everywhere because nothing is enriched. Graph was cheaper than Grep only on q5 (205 vs 2887 tokens) and covered 1/4 of the answer.
User approved the surviving set: q2 (hook arbitration), q5 (STATIC_ASSETS), q6 (design-check) as graph candidates, plus q3 and q8 as Grep-wins controls. Dropped q1, q4, q7 (graph 0 hits, or outside the graph: plugin-entries bundles, RunRecord is an interface, run-metrics.ts in no concept). Snapshot kept at b323aa7 (user choice), 16 re-extracted .ast.json stored in evals/bench-maestro/ast.

Skills loading: eval workspaces do not load project .claude/skills (from claude plugin eval docs, not a live run; claude not on PATH in the sandbox). The skills-only arm ships maestro's 16 concept skills as a generated bench plugin. `--model claude-opus-5-5` sets the model (manager input: Opus 5.5 first; Haiku 5.5 optional second arm).

Also done: says-no-graph grader is now a regex not_contains check; version 0.3.28 in all three files, bundle regenerated; docs/evals.md "Maestro benchmark" section plus the main-session-only/subagent limit; README link; .gitignore for results/ and generated skills/. pnpm check green, package tests 492/492, just eval 7/7. claude plugin validate not run (claude unavailable).

Findings and risks for the manager:
- apps/desktop graph-canvas-real-store.test.ts fails (expected 1, got 23). It predates 035: the local graph.db now holds 22 cross-concept calls edges from 0.3.27 (034). Needs an owner/ticket; suggested fix is to compute the expected skipped count from the store.
- ~/gits/maestro working tree is dirty: 15 tracked scribe-output/*.ast.json, graph.db and .claude/epics/code-graph-cutover/EPIC.md modified. The bench code only reads via git archive; likely the manager's own 0.3.27 re-extract or a 034 run. Confirm this is expected.
- Correction to the manager's note: projectOwnsHook is present at b323aa7 (apps/maestro/src/core/hook-arbitration.ts), a0f6dea is an ancestor; q2 kept as written.
- metrics.mjs is untested on a real trace; the plugins: frontmatter key, --eval-dir layout and flag spellings come from docs and may need small tweaks on the first real run.
- says-no-graph regex still false-fails negated phrasing ("did not rely on the code graph"); low severity.
- bench.json holds the short sha b323aa7, not the full sha.

Suggested ticket changes: (1) fix or re-own the desktop test; (2) after Stage 1, ranked levers (enrich so search stops exiting 7, graph output size, skill firing on cheap lookups) as the Stage 2 decision for the user; (3) optionally record the full sha.

Run command (user): claude plugin eval evals/bench-maestro --eval-dir evals --scaffold --allow-tools Bash --keep-temp --no-publish --trust-plugin --ablation none --runs 2 --max-cost-usd 8 --model claude-opus-5-5 --output-dir evals/bench-maestro/results, then node evals/bench-maestro/metrics.mjs evals/bench-maestro/results.
