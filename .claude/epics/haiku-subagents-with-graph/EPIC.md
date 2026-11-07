# Epic: haiku-subagents-with-graph

## Goal

Make code-graph context lift Haiku subagents (maestro's test and scribe already run on Haiku) toward Sonnet-quality work at Haiku cost, and get the plugin's retrieval as close to frictionless as the oracle ceiling measured in absorb-concept-skills.

## Background

This epic starts from the measurements of epic `absorb-concept-skills` (tickets 039, 041, 042
and 043). Its `EPIC.md` "Status: closed" section holds the summary, and `docs/evals.md` has the
details. Go there for more context.

- On Opus 5.5 the graph doesn't cut cost on read-only questions.
- On Haiku 5.5, on m1–m7:
  - the oracle (best-case graph output pasted in) scored 108/108;
  - the plugin as shipped scored 107/108;
  - without the graph it scored 91/108;
  - all at about 3% of Opus's cost.
- What's left between the plugin and the oracle is cost (+24%), mostly from 10–15k-char CLI output
  on cross-concept questions.
- In `~/gits/maestro`, `.claude/agents/test.md` and `scribe.md` set `model: claude-haiku-5-5`.

## Scope

In:
1. Measure whether the graph improves Haiku's test and scribe work, with Sonnet 5.5 as the
   reference.
2. Cut retrieval friction toward the oracle ceiling: trim cross-concept CLI output, then possibly a
   primer built from the task text at subagent start. Measure each step.
3. Recommend, per agent, Haiku with the graph or Sonnet.
4. The reviewer (user, 2026-11-05): measure on seeded-bug review diffs whether a deterministic
   diff primer (`impact`/`cross` on the changed symbols) or a Sonnet reviewer spawning a Haiku
   helper lets review match or beat a plain Sonnet reviewer, scoring bugs found, false alarms
   and cost.
5. The refactor agent (user, 2026-11-05): measure whether a cheap Haiku refactor scout with a
   $0 graph-metrics primer, filtered by the Sonnet reviewer (file-it or drop-it, never part of the
   merge verdict), finds code-structure improvements as well as a Sonnet refactor pass at lower
   total cost (ticket 070).

Out: changes in `~/gits/maestro` (any model switch there is its own ticket in that repo);
embedding ranking; an MCP server.

## Merge plan

Every earlier ticket (044–054) is done and merged; only 066 is open.

| Order | Task | Base | Version bump | Shared surfaces |
|---|---|---|---|---|
| 1 | 066 reviewer seeded-bug bench (done, committed on main: 0447717, 1064e82, 9aa30b7) | main | none (no src change) | `docs/evals.md`, `bench/README.md` |
| 2 | 068 harden review cases, drop spawn arm, more runs | main | none (bench only) | `docs/evals.md`, `bench/README.md`, `bench/review/` (generated) |
| 3 | 067 amendment (Sonnet vs Haiku only), paid-run handoff, then results | main | none | `docs/evals.md`, `bench/README.md`, bench default arms |
| 4 | 070 Haiku refactor scout + Sonnet filter (started 2026-11-05) | main | none unless a metric needs src (then whoever merges bumps) | `docs/evals.md`, `bench/README.md`, bench runner |
| 5 | 071 scout with batched or reviewer-inline Sonnet filter | branch `haiku-subagents-with-graph` | none unless a metric needs src (then whoever merges bumps) | `docs/evals.md`, `bench/README.md`, `bench/refactor/` (generated) |
| 6 | 072 record the 071 results (done, 84785d3) | branch `haiku-subagents-with-graph` | none | `docs/evals.md` |
| 7 | 073 decided-against list for the scout (built, 76cb516, 00c1949) | branch `haiku-subagents-with-graph` | none unless a value needs src (then whoever merges bumps) | `docs/evals.md`, `bench/README.md`, `bench/refactor/` (generated) |
| 8 | 074 record the 073 results (done, 68fcadc) | branch `haiku-subagents-with-graph` | none | `docs/evals.md` |
| 9 | 075 ship the scout as a plugin skill (filed, not started) | `main` once the user's PR of this branch lands (the primer builder it ports lives in `bench/` here) | 075 bumps | `plugin/scripts/code-graph.cjs` (generated), the three version files, `docs/usage.md`, `bench/refactor.mjs` if the primer builder is shared |

069 was dropped, not built (user, 2026-11-06). The epic's work lives on branch
`haiku-subagents-with-graph` (created from main at 5323c6e, not pushed).

## Decisions

- The reference model is Sonnet 5.5, not Opus (user, 2026-10-28).
- Paid bench runs are user-run from a plain terminal, each with a cap and a decision rule written
  into `docs/evals.md` before the run.
- Ticket 044 first: no friction work until edit-style tasks show a gain.
- Tickets that change `packages/code-graph/src/` must say the plugin bundle is regenerated
  (`pnpm bundle`) even when the bundle is otherwise out of scope (046, report r001).
- `just eval` and `just regraph` rebuild a stale `dist/` themselves (046).
- 044 verdict (user, 2026-10-30): no gain from the graph on edit tasks, and Haiku without the graph
  already matches Sonnet; but the set saturated and the graph arm never called the CLI. Next: a
  harder edit set with arms `haiku-noskills`, `haiku-nograph`, `haiku-oracle`, `sonnet-nograph`,
  which also tests concept skills on Haiku edits (041 only covered Opus questions). A primer only
  if the oracle shows a gain. Output trimming is dropped for now: Haiku never ran the CLI on edits.
- Bench tests run as `node --test bench/*.test.mjs` (the directory form fails on Node 25), and
  the maestro path comes from `bench/maestro-dir.mjs` (`maestroFor`), never a new default (053).
- 051 decision rule (pre-registered): an arm helps when it recovers at least a third of the
  baseline's missed points and at least 3; under 3 missed is inconclusive; verdicts per group
  (test, scribe) and overall, the overall never overriding a group.
- Scribe-side limit found in 051: docs outside every concept's globs never appear in graph
  output, and `search` reaches a concept's SKILL.md but not the stale lines in it. A primer
  (052) can only give what the oracle shows.
- 051 result (paid run bdfb1d2, $1.43 incl. pilot; Sonnet dropped from the paid run): oracle ties
  Haiku without the graph (100 vs 100 of 120, ~11% costlier), so no support for the 052 primer;
  skills effect not shown (test group saturated, scribe confounded by the strip deleting the
  edited SKILL.md files); no gap to Sonnet.
- After 051 (user, 2026-10-30): 052 stays on hold. The tracker shows it ready, but it is not to
  be spawned until a later measurement shows a gain. A fair scribe-side skills test (edited
  SKILL.md files kept on disk but not loadable as skills) is not filed for now.
- Concept skills stay; the push to use the graph before grep goes (user, 2026-10-30, ticket 054):
  no SessionStart context line, and code-graph-retrieval becomes user-run only, so the 043
  read-only gain stays one command away.
- 052 closed, not built (user, 2026-11-05, report r008): its gate failed (051 oracle 100 vs nograph
  100 of 120). The 051 section of `docs/evals.md` is the record; no separate 052 section. Reopen only
  if a later measurement shows graph answers beating nograph on edit tasks.
- code-review-graph (`~/gits/code-review-graph`, user question 2026-11-05): its "~63x fewer tokens"
  divides whole-repo tokens by one graph response, with no agent run; its changed-files benchmark
  shows the graph costing more than the files. No evidence against our end-to-end bench method.
- Subagents can spawn subagents (docs, default depth 3, `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`);
  maestro's `reviewer.md` sets no `tools` or `model`, so it inherits `Agent` and the session model.
- 066 (report r009): the review bench is pre-registered at 9aa30b7 (cap $10, pilot $1.50 in two
  parts, $0.40 per run, 2 runs per cell, user's choice); only paired cells count. 067 records the
  results. The tracker shows 067 ready, but it is not to be spawned until the user says the pilot
  (and, unless the stop rule fired, the paid run) is done.
- 066 pilot A (user, 2026-11-05, $0.335): sonnet-nograph 4/4 (2/2 local, 2/2 cross), no false
  alarm; stop rule fired for both categories. User chose to harden the cases (068), drop
  sonnet-spawns-haiku for now, add haiku-nograph as planned, spend the saving on more runs per
  cell for Sonnet vs Haiku, and maybe raise the budget a little (numbers decided in 068's session).
- 068 done (report r010): paid run measured against f214e33 (caps $13 / pilot $1.10 / $0.40 per
  run, 3 runs per cell, user-approved). f214e33 fixed a grader that credited wrong-file findings,
  so the 066 pilot A 4/4 may be partly inflated (moot: those cases were replaced). r-x3 and r-x5
  can be read off the changed line, so the cross category is softer than intended; the new pilot A
  samples r-x1 and r-x4 only. 067 stays held until the user reports the new pilot A.
- 068 pilot A (user, 2026-11-05, $0.467): sonnet-nograph 4/4 again (3–8 turns, 1 false alarm on
  r-c6); stop rule fired twice. User chose option A: no more hardening; 067 amends the plan to
  sonnet-nograph vs haiku-nograph vs haiku-diff-primer, "recovers" inconclusive in advance, only
  "hurts / no effect shown" decided, then records the paid run. Opus-authored hardening judged
  a weak lever (the task framing, not the author, makes the cases easy).
- 067 result (report r011, paid run review-2026-11-05T18-27-15-901Z, $3.363, 135/135 valid,
  measured commit 6fea03c, recorded in f9ae7e8): every arm found 30/30 (15/15 local, 15/15
  cross), so the set measures nothing about misses; Haiku is "no effect shown", never "hurts".
  False alarms on 15 clean reviews: sonnet-nograph 3, haiku-diff-primer 8, haiku-nograph 10.
  Cost per run $0.064 / $0.006 / $0.005. Confidence low. Manager reading: on these easy bugs the
  reviewers differ in false alarms, not in recall, and a reviewer's false alarm sends work back
  to the implementer, so Sonnet stays the reviewer; Haiku plus primer fits only an advisory
  pre-pass. Any model or workflow change is a ticket in the maestro repo.
- The reviewer stays on Sonnet (user, 2026-11-05, after 067).
- 070 (user, 2026-11-05): the user's target workflow is a cheap Haiku refactor agent running
  before the Sonnet reviewer on every task; the reviewer filters its suggestions into file-it or
  drop-it (a backlog, never the merge verdict). Scope per run is the change's graph neighbourhood,
  not the whole repo. Measured on combined cost (scout plus filter) against a Sonnet refactor pass,
  with kept false findings and anchoring reported. ON HOLD with 069; 069 gains the
  sonnet-spawns-haiku arm.
- 069 dropped, not built (user, 2026-11-06): the reviewer stays on Sonnet. Marked done in the
  tracker like 052; its task file says DROPPED.
- After 070 (user, 2026-11-06): test the cheaper forms in ticket 071 (Haiku scout with a batched
  or reviewer-inline Sonnet filter), with useful findings per dollar as the headline, harder
  cases, more runs and a $10 total cap including the pilot. Grader changes only for a bug that
  real output shows changes a result. The duplicates the 070 audit found went to the maestro
  manager session for a ticket in that repo.
- 070 started first (user, 2026-11-05): 069 now has `Blocked by` 070 and stays on hold after
  that until the user asks.
- 070 result (report r012, verified commit 5323c6e, paid run 36/36 valid, $3.198, study about
  $5.57 of $10): the pipeline is NOT recommended in its pre-registered form, confidence low.
  Expected kept / false findings / cost per run: sonnet-plain 6/10, 23, $0.139;
  haiku-metrics-primer 7/10, 38, $0.015; haiku-scout-sonnet-filter 6/10, 18, $0.112. The pipeline
  misses the 20% saving by one point (-19%, about +6% without case f-c1); the other three
  conditions pass. Anchoring 51%, no expected improvement lost to the filter. Recall inconclusive
  in every category. Blind audit: 68 of 79 false findings confirmed (plain 22/23, primer 31/38,
  pipeline 15/18), so the metric mostly counts extra proposals, not wrong ones. Spawn arm not run.
  Confirmed real duplicates in maestro are candidate tickets in that repo.
- 071 built (reports r013, r014): measured commit c850a00, named in f142006, `pnpm verify` green,
  231 bench tests; caps $0.60 per session, $3 pilot, $7 paid, $10 total; batch size 3. The tracker
  shows done, but the results criterion stays open until the user's paid run. Pilot review and
  batch costs are estimated from 070; the per-category miss check is manual.
- 071 pilot (user, 2026-11-06, refactor-2026-11-06T20-21-18-673Z, $0.812, 6/6 valid): sonnet-plain
  kept 6/11, 11 false findings, stop rule ok, mean $0.135 per session, so r = 2 (about $4.87).
  Baseline misses per category: dedupe 2, extract 1, align 2, all under 3, so a category loss count
  in the paid run reads as inconclusive; the overall figures are unaffected.
- 071 paid run (user, 2026-11-06, refactor-2026-11-06T20-32-24-067Z, $4.713 of $7, 48/48 valid,
  study $5.525 of $10). Kept / false / cost per run before the audit: sonnet-plain 12/22, 23,
  $0.171; haiku-metrics-primer 13/22, 42, $0.015; haiku-batched-filter 7/22, 13, $0.065;
  haiku-reviewer-inline 6/22, 11, $0.043. The filters lost 6 and 7 expected improvements; the
  list changed no review verdict (0 of 12). 072 released; it runs the audit and records verdicts.
- 071 result (reports r015, r016, commit 84785d3, `pnpm verify` green): useful per dollar
  sonnet-plain 17.1, haiku-metrics-primer 286 (better per dollar), haiku-reviewer-inline 33.1 and
  haiku-batched-filter 24.3 (no gain shown; the tool printed `blocked`, read as inconclusive by the
  pilot's under-3 category misses). Every category recall verdict is inconclusive. Confidence low
  to moderate. The audit confirms any true claim, so noise is near zero for every arm; the ratio
  measures accurate proposals, not valuable ones. 072 recommends the scout alone as an advisory
  list and neither filter. Whether it joins is the user's call, and a ticket in the maestro repo.
- After 072 (user, 2026-11-06): ticket 073 tests a decided-against list. A person or the reviewer
  declines a finding, the scribe only records it with its reason, entries expire when the code's
  contentHash changes, and only entries for the neighbourhood are injected.
- 073 built (reports r017, r018): measured commit 76cb516, named in 00c1949, `pnpm verify` green,
  244 bench tests. Set 073 has 5 cases and 14 hand-built entries; caps $0.15 per session, $0.50
  pilot, $1.50 paid, $2 total; runs per cell from {4, 5, 6}. The tracker shows done, but its results
  stay open until the user's run. 074 records them and is not to be spawned before then.
- 073 pilot (user, 2026-11-06, refactor-2026-11-06T23-36-42-976Z, $0.123, 10/10 valid): stop rule ok
  (plain scout repeated 8 listed entries), mean $0.0123 per session, so r = 6 (about $0.74). A rule
  input, not a result: repeats 8 to 0, expected found 5 to 2 of 8, new findings 12 to 9.
- 073 paid run (user, 2026-11-06, refactor-2026-11-06T23-50-00-772Z, $0.760 of $1.50, r = 6, 60/60
  valid; study $0.883 of $2): printed verdict "cuts repeats but loses recall": repeats 47 to 9 (81%
  cut), expected found 26 to 19 of 48 (73% of control, bar 90%), new findings 50 to 68.
- 073 result (074, 68fcadc, `pnpm verify` green, reports r019, r020 acked): the decided-against list
  does not join the scout proposal; the scout stays plain and advisory as 071 recommended. Confidence
  moderate. No further paid run on this design without a changed list or recall bar and its own
  pre-registration. Sent to `maestro-bf`.
- Maestro task 158 written by `maestro-bf` (ready, not implemented, reported 2026-11-07), the contract
  for any scout skill: it gets the path of a scope file, one repo-relative existing file per line.
  Epic start scope: `## Touched surfaces` entries that resolve to files. Epic end scope: existing files
  changed between the base commit recorded at the start and the merged result, so possibly wider than
  the epic's own work; no recorded commit falls back to Touched surfaces. Generated files are not
  filtered, so the scout must ignore what its index does not cover. No `decided-against` input. The
  skill spawns its own Haiku agent. 158 names no scout; the code-graph ticket is the user's call.
- Workflow proposal sent to the maestro session `maestro-bf` (user, 2026-11-06): a Haiku scout step
  feeds the Sonnet reviewer, which hands accepted items back to the implementer (only code the task
  changed, the rest to a backlog, one round at most); the refactor agent runs only for design-level
  changes, with an architect rename left to maestro. Its rework cost is unmeasured. Any change is
  a ticket in the maestro repo.
- Maestro's reply (`maestro-bf`, 2026-11-06): the refactor agent runs only on reviewer FAIL, not on
  every task (checked in `.claude/maestro.json`), so a per-task scout is a new cost, not a saving.
  Its counter-proposal: run the scout at epic start and end, findings go to a backlog the user
  triages, no hand-back, no reviewer intake, no architect rename. Maestro task 158 would add the
  manager skill lists; the scout skill would ship from code-graph. Not decided. The manager replied
  with its view and marked it as not the user's approval.
- Open gap from 066: no output-format docs for `query file|impact|cross` in the graph skills; left
  for a later scribe run, not filed.
