# Default the bench's maestro path to one that exists on this machine

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The bench scripts (`bench/run.mjs`, `bench/edit-check.mjs`, `bench/capture-oracle.mjs`) default `MAESTRO_DIR` to `~/gits/maestro`, but on this machine maestro lives at `~/Documents/gits/maestro`, so every run needed the variable set (044 report). Make the default work here, for example by trying the known locations in order and failing with one line naming `MAESTRO_DIR` when none is a git checkout, and keep one shared definition instead of three copies. Code in the bench scripts with a test, and update `bench/README.md`.

## Acceptance criteria

- [ ] With `MAESTRO_DIR` unset, the bench finds `~/Documents/gits/maestro` on this machine; an explicit `MAESTRO_DIR` still wins
- [ ] When no candidate exists, the bench fails with one line naming `MAESTRO_DIR`
- [ ] The default is defined once and used by all bench scripts; `bench/README.md` says how it is found
- [ ] Bench tests pass (`node --test bench/`)

## Blocked by

None — can start immediately
