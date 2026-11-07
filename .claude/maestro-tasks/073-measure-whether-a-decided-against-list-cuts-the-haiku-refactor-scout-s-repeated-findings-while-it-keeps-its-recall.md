# Measure whether a decided-against list cuts the Haiku refactor scout's repeated findings while it keeps its recall

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The 071 audit found the scout's findings are nearly always true but often not worth doing, and the same issues come back run after run (the findMaestroTasks duplicate and the atomic write copies each appeared three times in the hand pool). The idea to test: a decided-against list, where a person or the reviewer declines a finding, the scribe only records it (it never judges), and the scout is told about those decisions so it stops repeating them. Extend the existing refactor bench with one new arm: the scout with its usual metrics primer plus the decided-against entries for files in the case's neighbourhood, against the plain scout as the control, on the 071 cases and the pinned maestro tree. Each entry holds the code it is about (a graph vertex or file plus its contentHash), the declined claim and the reason. An entry expires when its code's contentHash changes, and only entries for files in the neighbourhood are injected, so the prompt stays small. Build the list by hand once, from proposals in the 071 paid run that are not expected improvements; the scribe recording step itself is not measured. The list must be generated at $0, stored and committed beside the other bench inputs, and pre-registered before any run. It must never be built from the scoring of the new runs. Expected improvements stay out of the list, so any recall loss shows over-broad suppression rather than a planted conflict. Pre-register in the evals doc the cases, arms, runs per cell, caps ($2 total including any pilot, unless the user sets another figure), the stop rule and a decision rule: how far repeats of listed findings must fall, how much expected-improvement recall the arm may lose, and how new findings are counted. Offline tests must cover the injection (neighbourhood only) and the expiry (a changed contentHash drops the entry). No paid run is started by the agent: the user runs the pilot and paid run, and recording the results is a follow-up ticket. Bench code, tests and docs only: no change to packages/code-graph/src unless a needed value cannot be read from the CLI (then say so, and the bundle is regenerated). Nothing in the maestro repo changes.

## Acceptance criteria

- [ ] The bench has a scout arm with the decided-against list, scored against the plain scout on paired cells, and a dry run and $0 preflight pass
- [ ] The stored list holds entries with code reference, contentHash, claim and reason, contains no expected improvement, and is committed before any paid run
- [ ] Offline tests prove only neighbourhood entries are injected and a changed contentHash drops an entry
- [ ] The evals doc pre-registers cases, arms, runs, caps, stop rule and decision rule, and names the measured commit
- [ ] The exact pilot and paid-run commands are written for the user; no paid run is started by the agent and nothing in the maestro repo changes

## Touched surfaces

- bench/refactor.mjs, bench/refactor-run.mjs, bench/refactor-prep.mjs, bench/refactor-cases.mjs
- bench/refactor/ (generated, committed)
- bench tests
- docs/evals.md
- bench/README.md

## Blocked by

- `072-record-the-071-refactor-scout-pilot-and-paid-run-results-and-recommend-which-form-joins-the-workflow.md`
