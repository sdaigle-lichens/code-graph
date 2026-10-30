Round 3

Previous manager note (m002, on-track): "Continue the success path; commit and merge stay with the user." Since then @reviewer returned FAIL on README wording only (code fine):
- "`--dry` needs no checkout" overstated, because run.mjs runs setup before the dry exit. Addressed: it now reads "`--dry` needs a checkout only if a selected case uses `{MAESTRO}`".
- The earlier edit garbled the `{MAESTRO}` sentence (misplaced test note, stray `)`). Addressed: parenthetical restored, the Node 25 test command is its own sentence after it.

## Goal
Make the bench's default MAESTRO_DIR work on this machine, defined once for all three scripts, with a test and README update.

## Done
Unchanged from round 2 (bench/maestro-dir.mjs with lazy maestroFor, three scripts wired, tests 94 pass); this round only fixes the one README paragraph.

## Deviations
Same as round 2: separate module instead of lib.mjs; `node --test bench/*.test.mjs` replaces the directory form on Node 25.

## Decisions
None new.

## Touches
bench/README.md (one paragraph, near line 201) this round. Nothing committed.

## Sibling impact
Ticket 051 also edits bench/README.md and run.mjs in main; this round's change is confined to one paragraph.

## Questions
None.
