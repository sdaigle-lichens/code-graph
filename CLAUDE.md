# CLAUDE.md

`code-graph` — CLI + Claude Code plugin for graph-based code intelligence over TypeScript/React.
It extracts vertices and edges into an embedded SQLite store and serves hybrid retrieval through
`/graph`. A **concept** is a named slice declared in a consumer's `scribe.config.json` (globs + a
SKILL.md).

## Layout

pnpm + Turborepo. Run everything from the root: `pnpm build|typecheck|test|check|verify` or `just`.
Packages and apps have their own CLAUDE.md where needed (`packages/code-graph`, `apps/desktop`).
Rules for editing `plugin/skills/**` are in `.claude/rules/plugin-skills.md`; `plugin/` itself
holds no `CLAUDE.md` or `.claude/` (`pnpm check` fails if one appears).

- `plugin/` and `.claude-plugin/` stay at the root on purpose: `marketplace.json` points at
  `./plugin` and the plugin ships via git, not npm. `plugin/scripts/code-graph.cjs` is a
  **generated, committed** bundle — never edit it; regenerate with `pnpm bundle` and check
  `git diff plugin/scripts/`.
- `bench/` is a user-run `claude -p` graph vs no-graph benchmark (`node bench/run.mjs` from a plain
  terminal; see `bench/README.md`); `bench/results/` is gitignored.
- `docs/implementation/plan.md` is the master spec. CLI usage and exit codes: `docs/usage.md`.

The store is `<configRoot>/scribe-output/graph.db` (gitignored; override with `dbPath`).

## Working rules

- After changing `packages/code-graph/src/`, run `pnpm build` from the root (it also runs `bundle`).
- `just eval` must stay green (**7/7**) before shipping retrieval changes. It measures a **stripped,
  un-enriched temp copy** of the store (purposes/tags removed, index rebuilt), so the verdict does not
  depend on the gitignored `scribe-output/*.enriched.json` of whoever runs it; its `store:` line says so
  (and how many vertices carry a purpose in the real store). `just eval-as-is` (`--store as-is`) measures
  the store untouched and is informational, but it is 7/7 on a partly enriched store too (enriched for
  code-graph-search and scribe-pipeline, not concept-skills-layer): `searchStore` reserves 2 doc seeds beyond the
  top 10 and multiplies the bm25 of a name-matching vertex by 3 (`NAME_HIT_FACTOR`), and by 3 more when a non-type-def's whole
  name equals a query word (`NAME_EQUALS_TOKEN_FACTOR`, blended score only; task 4 `apply`). A 6/7 means task 3 or task 4 regressed; a 5/7
  (tasks 2 and 6) means the doc-seed reserve or the name-hit factor regressed. `search-partly-enriched.test.ts` pins these cases.
- `just eval` / `just regraph` first run `just dist-fresh` (`packages/code-graph/scripts/ensure-dist.mjs`:
  package tsc, no pnpm, sandbox-safe) to rebuild a `dist/` older than `src/`; `--check` only
  reports. Eval's `build:` line names the build it measured.
- `just eval` / `just eval-as-is` then run `just store-fresh` (`packages/code-graph/scripts/ensure-store.mjs`, node
  only, sandbox-safe): when `graph.db` is missing, empty or lacks a concept of `scribe.config.json` (a fresh worktree:
  the store is gitignored) it runs `extract` + `apply` for the missing concepts only and prints `store: built just
  now from <root> (...)`. A store with every concept is never touched (no rebuild, no enriched-file rewrite); a failed
  build exits 3 naming `just regraph`, so a missing store never shows up as 0/7. The recipes pass
  `--root {{justfile_directory()}}`, so store and `eval/results-*.json` belong to the invoking checkout. A bare
  `code-graph eval` (outside `just`) has no such guard: it scores whatever store it finds and prints 0/7 for an empty one.
- **`pnpm format` invalidates the graph**: rewritten bodies change `contentHash` and mark
  enrichment stale. Run `just regraph` after any format pass.
- **Vertex `_key` includes the filepath**: moving files rewrites keys and orphans
  `scribe-output/<concept>.enriched.json`. `apply` remaps an entry onto the moved vertex when exactly one
  vertex of the same type matches (same name, else same contentHash), prints one `note:` line for the rest
  (ambiguous or unmatched, kept in the file) and deletes nothing. Drop leftovers on purpose with
  `code-graph enrich prune <concept>` (dry run; `--yes` writes), or re-enrich them. The enriched file is
  gitignored and unrecoverable: copy it to `$TMPDIR` before pruning.
- Bump the version in `packages/code-graph/package.json`, `plugin/.claude-plugin/plugin.json` and
  `.claude-plugin/marketplace.json` together; `check-versions.mjs` (in `pnpm check` and `bundle`) fails on drift.
- Pilot consumer `~/Documents/gits/lichens-ordonnancement-ui` is not on this machine; never commit
  there from here.

## Out of scope unless asked

Embedding ranking (BM25 first; Layer-B gate still pending), LangChain/agentic wrappers, an MCP
server, git hooks / CI auto-scribe, `code-graph gc` hard-delete.
