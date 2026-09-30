# Development

This repo is a [Turborepo](https://turborepo.dev) workspace managed with pnpm. Every task runs from
the repo root and turbo orders the packages by `dependsOn`.

## Dev Setup

```sh
pnpm install
pnpm build      # turbo run build — tsc → packages/*/dist
pnpm typecheck  # tsc --noEmit across the workspace
pnpm test       # node:test (CLI) + vitest (desktop app)
pnpm check      # prettier --check; scope lives in the root .prettierignore
pnpm verify     # check + typecheck + test, the pre-push gate
```

`just` wraps the same commands (`just build`, `just verify`, `just app`); run `just --list` for the
full set.

To put the CLI on PATH, install the package globally — the workspace root is private and has no
`bin`, so linking the root installs nothing:

```sh
just link     # pnpm add -g "$(pwd)/packages/code-graph"
just unlink   # pnpm remove -g code-graph
```

Two pnpm-10 gotchas the recipe exists to absorb: `pnpm link --global` was **removed** in pnpm 10
(`pnpm link` now only takes a `<dir>` to link *into* the current project — running it inside this
workspace adds a `link:` dependency to the root `package.json`, which is not what you want), and
`pnpm add -g` resolves a relative path against pnpm's global directory rather than the cwd, so the
path has to be absolute. Both need `pnpm bin -g` to be on PATH (`PNPM_HOME`).

Watch mode is per-package, since each one owns its own `tsc`:

```sh
pnpm --filter code-graph exec tsc --watch
```

Plugin loaded per-session (the plugin tree stays at the repo root, not inside a package, because
`.claude-plugin/marketplace.json` points at `./plugin`):

```sh
claude --plugin-dir /path/to/code-graph/plugin
```

## Workspace Layout

```
code-graph/                 private workspace root — turbo.json, pnpm-workspace.yaml, .prettierrc
  apps/
    desktop/                code-graph-desktop — Electron + React graph viewer
  packages/
    code-graph/             the published CLI + library ("code-graph")
      src/
        cli.ts              entry point
        index.ts            programmatic surface — the pure read path, no process.exit
        config.ts           scribe.config.json loader
        schema.ts           Zod types (Vertex, Edge, …)
        catalog/
          catalog.ts        repo-wide symbol catalog (ts-morph)
        scribe/
          bootstrap.ts      SQL schema + indexes + FTS5 rebuild
          db.ts             node:sqlite store handle + per-project db path
          extract.ts        AST extraction via ts-morph
          apply.ts          upsert + drift detection
          rows.ts           doc-column helpers, handle helpers, FTS match builder
          delete-concept.ts archive + dangling-ref reporting
        query/
          preflight.ts      config + store creation + schema-version check (exits; CLI only)
          queries.ts        concept / impact / cross / vertex / file SQL
          run.ts            CLI runners for query subcommands
          format.ts         markdown formatters (concept/impact/cross/vertex)
          search.ts         BM25 + expansion + ranking + search formatter
        eval/
          harness.ts        layer-A eval runner
      eval/
        tasks.json          default eval fixture, shipped in the npm `files` set
    lsp/                    code-graph-lsp — LSP server, spawns the CLI (deliberately decoupled)
    typescript-config/      @repo/typescript-config — base.json + react.json
  plugin/                   the Claude Code plugin (--plugin-dir target)
    commands/
      graph.md              /graph slash command
      scribe-enrich.md      /scribe-enrich slash command
    skills/
      scribe-code-graph/SKILL.md
  editor/zed-code-graph/    Zed extension (Rust → wasm; cargo, not pnpm)
  eval/
    tasks.code-graph.json   this repo's own dogfood fixture — the regression gate
    verification.md         phase-8 verification log
```

## Importing the library

`packages/code-graph` exposes a curated programmatic surface through its `exports` map, pointing at
`dist` rather than source. That is deliberate: the package's relative imports carry explicit `.js`
extensions against `.ts` files on disk, which a bundler's resolver should not have to guess at.
`tsc` emits declarations and turbo's `dependsOn: ["^build"]` makes every consumer wait for it.

```ts
import { tryLoadConfig, resolveDbPath, getStore, queryConcept } from "code-graph";
import { queryConcept } from "code-graph/query"; // or by subpath
```

What the surface deliberately omits, and why: `loadConfig`, `deleteConcept`, everything in
`query/preflight.ts` and `query/run.ts`, and `search()` all call `process.exit` and write to stdout.
Those belong to the CLI. A host process that exits because a config was missing is a crashed app, so
in-process consumers take `tryLoadConfig` and compose the pure pieces. `scribe/extract.ts` and
`catalog/catalog.ts` are omitted too — they are the only modules that pull in `ts-morph`, and
keeping them off the surface keeps a bundler from following the TypeScript compiler into a build.

## This repo's own graph

code-graph dogfoods itself: `scribe.config.json` at the root declares two concepts over its own
source, and `eval/tasks.code-graph.json` is the Layer-A gate.

```sh
just regraph   # extract + apply both concepts, then run the eval gate (expects 5/5)
```

Run that after anything that changes the body text of a graphed function — including a
`pnpm format` pass, which rewrites `contentHash` and will otherwise leave the store showing drift
and `agent.stale` on every reformatted vertex.
