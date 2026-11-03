# Make the graph layer run in consumer repos that don't install typescript or ts-morph

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

maestro's dogfood of code-graph 0.3.0 (its task 106) found that layer 2 cannot run in a real consumer, and that the CLI leans on the agent to skip work it should skip itself.

**1. No concepts means a clean no-op.** With no `concepts` in scribe.config.json, the scribe skill says to skip the graph steps, but an agent ran `extract` anyway: it exited 1 because ts-morph was missing, then `apply` exited 1 because there was no ast.json. `extract` and `apply` (and any other graph command that iterates concepts) must exit 0 with a clear 'no concepts configured, skipped' message when the config declares none, and must not try to load typescript, ts-morph or the store to reach that answer.

**2. Resolve typescript/ts-morph from a plugin-owned location first.** Today the bundle resolves both through `createRequire(<project>/package.json)`. That fails in ordinary consumers: in a pnpm monorepo typescript lives only under a workspace package (maestro has it under apps/maestro, not the root), and almost no project depends on ts-morph. Keep the committed bundle small (do not bundle them). Instead resolve from, in order: (a) a plugin-owned persistent directory (use the plugin data dir Claude Code exposes to plugin scripts if one exists, e.g. `CLAUDE_PLUGIN_DATA`; otherwise a per-user cache such as `~/.cache/code-graph/deps/<version>`), (b) the project's own install as a fallback. Populating (a) downloads packages, so it must be an explicit, visible step the user sees, not a silent download inside a graph command: add a CLI subcommand (e.g. `code-graph deps install`) that installs pinned versions of ts-morph (check whether its own dependency already carries typescript, and avoid a second copy if so) into that directory, and have the `code-graph-install` skill offer it. When neither location resolves, the error names that command. Layer 1 (`skills *`) stays untouched: it never loads these or node:sqlite.

**3. Keep the store out of git.** In maestro, `extract` created `scribe-output/graph.db` (+ `-shm`/`-wal`) at the repo root, untracked and not ignored. The `code-graph-install` skill must add the store files to the project's `.gitignore` (idempotently, only if not already ignored). Ignore the database files only (`scribe-output/graph.db*`, or the configured `dbPath` and its `-shm`/`-wal`), not the whole `scribe-output/` directory: the documented way to share a graph is committing the `.ast.json` / `.enriched.json` beside it.

Document the resolution order in docs/installation.md, docs/usage.md and the package CLAUDE.md. Bump plugin.json and the marketplace entry together to 0.3.2.

## Acceptance criteria

- [ ] With no concepts configured, `extract` and `apply` exit 0 with a skip message and load neither ts-morph, typescript nor node:sqlite
- [ ] In a pnpm monorepo copy where typescript is only under a workspace package and ts-morph is absent, after `code-graph deps install` the bundled CLI runs extract and apply on a TS concept
- [ ] With no plugin-owned deps and no project install, a graph command fails with a message naming the install command
- [ ] The project's own typescript/ts-morph are still used as a fallback when present
- [ ] `skills list/status` still produce no stderr and never load the graph stack
- [ ] Install on a scratch project adds the store's database files to `.gitignore` once (a re-run adds nothing) and leaves `.ast.json`/`.enriched.json` committable
- [ ] plugin.json and marketplace.json read 0.3.2; claude plugin validate, pnpm test, pnpm check and just eval (7/7) are green

## Blocked by

None — can start immediately
