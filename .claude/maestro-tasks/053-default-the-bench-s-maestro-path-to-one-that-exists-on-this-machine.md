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

## Post-Mortem

- **Problem:** @backend resolved MAESTRO_DIR eagerly at script startup, so scripts exited on a machine with no maestro checkout even for runs that never use `{MAESTRO}`; @reviewer failed it (round 1) and it needed a loop-back to make the lookup lazy (`maestroFor`).
  **Fix:** none
- **Problem:** The loop-back edit garbled the `{MAESTRO}` README sentence and overstated that `--dry` needs no checkout; @reviewer failed it again (round 2) and a second loop-back was needed.
  **Fix:** none
- **Problem:** @backend ended `HANDOFF: success` twice without writing the `test/backend.1.md` payload (worktree run); the coordinator had to resume it for the payload and write the channel file itself.
  **Fix:** none
- **Problem:** The ticket's acceptance criterion `node --test bench/` fails on Node 25; tests had to be run per file (`node --test bench/*.test.mjs`).
  **Fix:** none
