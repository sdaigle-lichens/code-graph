// Exit codes shared between the apply write path and the refresh-skills hook. Kept in a module with
// no imports so neither side has to load the other (the hook must not load the store at import time,
// and apply must not import the hook).

/**
 * `apply --defer-renames` found rename candidates and did not write the store: a rename needs a person's
 * decision (`apply <concept>` at a terminal), and recording it any other way loses enrichment.
 */
export const EXIT_RENAMES_DEFERRED = 10;

/**
 * `refresh-skills --claim-update` did not claim the update-concept-skills run: the refresh-skills lock is
 * held, another update run has not finished, or one started within the minimum interval.
 */
export const EXIT_UPDATE_NOT_CLAIMED = 14;
