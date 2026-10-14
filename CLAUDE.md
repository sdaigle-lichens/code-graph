# CLAUDE.md

`code-graph` — CLI + Claude Code plugin for graph-based code intelligence over TypeScript/React.
It extracts vertices and edges into an embedded SQLite store and serves hybrid retrieval through
`/graph`. A **concept** is a named slice declared in a consumer's `scribe.config.json` (globs + a
SKILL.md).

## Layout

pnpm + Turborepo. Run everything from the root: `pnpm build|typecheck|test|check|verify` or `just`.

- `packages/code-graph` — the CLI + library (see its CLAUDE.md). `packages/lsp` spawns the CLI.
- `apps/desktop` — Electron viewer (see its CLAUDE.md). `packages/ui`, `editor/zed-code-graph` have
  their own CLAUDE.md.
- `plugin/` and `.claude-plugin/` stay at the root on purpose: `marketplace.json` points at
  `./plugin` and the plugin ships via git, not npm. `plugin/scripts/code-graph.cjs` is a
  **generated, committed** bundle — never edit it; regenerate with `pnpm bundle` and check
  `git diff plugin/scripts/`.
- `eval/` — this repo's own Layer-A gate. `docs/` — usage, installation, development;
  `docs/implementation/` holds the master spec (`plan.md`) and phase plans.

Pipeline: `extract <concept>` → `scribe-output/<concept>.ast.json` → `/scribe-enrich` →
`.enriched.json` → `apply` (DB upsert + drift) → `search "<query>"` (BM25 seed, 1–2 hop expand).
The store is `<configRoot>/scribe-output/graph.db` (gitignored; override with `dbPath`).

## Working rules

- After changing `packages/code-graph/src/`, run `pnpm build` from the root (it also runs `bundle`).
- `just eval` must stay green (**7/7**) before shipping retrieval changes.
- **`pnpm format` invalidates the graph**: rewritten bodies change `contentHash` and mark
  enrichment stale. Run `just regraph` after any format pass.
- **Vertex `_key` includes the filepath**: moving files rewrites keys and orphans
  `scribe-output/<concept>.enriched.json` (remap or re-enrich).
- Pilot consumer `~/Documents/gits/lichens-ordonnancement-ui` is not on this machine; never commit
  there from here.

## Skills layer

`plugin/skills/` ships the concept-skill flows (`create-`/`update-concept-skills`,
`update-single-concept-skill`, `scribe`, `cleanup-skill`, the design pair, `code-graph-install|update|uninstall`),
all calling only `node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs"`. Rules when editing them:

- Every flow must work with no tsconfig: graph steps (`catalog`, `extract`, `apply`, `drift`) are
  skipped and staleness comes from `skills status`' git-diff window.
- Repo-level `skills stamp` without `--bump` resets to **1.0**. Create = `--bump initial`,
  update = `--bump minor`, single-skill deepening = `--bump major`; install's migration of
  `.claude/concept-skills.json` uses `skills agents-set` (seeds the block, version untouched).
- `scribe` is the only scribe skill (enrichment lives in it). Keep its gap-channel contract
  (`.claude/channels/scribe/<agent>.1.md` with `{ "skill_gaps": [{ "skill", "missing" }] }`) verbatim:
  maestro depends on it.

## CLI exit codes

0 OK · 1 usage/config error · 2 retired (was ArangoDB unreachable; kept reserved, never emitted) ·
3 store written by a newer code-graph · 4 ambiguous symbol (use `concept::name` or
`filepath:name`) · 5 no `scribe.config.json` · 6 no results / not found. `/graph` falls back to the Explore agent on 2 or 6.

## Out of scope unless asked

Embedding ranking (BM25 first; Layer-B gate still pending), LangChain/agentic wrappers, an MCP
server, git hooks / CI auto-scribe, `code-graph gc` hard-delete.
