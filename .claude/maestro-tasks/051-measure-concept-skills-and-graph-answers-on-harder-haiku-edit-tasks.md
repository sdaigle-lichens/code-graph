# Measure concept skills and graph answers on harder Haiku edit tasks

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Ticket 044 (`docs/evals.md`, "Ticket 044 → Results") found no gain from the graph for Haiku on edit tasks, and Haiku without the graph matched Sonnet at about 1/9 of the cost. Two gaps make that weak: the task set saturated (both test tasks 20/20 in every arm, d1 47/48), and the haiku-graph arm never called the code-graph CLI, so it measured discovery, not whether graph answers help. Also, every 044 arm had maestro's concept skills, and ticket 041 only measured skills vs no skills on Opus answering questions, not on Haiku edits.

Build a harder edit-task set (test and scribe work at the same maestro pin) that does not saturate, keeping 044's d2 shared miss (the stale cap in `maestro-manager/SKILL.md`'s frontmatter description) as a deliberate hard case. Run it with four arms:
- `haiku-noskills`: concept skills stripped with `bench/strip-concept-skills.mjs`;
- `haiku-nograph`: concept skills, no plugin (044's baseline);
- `haiku-oracle`: concept skills plus stored graph output for the task pasted as context (as in 043's oracle arm, adapted to edit tasks);
- `sonnet-nograph`: the reference.

This is bench code and cases (new arms, cases, graders, oracle captures, tests in `bench/lib.test.mjs`), a pre-registered decision rule in `docs/evals.md` written before any paid run, and the results written there afterwards. Following the epic's decisions, paid runs are user-run from a plain terminal with a cap and a $0 preflight and pilot first; the ticket prepares everything and stops for the user to run them. Decide with the user, from a pilot, which tasks discriminate before the paid run.

Out of scope: changes in `~/gits/maestro`, a primer (its own ticket), output trimming.

## Acceptance criteria

- [ ] A harder edit-task set exists in `bench/cases.json` whose pilot does not saturate every arm, with d2's frontmatter miss kept as a hard case
- [ ] The four arms run; init-event checks confirm skills are absent only in `haiku-noskills`, the oracle context only in `haiku-oracle`, and no code-graph plugin in any arm
- [ ] The decision rule (cap, thresholds for "skills help", "graph answers help" and "gap to Sonnet") is written in `docs/evals.md` before the paid run
- [ ] After the user's paid run, `docs/evals.md` records results per task and arm and a plain verdict on each of the three questions with confidence
- [ ] Bench tests pass (`node --test bench/`)

## Blocked by

None — can start immediately
