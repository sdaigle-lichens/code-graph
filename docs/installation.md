# Installation

## Prerequisites

- nodejs 24 LTS
- pnpm

## Installation

1. git clone `<repo>`
2. `cd code-graph`
3. install with `pnpm install`
4. build with `pnpm build`
5. Link the CLI globally `pnpm link --global`
6. Verify `code-graph --version`
7. Start a Claude Code session with the plugin loaded: `claude --plugin-dir /path/to/code-graph/plugin`

Inside that session, `/graph`, `/scribe-enrich`, and the `scribe-code-graph` skill are available. The `code-graph-retrieval` skill also ships with the plugin and triggers automatically when Claude needs to understand code in a project that has a `scribe.config.json`.

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
just lsp-build    # TypeScript → lsp/dist/server.js
just lsp-link     # `code-graph-lsp` symlink on PATH via pnpm
just zed-build    # Rust → editor/zed-code-graph/target/wasm32-wasip1/release/zed_code_graph.wasm
```

Zed → `Cmd-Shift-X` (Extensions) → **Install Dev Extension** → pick `editor/zed-code-graph/`.

### Verify

1. Make sure ArangoDB is running (`just up`).
2. Open any TS/TSX file in a project that has been bootstrapped and extracted. Expect:
   - Code-lens above each vertex: `↓ N · ↑ M · ⇄ K`
   - Hover at function body → markdown card (purpose, tags, cross-concept refs, callers/callees)
