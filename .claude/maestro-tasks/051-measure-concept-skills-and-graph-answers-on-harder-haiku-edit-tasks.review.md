# Manager review, ticket 051 (round 1)

## Goal
Prepare a harder Haiku edit-task bench (four arms, graders, oracle captures, tests) and a pre-registered decision rule in `docs/evals.md`, then stop for the user's paid pilot. No paid run has happened.

## Done
- Four new cases with `sets: ["051"]` (t3-test-session-sweep, t4-test-channel-lanes, d3-scribe-channel-age-cap, d4-scribe-sweep-idle-cap). d2 (stale cap in `maestro-manager/SKILL.md` frontmatter) is kept as the deliberate hard case, in sets 044 and 051. The set is 36 points per run.
- Arms `haiku-noskills` and `haiku-oracle` added next to `haiku-nograph` and `sonnet-nograph`. Init-event checks and a prompt-problem guard stop a run whose setup is wrong.
- Reference solutions and stored oracle graph output for the new cases (and d2).
- `docs/evals.md` "Ticket 051" section, no results. Decision rule: $8 cap incl. $2 pilot, `--run-budget 0.75`. Skills help if haiku-nograph >= 1.15x haiku-noskills. Graph answers help if haiku-oracle >= 1.15x haiku-nograph. No gap to Sonnet if < 5% of Sonnet's points; otherwise an arm closes the gap if it recovers at least half at under half of Sonnet's cost. A task saturated in every arm is dropped after the pilot; fewer than three unsaturated tasks means stop and report.
- `node --test bench/lib.test.mjs`: 93 pass. Edit-check graders behave on set 051.

## Deviations
- The oracle for d2, d3 and d4 is thin: constants are not graph vertices, so the stored output is the impact of the reader function and does not reach the docs. The graph-answer question rests mostly on t3 and t4.
- `pnpm check` fails here on a sandbox lockfile read error; `check-versions` and `check-plugin-clean` pass when run directly. `--init-check` not run (needs `claude`, blocked by the sandbox).

## Decisions
- Used `--only` once per kept task in the paid-run command, since `--only` takes one substring.
- Did not touch the MAESTRO_DIR default (053's territory). Commands in `docs/evals.md` still set `MAESTRO_DIR` by hand; reconcile with `maestroFor` after 053 merges.

## Touches
`bench/cases.json`, `bench/lib.mjs`, `bench/run.mjs` (small additive edits), `bench/lib.test.mjs`, `bench/README.md`, `bench/edit/ref/`, `bench/oracle/`, `docs/evals.md`. Overlap with 053 expected in `bench/run.mjs` and `bench/README.md`.

## Sibling impact
053 adds `bench/maestro-dir.mjs` and edits `run.mjs` and `README.md`: a small merge overlap. No other ticket is affected.

## Questions
- Is a thin oracle for d2, d3 and d4 acceptable, or should the pilot also test a richer oracle there?
- Is the 1.15x threshold for both "skills help" and "graph answers help" the direction you want?
