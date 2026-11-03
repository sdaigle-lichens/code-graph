# Primer from the task text at Haiku subagent start

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Only if the previous ticket's `haiku-oracle` arm shows a gain over `haiku-nograph` on edit tasks; if it does not, record that in `docs/evals.md` and the epic and close this ticket without building anything. Ticket 044 showed Haiku on edit tasks never calls the code-graph CLI on its own (2 of 8 runs loaded the retrieval skill, none acted on it), so the oracle's gain only reaches a subagent if the graph context arrives without being asked for.

Build a primer: from the task text at subagent start, run the graph retrieval and inject a bounded slice of its output as context, so the subagent starts close to the oracle. This is code in the code-graph package or plugin (how the primer is produced and injected, with tests), plugin hook or skill changes as needed, a regenerated plugin bundle (`pnpm bundle`) and a version bump if the plugin changes, plus a new bench arm `haiku-primer` on the previous ticket's task set, with its decision rule written in `docs/evals.md` before the user's paid run. Paid runs are user-run from a plain terminal with a cap.

Out of scope: changes in `~/gits/maestro` (wiring the primer into maestro's agents is that repo's ticket), output trimming, embedding ranking.

## Acceptance criteria

- [ ] If the oracle showed no gain: the decision is recorded and nothing else is built
- [ ] Otherwise: the primer injects bounded graph context from the task text at subagent start, with tests, bundle regenerated and versions in lockstep
- [ ] A `haiku-primer` arm runs on the previous ticket's set; the decision rule is in `docs/evals.md` before the paid run and the verdict after it (primer vs nograph and vs oracle, with confidence)
- [ ] `just eval` 7/7 and `pnpm check` green (or its parts, in the sandbox)

## Blocked by

- `051-measure-concept-skills-and-graph-answers-on-harder-haiku-edit-tasks.md`
