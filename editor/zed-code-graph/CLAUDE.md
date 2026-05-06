# CLAUDE.md — editor/zed-code-graph

## What this is

Thin Rust/Wasm shim that registers `code-graph-lsp` as a language server in Zed. The extension itself contains no query logic — it just launches the LSP server (at `../../lsp/`) and hands Zed the stdio connection.

## How it works

1. Zed loads the compiled `.wasm` via dev-extension install.
2. On any TS/TSX/JS/JSX buffer open, Zed calls `language_server_command`.
3. Extension returns `node <server_path>` — where `server_path` is resolved in this order:
   - Zed `lsp` settings override (`binary.path` + `binary.arguments`)
   - `CODE_GRAPH_LSP_PATH` env var
   - `code-graph-lsp` on PATH (set by `just lsp-link`)

## File layout

```
editor/zed-code-graph/
  extension.toml       Zed manifest (id, schema_version, [lib], [language_servers])
  Cargo.toml           cdylib crate, depends on zed_extension_api 0.7
  src/lib.rs           Extension impl — only language_server_command()
  target/              Rust build output (gitignored)
```

## Build

```sh
just zed-build
# → editor/zed-code-graph/target/wasm32-wasip1/release/zed_code_graph.wasm
```

Requires `wasm32-wasip1` target: `rustup target add wasm32-wasip1`.

## Install in Zed (dev, no publishing)

Zed → `Cmd-Shift-X` → **Install Dev Extension** → pick this directory.

## Configuring LSP binary path

If `code-graph-lsp` is not on PATH, add to Zed `settings.json`:

```json
{
  "lsp": {
    "code-graph-lsp": {
      "binary": {
        "path": "node",
        "arguments": ["/absolute/path/to/code-graph/lsp/dist/server.js"]
      }
    }
  }
}
```

## Relationship to other components

| Component | Location | Role |
|-----------|----------|------|
| LSP server | `../../lsp/` | Does all the work — hover, code-lens, links, definition |
| CLI subcommand | `../../src/query/` | `code-graph query file <path> --json` — what LSP shells out to |
| ArangoDB | localhost:8529 | Graph data store |

## Out of scope

This shim has no opinion on query logic, rendering, or caching — all in `lsp/`. To change what hovers show or how edges are displayed, edit `lsp/src/render.ts`, not this extension.
