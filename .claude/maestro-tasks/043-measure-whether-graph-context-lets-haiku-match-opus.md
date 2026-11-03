# Measure whether graph context lets Haiku match Opus

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Tickets 039, 041 and 042 (`docs/evals.md`) found that on Opus 5.5 neither the graph nor concept
skills cut cost on maestro questions:
- Opus scores near full marks with Grep alone.
- Even the graph's answer pasted into the prompt (041's oracle arm) cost 3% more, because Opus
  re-checks it.

The open question is a different value: can graph context let a cheaper **Haiku 5.5** subagent reach
Opus-level answers? Haiku is more likely to miss a second-level caller or the few real calls among many
Grep hits. If it does, the gain shows up as accuracy, and the saving is the price gap between the
models.

**First step: fix the fragile Bash rule.**
- Today any non-zero Bash exit invalidates a run. 042 lost m2 noskills run 1 this way: a `sed`
  inside a chained command exited 1.
- Haiku will slip more often, so change the rule:
  - a non-zero exit from a read-only `grep`, `sed`, `rg`, `cat`, `head`, `tail`, `ls` or `find`,
    alone or in a chain, is recorded but doesn't invalidate the run;
  - seccomp, a code-graph exit outside 0/4/6/7, and any other failing command still invalidate.
- Add unit tests for both sides.

**Arms**, all on `--model claude-haiku-5-5`, using the existing `bench/` arms:
- `nograph`: maestro's concept skills plus Grep. This is the baseline.
- `oracle`: the stored graph output pasted after the question. This is the best possible
  starting context.
- `graph`: the code-graph plugin. Does Haiku pick and use the retrieval skill on its own?

**Questions:**
- m1–m7, which already have expected answers, `must` regexes and stored oracle output.
- Do not add or change questions or graders.
- s1–s3 are out (they have no oracle output).

**Opus reference.**
- Take Opus's pass rate and cost per question from the 039 and 041 runs already in
  `bench/results/`.
- For m1–m5, Opus has no oracle run: use its `nograph` and `graph` arms only.
- Label it plainly as a reference from separate invocations, not a paired comparison.

**Decision rule, written into `docs/evals.md` before the paid run:**
- **Graph context helps Haiku** if `oracle` scores clearly above `nograph` on pass rate: at least 3
  more `must` hits over the whole set, with no question going the other way in both runs.
- **It matters** only if Haiku `oracle` comes within 10% of Opus's pass rate at less than half of
  Opus's cost per question.
- If `oracle` doesn't beat `nograph`, no starting context will. Say so, and say there is no reason to
  build a primer.

**Paid run:**
- Run the `--init-check` preflight first, with Haiku.
- The user runs everything from a plain terminal: Haiku 5.5, 3 arms × 7 questions × 2 runs = 42
  runs, total cap $4.
- Usage-limit (429) runs are not counted; rerun them with `--rerun`.
- If more than two runs are invalid for any other reason, stop and report.

**Report.** Per question and arm:
- cost, turns, tokens, tool counts and pass rate;
- whether the graph arm loaded the retrieval skill and called the CLI;
- the Opus reference beside it;
- a plain verdict against the decision rule, with confidence at n=2.

Write it into `docs/evals.md` as a "Ticket 043" section.

**If the verdict is positive,** the user decides on the follow-up: a realistic primer, built
automatically from the task text at subagent start and measured the same way. Not in this ticket.

Out of scope:
- changes under `plugin/` or `packages/`, and a version bump;
- new questions, the skills/noskills arms, enrichment;
- building any primer, hook or dispatch change.

## Acceptance criteria

- [ ] Read-only `grep`/`sed`/`rg`/`cat`/`head`/`tail`/`ls`/`find` failures no longer invalidate a run; other failures still do; unit tests cover both
- [ ] Decision rule written in `docs/evals.md` before the paid run
- [ ] Haiku `--init-check` preflight passes for all three arms
- [ ] User-run paid run (Haiku 5.5, m1–m7, `nograph`/`oracle`/`graph`, 2 runs, cap $4), with every counted run valid and usage-limit runs rerun
- [ ] `docs/evals.md` has the per-question table with the Opus reference and a verdict against the rule
- [ ] `node --test bench/lib.test.mjs` and `pnpm check` green

## Blocked by

None - can start immediately.
