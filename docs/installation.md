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

Inside that session, `/graph`, `/scribe-enrich`, and the `scribe-code-graph` skill are available.

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
