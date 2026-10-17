# Installation

## Prerequisites

- nodejs 24 LTS
- pnpm

## Installation

1. git clone `<repo>`
2. `cd code-graph`
3. install with `pnpm install` (a Turborepo/pnpm workspace — install from the root)
4. build with `pnpm build` (turbo builds every package in dependency order)
5. Put the CLI on PATH with `just link` (`pnpm add -g "$(pwd)/packages/code-graph"`). The workspace
   root is private and has no `bin`, so linking the root installs nothing. Requires `PNPM_HOME` /
   `pnpm bin -g` to be on PATH. Note `pnpm link --global` was removed in pnpm 10.
6. Verify `code-graph --version`
7. Start a Claude Code session with the plugin loaded: `claude --plugin-dir /path/to/code-graph/plugin`

Inside that session, `/graph` and the concept-skill skills (`add-concept`, `create-concept-skills`, `update-concept-skills`, `update-single-concept-skill`, `scribe`, the design skills and the `code-graph-install|update|uninstall` trio) are available.

### Enable it per project

To switch the plugin on for one project rather than passing `--plugin-dir` each time, run the
`code-graph-install` skill in that project. It adds `"code-graph@code-graph": true` to
`.claude/settings.json` `enabledPlugins` (every other key untouched) and, when a legacy
`.claude/concept-skills.json` from maestro's concept-skills plugin exists, migrates it into the `skills` block of
`scribe.config.json` with its **version unchanged** (`last_update` and `agents` too). Re-runnable.
`code-graph-update` re-checks that setup after a plugin update; `code-graph-uninstall` removes the
`enabledPlugins` entry and leaves every SKILL.md, `scribe.config.json` and the graph store in place.
Then run `create-concept-skills` (new project) or `update-concept-skills` (existing list). The plugin carries its own CLI bundle (`plugin/scripts/code-graph.cjs`), so its `code-graph skills *` commands work without the global binary; its graph commands load `ts-morph` (which carries its own TypeScript compiler) from a plugin-owned deps directory first (`$CLAUDE_PLUGIN_DATA/deps/<key>` and `~/.cache/code-graph/deps/<key>`, where `<key>` names the pinned deps, e.g. `ts-morph@28.0.0`, so plugin updates reuse the install; after upgrading from 0.3.7 or earlier run `deps install` once more, and the old `deps/0.3.*` folders can be deleted), then fall back to the consumer project's own install. Populate the plugin directory once with `node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" deps install` (an explicit npm download; `/code-graph-install` offers it). Without either location a graph command fails with a message naming that command. `/code-graph-install` also adds the store files (`scribe-output/graph.db*`) to `.gitignore`, leaving `.ast.json` / `.enriched.json` committable. The `code-graph-retrieval` skill also ships with the plugin and triggers automatically when Claude needs to understand code in a project that has a `scribe.config.json`.

## Make Claude prefer the graph (recommended)

The `code-graph-retrieval` skill nudges Claude to query the graph before grepping, but
skill triggering is probabilistic. Reinforce it by adding this block to the **consumer
project's** `CLAUDE.md` (the project being read — not this repo):

```md
## Code intelligence protocol

This project has a code-graph (`scribe.config.json` at root). Before grep/glob-ing to
understand how something works or what a change impacts, query the graph first:

- "how does X work" → `code-graph search "X"` (or `/graph X`)
- "what calls / breaks if I change Y" → `code-graph query impact Y`
- a file:line or symbol → `code-graph query vertex <loc>`

Use the `@filepath:line` pointers it returns as your `Read` targets. Fall back to raw
Grep/Glob only for literal text matches or when the graph exits 6 (no results). The graph
reflects the last `code-graph apply`, so verify against the file if a pointer looks stale.
```

The skill (portable, automatic) plus this rule (project-local reinforcement) together make
graph-first retrieval the default. For deterministic enforcement, add a `PreToolUse` hook on
Grep/Glob — but that removes Claude's judgment about graph staleness, so prefer the soft
layers unless you measure the graph being skipped too often.

## Install Zed editor LSP (optional)

### Prerequisites

- [Rust](https://rust-lang.org/tools/install/)
- Setup rust to use `wasm32-wasip1` for building the LSP with: `rustup target add wasm32-wasip1`
- Zed editor

### Install in Zed

From code-graph root, start by building the LSP and Zed extension:

```sh
just lsp-build    # TypeScript → packages/lsp/dist/server.js
just lsp-link     # `code-graph-lsp` symlink on PATH via pnpm
just zed-build    # Rust → editor/zed-code-graph/target/wasm32-wasip1/release/zed_code_graph.wasm
```

Zed → `Cmd-Shift-X` (Extensions) → **Install Dev Extension** → pick `editor/zed-code-graph/`.

### Verify

1. Make sure the project has a graph store (`code-graph bootstrap`; `apply` also creates it).
2. Open any TS/TSX file in a project that has been bootstrapped and extracted. Expect:
   - Code-lens above each vertex: `↓ N · ↑ M · ⇄ K`
   - Hover at function body → markdown card (purpose, tags, cross-concept refs, callers/callees)
