# Report r040: 041-measure-the-best-case-saving-if-graph-answers-were-free-to-get.md

- Task: 041-measure-the-best-case-saving-if-graph-answers-were-free-to-get.md
- Written: 2026-10-27T20:30:26.733Z
- From session: absorb-concept-skills-041

# 041 report — best-case saving if graph answers were free

## Outcome
Done. Everything is uncommitted on feat/integrate-concept-skills, in the main checkout.
- bench/ has an `oracle` arm. Its prompt is the question plus the stored proxy output (bench/oracle/m1–m7.txt, captured with bench/capture-oracle.mjs).
- New flags: --arms, --graph-cases and --rerun. Usage-limit (429) runs are not counted. The runner stops if more than one run is invalid. A budget guard stops new runs near the cap.
- Two new deep questions, m6 (listSessionIds, two levels of callers) and m7 (decideSync, 85 grep hits, 3 real calls). The user approved them.
- bench/lib.test.mjs passes 43/43 and pnpm check is green. Nothing changed under plugin/ or packages/, and there is no version bump.
- docs/evals.md has a "Ticket 041" section.

## Scope change (user decision)
The 32-run plan cost about $7–8 and did not fit the $7 cap. The user chose deep questions only: m6 and m7, three arms, two runs each. m1–m5 were not run and have no verdict.

## Findings
The --init-check preflight passed: nograph and oracle had no code-graph plugin. The paid run had 12 valid runs out of 12, spent $2.467 of a $5 cap, and hit no usage limit.
- Deep group, oracle vs nograph: $0.861 vs $0.836, so the oracle cost 3% MORE. The rule needed it to be at least 20% cheaper. m6 was +19% (both runs the same way). m7 was -12%, but its two runs disagreed. Verdict: the ceiling is too low to justify a delivery rework for this group. Confidence is low to moderate at n=2, and the selection bias favours the graph.
- Even with the answer in its prompt, the oracle arm still grepped 13 times over 4 runs to check the index. The larger prompt raised the cache-create tokens. It took fewer turns (21 vs 28) but cost about the same.
- The graph arm never called the code-graph CLI or loaded a skill in any run, so graph vs oracle (-11%) does not measure friction. On m6 the graph arm scored 24/26.

## Incident
Early on, @backend ran bench/maestro-setup.sh from the repo root. It overwrote the user's uncommitted status.json and maestro.json (the manager restored them). As the manager asked, a guard now makes maestro-setup.sh refuse with exit 2 and one stderr line unless its cwd is an empty directory outside any git work tree. bench/lib.test.mjs tests it, running the script only in mkdtemp dirs. run.mjs and capture-oracle.mjs already pass the guard.

## Post-mortem notes
These are in the task file:
- the setup-script incident;
- the plan went over the cap and this was caught only after the user had approved it;
- the graph arm made no graph call.

## Suggested ticket changes
- Before any delivery rework, consider whether the oracle result closes the question for deep impact. A cheap follow-up would be the m1–m5 oracle vs nograph run (about $4) if the user wants verdicts for those groups.
- The stored impact output lists caller lines more than once (CLI behaviour in packages/). A small packages/ ticket could remove the duplicates.
- 042 (concept skills on their own) is unaffected.
