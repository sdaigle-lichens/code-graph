Round 2

Previous manager note (m001, on-track): "resolving only when a run actually needs {MAESTRO} is preferred if it's a small change" and "for @reviewer: check whether the MAESTRO_DIR lookup can be lazy ...; and that the README states the Node 25 per-file test invocation". @reviewer returned FAIL on exactly those two points.
- Lazy lookup: addressed. `bench/maestro-dir.mjs` now exports `maestroFor(setup)`, which returns '' without a filesystem lookup when the setup has no `{MAESTRO}`. The three scripts call it where they fill `{MAESTRO}`; the startup constants are gone, so `run.mjs --dry` works with no maestro checkout.
- README Node 25 invocation: addressed. `bench/README.md` gives `node --test bench/*.test.mjs` and says `node --test bench/` fails on Node 25.

## Goal
Make the bench's default MAESTRO_DIR work on this machine (~/Documents/gits/maestro), defined once for all three bench scripts, with a test and README update.

## Done
- `bench/maestro-dir.mjs`: explicit MAESTRO_DIR wins; else first of ~/Documents/gits/maestro, ~/gits/maestro containing .git; else one-line failure naming MAESTRO_DIR; `maestroFor(setup)` makes it lazy.
- `bench/run.mjs`, `bench/edit-check.mjs`, `bench/capture-oracle.mjs` use it.
- `bench/maestro-dir.test.mjs`: tests for resolution, laziness, single-definition wiring and the real-process empty-HOME exit. `lib.test.mjs` still passes; 94 tests pass in total, run per file.
- `bench/README.md`: says how the path is found, that `--dry` needs no checkout, and the Node 25 test command.

## Deviations
- New module rather than editing `bench/lib.mjs`, to stay clear of ticket 051.
- Ticket's `node --test bench/` is replaced by `node --test bench/*.test.mjs` because the directory form errors on Node 25.

## Decisions
- Candidate order Documents/gits first, then gits (manager confirmed in m001).
- An explicit MAESTRO_DIR is never validated.

## Touches
bench/maestro-dir.mjs (new), bench/maestro-dir.test.mjs (new), bench/run.mjs, bench/edit-check.mjs, bench/capture-oracle.mjs, bench/README.md. All in worktree code-graph-task-053; nothing committed.

## Sibling impact
Ticket 051 also edits bench/run.mjs and README in the main checkout; small overlap, whichever lands second rebases.

## Questions
None.
