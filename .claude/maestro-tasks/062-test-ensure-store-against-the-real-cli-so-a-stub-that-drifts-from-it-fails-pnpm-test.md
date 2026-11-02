# Test ensure-store against the real CLI so a stub that drifts from it fails pnpm test

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Ticket 057 added packages/code-graph/scripts/ensure-store.mjs (run by `just store-fresh`, before `just eval` and `just eval-as-is`): when graph.db is missing, empty or lacks a concept of scribe.config.json it runs `dist/cli.js --root <root> extract <concept>` then `apply <concept>` for the missing concepts only. Its 12 tests in packages/code-graph/src/ensure-store.test.ts use a stub CLI and docs-only concepts, so nothing in `pnpm test` fails if the real CLI changes how it is called (a renamed flag, a changed exit code, an extract that needs something the script does not pass). The real path was only checked by hand once, in a throwaway worktree. Add a test that builds a tiny project in a temp dir (a one-file TypeScript source, a minimal tsconfig, a scribe.config.json with one code concept and a one-line SKILL.md), runs ensure-store.mjs against the real packages/code-graph/dist/cli.js with no graph.db, and asserts: the store is built (a `store: built just now from <root>` line, the concept has live vertices), a second run is a no-op that does not touch the db (same mtime and size), and a partial store (a second concept added to the config afterwards) builds only the missing concept and leaves the first concept's rows and its .enriched.json untouched. Follow eval-cli.test.ts, which already requires a built dist and fails with `run pnpm build first` when it is missing. Keep it sandbox-safe: no network, no pnpm, no install; ts-morph is resolved from the repo's own node_modules, so say in the test how that works (the project dir may need a node_modules link or the test should set the project-deps resolution the CLI uses; check `requireFromProject` in project-deps.ts and pick the smallest option). If the test needs more than a few seconds, say so in the report. Do not change ensure-store.mjs unless the test finds a real mismatch; if it does, fix it and report the mismatch as a finding. No CLI source change expected, so no bundle regeneration; whoever merges bumps the version.

## Acceptance criteria

- [ ] A test runs ensure-store.mjs against the real dist/cli.js on a temp project with a code concept and no graph.db, and asserts the store was built and the `store: built just now from <root>` line was printed
- [ ] A second run on the now-complete store changes nothing (db mtime and size unchanged, no `built just now` line)
- [ ] With a second concept added to the config, only that concept is built; the first concept's rows and its .enriched.json are unchanged
- [ ] The test fails when the script's call to the CLI is broken (for example a wrong subcommand), shown in the report by reverting one argument; it does not use a stub for the CLI
- [ ] The test needs no network, pnpm or install; the way it resolves ts-morph is explained in a comment; `pnpm check`, `pnpm test` and `just eval` are green on the committed result

## Touched surfaces

- packages/code-graph/src/ensure-store.test.ts (or a new test file beside it)
- packages/code-graph/scripts/ensure-store.mjs only if the test finds a real mismatch
- packages/code-graph/CLAUDE.md or root CLAUDE.md only if the test setup needs a note
- version files (whoever merges bumps)

## Blocked by

- `057-make-just-eval-build-the-graph-store-in-a-fresh-worktree-instead-of-scoring-0-7.md`
