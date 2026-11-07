# Record the 073 decided-against pilot and paid-run results and say whether the list joins the scout proposal

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

ON HOLD: not to be started until the user says the 073 paid run is done, or that the stop rule ended the study at the pilot.

Ticket 073 built and pre-registered the decided-against bench (measured commit 76cb516, named in 00c1949), but its results could only come after the user's own run. This ticket does that step and nothing else. Take the pilot and paid-run outputs and result files the user names, and record in the Ticket 073 section of the evals doc: repeated entries, expected improvements found, new findings and cost per arm, the verdict from the pre-registered decision rule, any cost-estimate miss against the pilot, a confidence level, and whether the decided-against list should join the workflow proposal sent to the maestro session.

Apply the pre-registered rule as written: any reading beyond it is labelled as post hoc and never changes a verdict. Docs only; no bench, grader or list changes unless a bug in the report stops it running, and no new paid run. Any change in the maestro repo is its own ticket there.

## Acceptance criteria

- [ ] docs/evals.md records repeats, recall, new findings, cost, the verdict, a confidence level and a recommendation for the list
- [ ] The verdict follows the pre-registered rule; any further reading is labelled post hoc
- [ ] No paid run is started by the agent; nothing in the maestro repo changes

## Touched surfaces

- docs/evals.md (Ticket 073 section)

## Blocked by

- `073-measure-whether-a-decided-against-list-cuts-the-haiku-refactor-scout-s-repeated-findings-while-it-keeps-its-recall.md`
