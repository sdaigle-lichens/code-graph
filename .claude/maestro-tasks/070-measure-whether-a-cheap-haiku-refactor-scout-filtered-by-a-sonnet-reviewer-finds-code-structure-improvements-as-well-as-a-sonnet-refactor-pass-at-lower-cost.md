# Measure whether a cheap Haiku refactor scout, filtered by a Sonnet reviewer, finds code-structure improvements as well as a Sonnet refactor pass at lower cost

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Started by the user on 2026-11-05. Ticket 069 waits for this one to merge (both touch the review/refactor bench and the evals doc); 069 then starts from the merged main.

The user wants a cheap Haiku refactor agent that runs before the Sonnet reviewer on every task and suggests code-quality improvements, with the Sonnet reviewer filtering its false alarms and deciding which suggestions are worth a refactor ticket. The reviewer stays on Sonnet (067: every arm found 30/30 seeded bugs, but Haiku raised 8 to 10 false alarms on 15 clean diffs against Sonnet's 3). Measure whether that pipeline is worth it.

Case set on the pinned maestro checkout, with ground truth: (a) reverted real refactors from maestro's history (a deduplication, an extracted helper, a removed cycle, an aligned pattern), each naming its source commit, where the agent should propose the refactor again; (b) seeded structural problems (a helper duplicated across two concepts, pattern drift in one file of a family, a new dependency cycle, an export nothing imports); (c) clean neighbourhoods where no refactor is warranted, so false findings are measurable. The scope of each run is a change's neighbourhood: the touched files plus their graph neighbours from the code-graph CLI (impact and cross), not the whole repo. A grader decides from the output whether each expected improvement was proposed (right files and the right kind of change) and counts the rest as false findings, unit-tested against known-good and known-bad output.

A deterministic $0 metrics primer per case from the code-graph CLI: fan-in and fan-out, hubs, cross-concept edges, cycles, unused exports, as far as the CLI already exposes them (if a metric needs package source changes, say so; then pnpm build regenerates the plugin bundle).

Arms: sonnet-plain (baseline refactor pass, concept skills, grep); haiku-metrics-primer (the scout alone); haiku-scout-sonnet-filter (the user's pipeline: the Haiku scout's suggestions handed to a Sonnet reviewer-style filter that only marks each one file-it or drop-it and never folds it into a merge verdict; scored on what survives the filter); sonnet-spawns-haiku-scouts (one Sonnet session delegating the neighbourhood survey to Haiku subagents through the Agent tool, invalid unless a Haiku subagent shows in the transcript). Score per arm: expected improvements kept, false findings kept, total cost per case (both stages for the pipeline). Also report anchoring: how much of the filtered list is the scout's list unchanged.

Pre-register before any paid run in the evals doc (its own section): case set and sources, arms, runs per cell, a 051-style decision rule (per category, overall never overriding a category) adapted to kept improvements and kept false findings, the existing stop rule (pilot the baseline; saturation or floor means rework the cases), and caps the user sets in the session. Commit with pnpm verify green on that commit and name it as the measured commit. Hand the user the $0 preflight, pilot and paid-run commands for a plain terminal; record the results, a confidence level and a recommendation: whether a Haiku refactor scout ahead of a Sonnet reviewer is worth adding to the workflow, and in which form. Bench code, bench tests, the bench README and the evals doc only; any change in the maestro repo (adding the agent or the step to the workflow) is its own ticket there.

## Acceptance criteria

- [ ] The case set has reverted real refactors (each naming its source commit), seeded structural problems and clean neighbourhoods; graders are unit-tested against known-good and known-bad output
- [ ] A deterministic $0 metrics primer is stored per case and checked for drift offline
- [ ] Arms sonnet-plain, haiku-metrics-primer, haiku-scout-sonnet-filter and sonnet-spawns-haiku-scouts run; the pipeline is scored on what survives the filter with both stages' cost; spawn runs are invalid without a Haiku subagent in the transcript
- [ ] docs/evals.md pre-registers the set, arms, runs per cell, decision rule, stop rule and the user's caps in a commit with pnpm verify green, named as the measured commit
- [ ] After the user's paid run, docs/evals.md records kept improvements, kept false findings, cost per case, anchoring, verdicts, a confidence level and a recommendation on adding a Haiku refactor scout ahead of the Sonnet reviewer
- [ ] node --test bench/*.test.mjs is green; nothing in the maestro repo changes

## Touched surfaces

- bench/ (refactor mode, cases, graders, metrics primer, tests; reuses the review bench runner)
- bench/README.md
- docs/evals.md (shared doc, new section)
- shares the bench runner and docs/evals.md with 069: this ticket merges first; 069 is blocked by it

## Blocked by

- `067-record-the-reviewer-bench-pilot-and-paid-run-results-and-recommend-a-reviewer-setup.md`

## Post-Mortem

- **Problem:** The grader wording took six fix rounds (false findings scored only on clean cases; an unstructured answer graded as a valid zero; all-clear formatting bias; phrase lists swallowing real proposals; dashless shaped lines dropped; two edge defects, then a regression in that fix). Each was a result-changing grader bug found by @reviewer or @test, not by the first build.
  **Fix:** none
- **Problem:** The first case set was saturated (baseline 8/8), so the first pilot and $1.525 bought no comparison. Every expected improvement was one copied function readable from the file the agent was pointed at.
  **Fix:** none
- **Problem:** The original pilot gate ("saturated if the baseline misses fewer than 3") would fire on nearly any result once only 5 improvements were expected; the amendment replaced it with a floor / no-signal gate.
  **Fix:** none
- **Problem:** Cost per session was unknown when the caps were set; the full design (132 cells) did not fit the $7 paid-run cap and was cut to 36 cells after the pilot.
  **Fix:** none
