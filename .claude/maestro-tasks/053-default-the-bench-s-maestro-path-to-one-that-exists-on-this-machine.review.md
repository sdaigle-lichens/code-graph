## Goal
Make the bench's default MAESTRO_DIR work on this machine (~/Documents/gits/maestro), defined once for all three bench scripts, with a test and README update.

## Done
- New shared module `bench/maestro-dir.mjs`: explicit MAESTRO_DIR wins; else first of ~/Documents/gits/maestro, ~/gits/maestro containing .git; else one-line failure naming MAESTRO_DIR.
- `bench/run.mjs`, `bench/edit-check.mjs`, `bench/capture-oracle.mjs` use it (import plus one line each).
- New `bench/maestro-dir.test.mjs` (3 tests); one sentence in `bench/README.md`.
- bench tests pass 91/91 (run per file; `node --test bench/` errors on Node 25 when given the directory).

## Deviations
- New module instead of editing `bench/lib.mjs`, to avoid colliding with ticket 051 which edits lib.mjs.
- The scripts now exit at startup when no maestro checkout exists, even for runs that never use {MAESTRO}.
- `node --test bench/` as literally written in the ticket fails on Node 25; files are passed explicitly.

## Decisions
- Candidate order: Documents/gits first, then gits.

## Touches
bench/maestro-dir.mjs (new), bench/maestro-dir.test.mjs (new), bench/run.mjs, bench/edit-check.mjs, bench/capture-oracle.mjs, bench/README.md. All in the worktree code-graph-task-053; nothing committed.

## Sibling impact
Ticket 051 also edits bench/run.mjs and README in the main checkout; the import and default lines here may conflict on merge but are small.

## Questions
Is the startup exit when no maestro checkout exists acceptable for runs not using {MAESTRO}?
