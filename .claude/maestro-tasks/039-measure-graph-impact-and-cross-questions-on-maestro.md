# Measure graph impact and cross questions on maestro

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

This ticket answers one question: on a real repo, does code-graph save cost where it should be
strongest? The places to look are "what breaks if I change Y" (`query impact`) and "how do A and B
interact" (`query cross`).

Evidence so far (`docs/evals.md`):
- On the small fixture, the plugin costs about 27% more and adds no accuracy.
- On maestro, Grep answered every question in the offline comparison, and `search` is weak because
  nothing is enriched.
- The one case where the graph was cheaper was an impact question (205 vs 2887 tokens, offline).
- No paid run has had working Bash.

Use the 038 runner (`bench/`) on maestro:
- **Snapshot:** maestro read-only, pinned at a commit that has its 0.3.27 `.ast.json` files committed.
  Ask the user which sha. Never write to `~/gits/maestro`: workspaces come from `git archive` into
  `$TMPDIR`.
- **Setup:** `apply` only, from the committed `.ast.json`, with no extract and no ts-morph. The no-graph
  arm gets the same tree without `scribe-output/graph.db`.
- **Arms:** maestro's own concept skills in both (its real `.claude/skills`, the realistic setup); the
  graph arm adds the code-graph plugin.
  - Confirm from the init event that both arms load the concept skills and only the graph arm loads
    code-graph.
  - If project skills don't load under the isolation flags, stop and report, rather than shipping them
    as a plugin.
- **Questions:** 4 or 5 impact and cross questions that maestro's concept skills don't already answer.
  Each needs callers spread across concepts, or an interaction between two concepts. Each question
  has:
  - a written expected answer;
  - `must` regexes for deterministic grading;
  - a note on why Grep should be expensive for it.
- **Offline proxy first ($0):** run the graph command the skill would pick for each question, and
  confirm the graph covers the answer. Drop questions it doesn't cover. The user approves the final
  set before any paid run.
- **Paid run:** user-run from a plain terminal, Opus 5.5, 2 runs per arm, total cap $6.
  - The 038 validity checks apply: a run with a Bash failure doesn't count.
  - If more than one run is invalid, stop and report; don't rerun on your own.

Report:
- per question and arm: cost, turns, tokens, tool counts, code-graph exits and output size, and pass
  rate;
- a plain verdict: does the graph save cost on these questions, by how much, and with what confidence
  at n=2.

The user then decides whether to:
- run an enrichment arm (enrich only the concepts these questions touch);
- add a Haiku 5.5 arm;
- stop investing in the retrieval side.

Write the result into `docs/evals.md`. Replace the provisional "Maestro benchmark findings" bullets
where they're superseded.

Out of scope:
- enrichment and extra models (the user decides after this);
- `search` questions (weak while un-enriched; covered by the offline finding);
- changes under `plugin/` or `packages/`;
- a version bump.

## Acceptance criteria

- [ ] Pinned maestro sha confirmed with the user; workspaces from `git archive`, nothing written in `~/gits/maestro`
- [ ] Init events confirm both arms load maestro's concept skills and only the graph arm loads code-graph
- [ ] 4 or 5 impact/cross questions with expected answers and `must` regexes, filtered by an offline proxy, approved by the user
- [ ] User-run paid run (2 runs per arm, cap $6) with every counted run passing the Bash validity check
- [ ] `docs/evals.md` has the per-question table and a plain verdict, and gives the user the stage-2 options above

## Blocked by

- `038-a-claude-p-runner-that-measures-graph-vs-no-graph-with-working-bash.md` (the runner and its working-Bash check)
- `037-stop-the-retrieval-skill-loading-when-a-concept-skill-already-locates-the-answer.md` (measure the narrowed trigger, not the old one)
