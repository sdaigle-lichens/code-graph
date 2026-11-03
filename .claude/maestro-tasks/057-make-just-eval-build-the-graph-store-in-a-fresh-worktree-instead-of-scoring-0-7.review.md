Round 1 (pre-build direction check on the build-vs-refuse choice, requested by the manager; nothing built yet)

## Goal
Make `just eval` never print 0/7 for a missing, empty or foreign graph store.

## Done
Investigation only. With no graph.db the eval silently creates an empty db, prints `store: ... 0 of 0 vertices`, fails all 7 tasks and prints `REGRESSIONS: 0/7 passed` (exit 1), indistinguishable from a retrieval regression. Results land under `<configRoot>/eval/`, where the root comes from `--root`, `$CLAUDE_PROJECT_DIR` or cwd (explains the "wrote into the main checkout" report).

## Deviations
None yet.

## Decisions (proposed, full text in /tmp/claude-1000/057-decision.md)
- BUILD, not refuse: same local extract + apply steps as `regraph` (no network, no pnpm), matching the `dist-fresh` precedent. Refusal only if the build fails: message naming `just regraph`, exit 3, recipe aborts so no 0/7 is printed.
- New `packages/code-graph/scripts/ensure-store.mjs` (like ensure-dist.mjs); rebuilds when the db is missing, has no usable `vertices` table, or any concept in scribe.config.json has no live rows; never creates an empty db; `--check` exits 1 if it would build.
- justfile: `store-fresh: dist-fresh`; `eval` and `eval-as-is` depend on it and pass `--root {{justfile_directory()}}`.
- `store:` line unchanged for a current store; when built, a `store: built just now (...)` line precedes the eval.
- No CLI source change, so no bundle regeneration. Optional (needs a CLI change + pnpm build + bundle): db path in the `store:` line, and `eval` itself refusing on zero live vertices. Proposal: do NOT do these unless the manager wants them, but note that acceptance criterion 3 ("output names the store it measured") is met by the existing `store:` line plus the built-just-now line.
- Tests: script test for missing/empty/partial/complete db, `--check`, build failure with a stub cli.
- Docs: extend the `dist-fresh` bullet in the root CLAUDE.md working rules.

## Touches
packages/code-graph/scripts/ensure-store.mjs (new), its test, justfile, root CLAUDE.md.

## Sibling impact
Tickets touching the justfile eval recipes (059 already landed). No version bump (merger does it); pnpm-lock.yaml untouched.

## Verified
Nothing built; no commit to verify. Full suite not yet run (nothing changed).

## Questions
1. Approve BUILD over refuse?
2. Accept skipping the two optional CLI changes (db path in `store:` line, eval-level refusal)?
