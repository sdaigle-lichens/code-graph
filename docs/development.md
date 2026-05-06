# Development

## Dev Setup

```sh
pnpm install
pnpm build          # tsc → dist/
pnpm link --global  # make code-graph available on PATH

# Watch mode
npx tsc --watch

# Type check only
npx tsc --noEmit
```

Plugin loaded per-session:

```sh
claude --plugin-dir /path/to/code-graph/plugin
```

## Editor integration (Zed)

The repo ships a Zed extension at `editor/zed-code-graph/` plus a standalone LSP server at `lsp/`. Together they surface code-graph data as hovers / code-lens / document-link / definition lookups in any TS/TSX/JS/JSX buffer.

### Build

```sh
just lsp-build      # TS → lsp/dist/server.js
just lsp-link       # `code-graph-lsp` on PATH (symlinks via pnpm)
just zed-build      # Rust → editor/zed-code-graph/target/wasm32-wasip1/release/zed_code_graph.wasm
```

### Install in Zed (dev mode)

Open Zed → `Cmd-Shift-X` (Extensions) → **Install Dev Extension** → pick `editor/zed-code-graph/`. Zed compiles the wasm extension and registers the language server.

If `code-graph-lsp` is not on PATH, configure the binary path in your Zed `settings.json`:

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

### Behavior

- The LSP shells out to `code-graph query file <path> --json` per opened/saved buffer (debounced, cached 30 s).
- Hover at any vertex → markdown card with purpose, tags, cross-concept refs, edge counts, callers/callees.
- Code-lens at each vertex's first line → `↓ N · ↑ M · ⇄ K` summary (callees / callers / cross-refs).
- Document-link → click the lens line to jump to the first outbound edge target.
- Go-to-definition (F12) → first outbound target via graph data.
- ArangoDB unreachable: server backs off 60 s, no UI noise after the first message.
- File outside any concept's globs: empty result, no errors.

### CLI underneath

```sh
code-graph query file src/store/workorder.store.ts --json
code-graph query file src/store/workorder.store.ts            # human-readable
```

Exit codes: 0 OK / 2 ArangoDB unreachable / 6 no live vertices for that path.

## File Layout

```
code-graph/
  src/
    cli.ts              entry point
    config.ts           scribe.config.json loader
    schema.ts           Zod types (Vertex, Edge, …)
    scribe/
      bootstrap.ts      DB + collection + view setup
      extract.ts        AST extraction via ts-morph
      apply.ts          upsert + drift detection
      db.ts             arangojs connection
    query/
      preflight.ts      exit-2/3/5 checks
      queries.ts        AQL query functions
      run.ts            CLI runners for query subcommands
      format.ts         markdown formatters (concept/impact/cross/vertex)
      search.ts         BM25 + expansion + ranking + search formatter
    eval/
      harness.ts        layer-A eval runner
  plugin/
    commands/
      graph.md          /graph slash command
      scribe-enrich.md  /scribe-enrich slash command
    skills/
      scribe-code-graph/SKILL.md
  eval/
    tasks.json          default eval task fixtures
```
