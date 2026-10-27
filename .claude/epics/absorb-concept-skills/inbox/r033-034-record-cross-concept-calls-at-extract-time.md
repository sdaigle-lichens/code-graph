# Report r033: 034-record-cross-concept-calls-at-extract-time.md

- Task: 034-record-cross-concept-calls-at-extract-time.md
- Written: 2026-10-26T13:41:40.801Z
- From session: absorb-concept-skills-034

# Report: 034 record cross-concept calls at extract time

## Outcome

Done and verified, nothing committed. Version 0.3.27 in all three files, bundle regenerated.
`pnpm check` green, package tests 492/492 (9 new in `scribe/cross-concept-edges.test.ts`), `just eval` 7/7, `claude plugin validate` passes.

- `extract` now emits an edge to another concept's vertex when a call or mount resolves to a file owned by another concept (`makeForeignResolver`). `crosses_concept` is true from extract alone, no enrichment.
- Owner rule for a file matched by several concepts: first in `scribe.config.json` order, excluding the concept being extracted. A file the extracting concept matches itself stays local. Docs-only concepts are skipped.
- Target concept not applied yet, or its vertex archived: the edge is kept with `crosses_concept: true`. `apply` no longer recomputes the flag down to false (`edge.crosses_concept === true || computed`). Queries hide such edges.
- Behaviour change beyond cross-concept edges: `oneHop`, `twoHops`, `oneHopAnyTable`, `queryCross` and `queryConcept` now require the far vertex to be `status = 'live'`, so edges to archived vertices are hidden everywhere. `EDGE_SCAN_ORDER`, `eKey` dedup, layer 1, `FTS_FORMAT` and `SCHEMA_VERSION` untouched.
- Fixture: `.ast.json` x3 re-extracted; `enrich targets` reports 0 stale/changed/new, so `.enriched.json` is unchanged. `impact moveTask --direction in` lists `notifyOverdue` and `useDragReorder`; `query cross` exits 0 for task-store/board-ui and task-store/reminders. This repo's own `scribe-output/` is gitignored, so there is nothing to commit for it.
- Docs: `docs/usage.md` (new "Cross-concept edges" section, one-time `.ast.json` rewrite after 0.3.27), scribe-pipeline SKILL.md (applied to the store), `packages/code-graph/CLAUDE.md`, `docs/evals.md` (both pilots).
- Temporary `CODE_GRAPH_EVAL_NO_ENRICHMENT` switch in `plugin/evals/scaffold-lib.sh` removed after the pilot.

## Pilot findings (full tables in docs/evals.md, "Pilot after 0.3.27")

- Enriched, 3 runs per arm: all 7 cases 1.00 in both arms, mean delta 0.00, $6.19. Un-enriched, 2 runs per arm: same, $4.05.
- Compared with 032 (1 run, delta +0.21 noise, 0 Skill and 0 Bash in positive cases) and 033/0.3.26 (2 runs, delta 0.00, Skill 2/2): skill and CLI use held at 3/3, except cross-store-reminders, where the skill fires but the CLI is never run, in both pilots. The 034 graph fix did not change the agent's behaviour there.
- Enrichment on vs off: identical pass rate, Skill/Bash use, and turns and cost within noise. Not recoverable: search exit codes 0/6/7 (traces were in temporary eval dirs, deleted). Not confirmed: that the scaffold switch took effect (its output line is not shown by `claude plugin eval`).
- Cost: with the plugin, runs cost about 27% more overall and about 35% more in positive cases (about $0.16-0.21 against $0.11-0.16 per run) with no accuracy gain. `neg-no-config` costs more with the plugin although the skill never fires, so part of the overhead is the SessionStart line.
- Recommendation on setup-time enrichment: do not prioritize it on this evidence. Re-test it in the benchmark below.

## Decision for the manager: the user's open question

The user's main question: does code-graph save cost, and if not, how to get there. This suite cannot answer it: fixture too small for Grep to be expensive, only the final answer is graded, and there are no turns, tokens or file-read counts. 032 measured plain Grep (the with-plugin arm never used the graph); only 0.3.26+ exercises it.

### Suggested ticket (manager to create; the user wants ticket creation to belong to the manager)

Title: benchmark whether code-graph saves cost on a realistic repo.
1. Target: this repo (`code-graph`, real TypeScript, several concepts) or the pilot consumer if it can be run on the user's machine. Do not commit to the pilot consumer from here.
2. 5-8 questions of the skill's shapes: who calls X, what breaks if I change Y, where is Z, how does W work. Include at least two multi-hop questions where Grep needs many reads.
3. Metrics per arm: total cost, turns, input/output tokens, file reads, plus answer correctness as a gate. At least 3 runs per case. Use `--keep-temp` so traces survive, and record CLI exit codes (0/6/7).
4. Run it before any retrieval change; the result decides which lever to pull.
5. Include an enrichment on/off arm (needs the scaffold switch back, or a documented scaffold option) so the setup-time enrichment question is answered on real data.

### Levers to test if the graph costs more (hypotheses, not conclusions)

- Skill overhead: SKILL.md size, SessionStart line, one Bash round trip per session. Measure tokens added; trim or load lazily.
- CLI output size: capped or compact output for `search` and `impact`, since it is re-read on every later turn.
- One call instead of several: answer-ready output (callers plus snippet) so the agent does not run the CLI and then read the files anyway.
- Fallback cost: exit 7 and missing edges send the agent back to Grep, so it pays for both paths.
- Not firing the skill for one-file lookups where Grep is already cheap (`locate-overdue` costs 6 turns with the plugin against 3 without).
- Why cross-store-reminders never runs the CLI (read the traces once captured).

### Out of scope or left open

- Exit-7 rule and search ranking unchanged (recorded as separate finding in the task).
- `says-no-graph` grader in `neg-no-config` gets FAIL from all judge votes although the agent behaves correctly; it is not scored. Candidate for a small grader fix.
- Uncommitted: the code, tests, fixture `.ast.json`, docs and version bump; one untracked `eval/results-*.json` from `just eval`, probably to delete, not commit.
