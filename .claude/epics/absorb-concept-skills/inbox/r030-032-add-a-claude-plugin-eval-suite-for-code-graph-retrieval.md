# Report r030: 032-add-a-claude-plugin-eval-suite-for-code-graph-retrieval.md

- Task: 032-add-a-claude-plugin-eval-suite-for-code-graph-retrieval.md
- Written: 2026-10-25T23:38:05.028Z
- From session: absorb-concept-skills-032

# Ticket 032 report: claude plugin eval suite for code-graph-retrieval

## Outcome
Done as a measurement harness. The pilot is the "before" baseline for 033 and 034. The full 3-run suite was skipped by the user's choice (option b). Version is still 0.3.25. Nothing is committed: the 0.3.25 changes, `plugin/evals/`, `docs/evals.md` and a README index line are uncommitted in the tree.

Gates the user approved in this tab: quality spec, inputs (7 cases), graders, option (b), enriching the fixture, dropping the 05 regex grader, and the human review.

## Format and setup
- Format: `prompt.md` + `graders/*.md` per case, plus `case.yaml` for setup only.
- Setup is expressed by `case.yaml` `context.scaffold_script`. It runs only with `--scaffold`, as the user, outside the agent sandbox, for at most 120 s, and may create files and git state only.
- Shared logic is in `plugin/evals/scaffold-lib.sh`. It copies `plugin/evals/fixture` into the empty workspace, then runs only `apply` per concept (never `extract`). It fails fast unless `node:sqlite` loads (Node >= 22.5; pilots ran v22.19.0).
- `CLAUDE_PLUGIN_ROOT` is empty in the scaffold environment (confirmed). The script derives the plugin root from its own path, and the runner executes it in place (graph.db was built in the run workspaces).

## Fixture and cases
- Task-board fixture, 3 concepts (task-store, board-ui, reminders), committed `.ast.json` from a real `extract` (byte-stable on re-extract) and `.enriched.json` from real `enrich merge` (0 stale).
- 7 cases: smoke (search), impact-movetask, cross-store-reminders, locate-overdue, not-in-graph, neg-no-config, neg-literal. runs: 3 in each prompt.md.
- Scored graders are llm outcome graders on the final answer plus a few regex. Skill-fired and command-chosen checks are display-only indicators.

## Exact pilot command (033/034 reuse)
`claude plugin eval . --eval-dir plugin/evals --scaffold --allow-tools Bash --judge-model sonnet --ablation with-without --no-publish --trust-plugin --runs 1 --max-cost-usd 5`
- Run from the repo root, never from `plugin/`. Add `--verbose --keep-temp` to debug.
- `--allow-tools Bash` is needed in both arms because neither allowed_tools nor the skill's allowed-tools widens past the read-only set. Linux needs bubblewrap and socat.
- Full suite estimate: about $5.60 (3 runs per arm), after 034.

## Pilot results (user-run, 1 run per arm, about $1.9 and 6 min each)
Latest run, enriched fixture: 7/7 cases pass, mean delta +0.21 (noise, see below).

| Case | With | Without | Skill calls (with) | Bash calls (with) |
|---|---|---|---|---|
| smoke | 1.0 | 1.0 | 0 | 0 |
| impact-movetask | 1.0 | 0.0 | 0 | 0 |
| cross-store-reminders | 1.0 | 1.0 | 0 | 0 |
| locate-overdue | 1.0 | 1.0 | 0 | 0 |
| not-in-graph | 1.0 | 0.5 | 0 | 0 |
| neg-no-config | 1.0 | 1.0 | 1 | 0 |
| neg-literal | 1.0 | 1.0 | 0 | 0 |

Cost and duration per case are in the result JSON (`plugin/evals/results/`, gitignored). The without-arm 0.0 and 0.5 are single-run misses; the with-arm never used the graph, so they are likely noise, not plugin benefit. Earlier pilots: 5/7 with delta -0.14 (a rubric problem, fixed), then 7/7 with delta 0.

## Findings (not fixed, per scope)
1. The skill never fired on natural phrasing in the five positive cases or in neg-literal (0 Skill, 0 Bash calls in all three pilots). It fired only once, in neg-no-config. The skill was in the agent's skill list.
2. The graph records edges only within a concept (`buildEdges`, `crosses_concept: false`). `query impact moveTask` lists only callees; both real callers (useDragReorder, notifyOverdue) are in other concepts. `query cross` finds nothing (exit 6 un-enriched, exit 0 with an empty result after enrichment).
3. Exit codes were checked by running the CLI directly in a scaffolded workspace, not inside an agent run (no search ever ran in an agent run). After enrichment: reorder question exit 0; overdue, interaction and PDF questions exit 7 (weak match); the PDF question returns irrelevant hits at exit 7 rather than exit 6.
4. `claude plugin validate` passes. Its directory profile notes a missing LICENSE and icon (pre-existing, not part of this ticket).
5. Grader fixes made after the first pilot: cross-store rubric relaxed, says-no-graph made display-only, the 05 export-file regex dropped (false-failed honest answers).

## Checks
`pnpm check` green, package tests 480/480, `just eval` 7/7, scaffolds 14/14 in clean environments, no `.claude/` or `CLAUDE.md` under `plugin/`, retrieval skill untouched. The review passed with no blockers.

## Suggested ticket changes
- 033 and 034 should re-run the pilot command above and compare against the table. 034 must re-extract the fixture `.ast.json` files and re-run `enrich merge` so enrichment stays current.
- Consider a LICENSE and icon ticket if the plugin goes to the directory.
- Docs: `docs/evals.md` (new). The repo CLAUDE.md layout list could mention `plugin/evals/` and `docs/evals.md`; left to the user.
