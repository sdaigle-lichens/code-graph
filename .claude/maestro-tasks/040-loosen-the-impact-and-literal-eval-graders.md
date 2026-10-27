# Loosen the impact and literal eval graders

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

In the 0.3.28 pilot (`plugin/evals/results/2026-10-27T14-02-39-590Z/`, written up in
`docs/evals.md` under "Ticket 037"), two with-plugin runs failed on grading, not on the answer:

- **`02-impact-movetask`, with-plugin run 2.** The answer named both real callers of `moveTask`
  (`useDragReorder` in `src/board/useDragReorder.ts:13`, `notifyOverdue` in
  `src/reminders/notifications.ts:20`) and added a "docs and generated files that would go stale" list
  (`skills/*/SKILL.md`, `scribe-output/*.json`). All three judge votes were FAIL, most likely because
  the grader reads those extras as invented files.
- **`07-neg-literal`, with-plugin run 1.** The answer found all three TODOs at the right files and lines
  but reworded two of the comment texts. The grader quotes the exact text and calls a mismatch
  "invented".

Change only the two `graders/answer.md` files:
- **impact:** PASS still requires both real callers. Mentioning real docs, skills or generated files
  that would go stale is fine. FAIL only for missing a caller, or for a caller, file or function that
  doesn't exist in the workspace.
- **literal:** PASS requires the three file:line locations. The comment text may be paraphrased as long
  as it means the same thing. FAIL for a missing location or a TODO that doesn't exist.

Check against the kept answers. The failing evidence for both runs is in that results directory's
`aggregate-result.json` (`cases[].arms.with[].graders[].evidence`). Reason through each failing answer
and one passing answer against the new wording, and record the reasoning in the report. No paid run is
needed. If the user wants confirmation, the eval command limited to these two cases at `--runs 1` is
enough.

Out of scope:
- other cases and graders;
- the fixture, `plugin/skills/**` and `packages/`;
- a version bump (eval files only).

## Acceptance criteria

- [ ] `02-impact-movetask/graders/answer.md` accepts extra real stale-doc mentions and still fails a missing or invented caller
- [ ] `07-neg-literal/graders/answer.md` accepts paraphrased TODO text at the right locations and still fails a missing or invented TODO
- [ ] The two failing pilot answers would pass under the new wording, and a passing one still passes (reasoned in the report)
- [ ] `docs/evals.md` notes the change next to the pilot's failure bullets
- [ ] pnpm check green

## Blocked by

None - can start immediately.
