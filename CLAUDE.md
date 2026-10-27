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
- `just eval` must stay green (**7/7**) before shipping retrieval changes.
- **`pnpm format` invalidates the graph**: rewritten bodies change `contentHash` and mark
  enrichment stale. Run `just regraph` after any format pass.
- **Vertex `_key` includes the filepath**: moving files rewrites keys and orphans
  `scribe-output/<concept>.enriched.json` (remap or re-enrich).
- Bump the version in `packages/code-graph/package.json`, `plugin/.claude-plugin/plugin.json` and
  `.claude-plugin/marketplace.json` together; `check-versions.mjs` (in `pnpm check` and `bundle`) fails on drift.
- Pilot consumer `~/Documents/gits/lichens-ordonnancement-ui` is not on this machine; never commit
  there from here.

## Out of scope unless asked

Embedding ranking (BM25 first; Layer-B gate still pending), LangChain/agentic wrappers, an MCP
server, git hooks / CI auto-scribe, `code-graph gc` hard-delete.
