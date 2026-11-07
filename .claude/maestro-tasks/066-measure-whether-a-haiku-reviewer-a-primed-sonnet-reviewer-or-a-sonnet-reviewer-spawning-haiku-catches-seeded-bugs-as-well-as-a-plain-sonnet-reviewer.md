# Measure whether a Haiku reviewer, a primed Sonnet reviewer or a Sonnet reviewer spawning Haiku catches seeded bugs as well as a plain Sonnet reviewer

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Extend the user-run bench (claude -p, maestro pinned, maestro path from maestroFor in the bench's maestro-dir module) with a code-review mode, then plan, pilot and report a paid run the user starts from a plain terminal.

Task set: review diffs on the pinned maestro checkout with known planted bugs, in two categories scored separately: (a) local logic bugs that need judgment (wrong condition, off-by-one, missed edge case, race) and (b) cross-file breakages the graph can see (a changed signature or behaviour that breaks a caller, a new cross-concept edge, a caller left untested). Include clean diffs with no planted bug to measure false alarms. Each case has a grader that decides from the review text whether each planted bug was named (file plus the defect) and counts findings on clean diffs as false alarms.

Arms: sonnet-nograph (baseline: Sonnet 5.5, maestro's concept skills, grep); sonnet-diff-primer (Sonnet plus a deterministic primer generated at $0 from the diff: impact of each changed symbol, cross-concept relations of the touched concepts, untested callers, new cross-concept edges, taken from the code-graph CLI); haiku-diff-primer (Haiku 5.5 with the same primer); sonnet-spawns-haiku (Sonnet reviewer told to hand the impact and blast-radius pass to a Haiku subagent through the Agent tool and then judge itself; subagents can spawn subagents at the default depth, so a run is invalid unless its transcript shows a Haiku subagent actually spawned). Optionally haiku-nograph as a cheap extra reference.

Before any paid run, write into the evals doc: the task set, arms, cap, and a pre-registered decision rule in the style of 051 (an arm helps when it recovers at least a third of the baseline's missed bugs and at least 3; under 3 missed is inconclusive; verdicts per category and overall, the overall never overriding a category; false alarms and cost per run reported beside each verdict). Run a $0 preflight per arm checking the init event (model, tools, Agent available in sonnet-spawns-haiku, concept skills present, code-graph only where intended), then a small pilot, then hand the paid-run command to the user. After the paid run, record results, verdicts and confidence, and end with a recommendation for the reviewer agent: Sonnet plain, Sonnet plus primer, Haiku plus primer, or Sonnet spawning Haiku.

Keep the primer generator in the bench if possible. If it has to land in the code-graph package source, rebuild the package and regenerate the committed plugin bundle (pnpm build, which runs pnpm bundle) and check the bundle diff. Includes bench code, bench unit tests, the bench README and the evals doc. Out of scope: any change in the maestro repo (a reviewer model or workflow switch there is its own ticket in that repo), embedding ranking, an MCP server.

## Acceptance criteria

- [ ] The bench has a review mode with a seeded-bug task set covering both categories (local logic, cross-file breakage) and at least one clean diff, each with a grader; graders are unit-tested against a known-good and a known-bad review text
- [ ] Arms sonnet-nograph, sonnet-diff-primer, haiku-diff-primer and sonnet-spawns-haiku run (haiku-nograph optional); the diff primer is generated deterministically at $0 and its output per case is stored and reviewable
- [ ] A sonnet-spawns-haiku run is marked invalid unless its transcript shows an Agent call that started a Haiku subagent
- [ ] The evals doc holds the task set, arms, cap and pre-registered decision rule in a commit made before the paid run
- [ ] $0 preflight passes for every arm and a pilot result is recorded before the paid-run command is handed to the user
- [ ] After the user's paid run, the evals doc records per-category and overall bugs found, false alarms, cost per run, the verdicts under the pre-registered rule, a confidence level, and a reviewer recommendation
- [ ] node --test bench/*.test.mjs is green; if the code-graph package source changed, pnpm build ran and the regenerated plugin bundle is committed
- [ ] No file in the maestro repo is changed

## Touched surfaces

- bench/ (new review mode, cases, graders, primer script, tests)
- bench/README.md
- docs/evals.md (shared doc)
- packages/code-graph/src/ and plugin/scripts/code-graph.cjs (generated) only if the primer cannot stay in bench/
- versions: none expected; if src changes, whoever merges bumps

## Blocked by

None — can start immediately

## Post-Mortem

- **Problem:** First backend pass missed the saturation guard and a verified commit; manager redirected (m007).
  **Fix:** none
- **Problem:** @test found four defects (lax spawn validity, grader cross-credit and absent-defect credit, silent --dry on a broken checkout, doc/code mismatch on partial passes), and the reviewer found pilot budget and rule-text gaps; pre-registration text was edited three times.
  **Fix:** none
