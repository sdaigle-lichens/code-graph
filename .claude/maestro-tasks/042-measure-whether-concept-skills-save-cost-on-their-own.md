# Measure whether concept skills save cost on their own

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Every paid run so far has had concept skills in both arms, so their own value has never been
measured. The only hint is m4 in ticket 039 (`docs/evals.md`, "Ticket 039"):
- the arm that loaded the `installing-maestro` concept skill cost 16% less for the same 18/18 answer;
- the other arm had the skill available but never loaded it.

If the retrieval side is dropped, concept skills are what code-graph ships. Measure them directly
against no concept skills.

**Arms.** Add two arms to `bench/`:
- **`skills`:** the current `nograph` workspace (maestro's concept skills, no plugin, no
  `scribe-output/`).
- **`noskills`:** the same workspace with every skill carrying the concept-skill marker
  (`metadata.type: concept-skill`) removed from `.claude/skills`. Other project skills stay, so
  concept skills are the only difference.
- The init event must list the concept skills in `skills` and none of them in `noskills`. Neither
  arm loads code-graph.

**Questions.** 5 or 6 questions on maestro pinned at `3814a30`:
- 2 or 3 from m1–m5, including m4;
- 3 new ones where a concept skill should help: "how does X work", "where would I change Y", or a
  convention or invariant the code doesn't spell out.
- Each new question needs:
  - a written expected answer;
  - `must` regexes;
  - a note naming the concept skill that covers it and what it gives the model.
- The user approves the final set before any paid run. Note the selection bias: the questions are
  chosen where skills should help.

**Paid run.**
- User-run from a plain terminal: Opus 5.5, 2 runs per arm, total cap $7. Both arms run fresh, in the
  same invocation.
- Usage-limit (429) failures are not counted and are rerun as a separate invocation.
- If more than one run is invalid for any other reason, stop and report.

**Report.** Per question and arm:
- cost, turns, tokens, tool counts and pass rate;
- whether the relevant concept skill was loaded in the `skills` arm;
- a plain verdict: do concept skills save cost or improve answers, by how much, with what confidence
  at n=2.

Write the result into `docs/evals.md` as a "Ticket 042" section.

Out of scope:
- changes under `plugin/` or `packages/`;
- changes to maestro's skills (read-only, `git archive` as in 039);
- the graph and oracle arms;
- other models, a version bump.

## Acceptance criteria

- [ ] `bench/` has `skills` and `noskills` arms, with unit tests in `bench/lib.test.mjs`; the init events confirm concept skills load only in `skills`, and code-graph loads in neither arm
- [ ] 5 or 6 questions with expected answers and `must` regexes, approved by the user
- [ ] User-run paid run (2 runs per arm, cap $7), with every counted run valid and usage-limit failures rerun separately
- [ ] `docs/evals.md` has the per-question table and a plain verdict
- [ ] `node --test bench/lib.test.mjs` and `pnpm check` green

## Blocked by

- `041-measure-the-best-case-saving-if-graph-answers-were-free-to-get.md` (both change the bench arms and cases; the paid runs also run one after the other, so they don't share a usage limit)

## Post-Mortem

- **Problem:** @reviewer FAILed the first pass: the s3 `must[4]` regex copied the task-queue skill's own wording ("not generated", "hand-maintained"), so it rejected correct paraphrases ("not auto-generated", "except") that the noskills arm was likely to write, which skewed grading toward `skills` before any paid run. Fixed by widening the regex and adding a paraphrase test.
  **Fix:** none
- **Problem:** the $0 `--init-check` preflight couldn't run in the sandbox (`claude` is not on PATH), so @test and @reviewer could only confirm the init events from code; they were first observed in the user's paid run.
  **Fix:** none
