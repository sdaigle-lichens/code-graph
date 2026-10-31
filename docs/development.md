# Development

This repo is a [Turborepo](https://turborepo.dev) workspace managed with pnpm. Every task runs from
the repo root and turbo orders the packages by `dependsOn`.

## Dev Setup

```sh
pnpm install
pnpm build      # turbo run build bundle — tsc → packages/*/dist, + plugin/scripts/code-graph.cjs
pnpm bundle     # just the plugin bundle (also `just bundle`)
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
      src/main/             main process; graph.ts is the only importer of "code-graph"
      src/preload/          contextBridge surface
      src/shared/ipc.ts     IPC contract shared by main / preload / renderer
      src/renderer/         React UI
  packages/
    code-graph/             the published CLI + library ("code-graph")
      src/
        cli.ts              entry point
        index.ts            programmatic surface — the pure read path, no process.exit
        config.ts           scribe.config.json loader
        version.ts          package version/root, from dist/ or the bundle
        project-deps.ts     requireFromProject — plugin deps dir first, then the project's own ts-morph
        deps.ts             deps install|status — npm-installs pinned ts-morph into the plugin deps dir
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
        skills/             layer 1 — `code-graph skills *` (markers, state, check/status, agents)
        eval/
          harness.ts        layer-A eval runner
      scripts/
        build-plugin.mjs    esbuild → plugin/scripts/code-graph.cjs
      eval/
        tasks.json          default eval fixture, shipped in the npm `files` set
    lsp/                    code-graph-lsp — LSP server, spawns the CLI (deliberately decoupled)
    typescript-config/      @repo/typescript-config — base.json + react.json
    styles/                 shared styles, fonts, SCSS
    ui/                     shared React UI components
  plugin/                   the Claude Code plugin (--plugin-dir target)
    commands/
      graph.md              /graph slash command
    hooks/
      hooks.json            Stop + SubagentStop run `refresh-skills --hook` (120 s); no session context
    skills/                 each <name>/SKILL.md; every one calls only the bundled CLI
      create-concept-skills, update-concept-skills, update-single-concept-skill   the concept-skill flows
      scribe                placement rule, extract+apply rule, gap channel, enrichment procedure
      cleanup-skill, load-concept-skills, explore-concept-skills                    building blocks
      code-architecture-design, use-code-architecture-design-check                  design gate + brief
      code-graph-install, code-graph-update, code-graph-uninstall                   per-project setup
      add-concept, code-graph-retrieval                                            graph-side skills (retrieval is user-run, model invocation disabled)
    scripts/
      code-graph.cjs        GENERATED bundle of src/cli.ts, committed — do not edit
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

## The plugin bundle

Plugin skills run `node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs"`, a self-contained esbuild
bundle of `src/cli.ts` that is **committed** because the plugin ships by file copy with no
`node_modules`. `pnpm build` regenerates it; after touching `src/` or `scripts/build-plugin.mjs`,
read `git diff plugin/scripts/` — a broken build script leaves the old bundle working while source
changes silently stop reaching the plugin.

- `typescript` and `ts-morph` are not bundled: `requireFromProject` loads `ts-morph` from the
  plugin-owned deps dir (`code-graph deps install`) first, then the consumer project's own copy; with
  neither, the error names `deps install` (or, when a deps dir exists but is unreadable or hidden in a
  sandbox, the absolute path(s) for `sandbox.filesystem.allowRead`; `probeDepsDir` stats and then
  lists `node_modules`, since macOS Seatbelt allows stat on a denied dir).
- The `skills` command group (layer 1) must never load `node:sqlite`, `typescript` or `ts-morph`, so
  it runs in any repo on any supported Node. `cli.ts` imports every graph module lazily, inside its
  command — keep new ones that way.
- Read the version through `version.ts` (`packageVersion()` / `packageRoot()`); in the bundle the
  version is baked in and `packageRoot()` is null.

## Desktop app

`apps/desktop` (Electron + React, built with electron-vite; output in `out/`) reads the graph
in-process through the library surface above.

- **Isolation** — only `src/main/graph.ts` imports `code-graph`; main, preload and renderer share
  types through `src/shared/ipc.ts`, which is type-only apart from the channel tables. The renderer
  never sees the library or node. `test/isolation.test.ts` guards this.
- **IPC** — channels: `project:get|pick|open|forget`, `graph:status`, `graph:init`,
  `concept:list|add|delete`, `graph:concept`; event `project:changed`. Every call returns
  `Result<T>` via the one `handle()` wrapper in `main/ipc.ts`.
- **`graph:init` writes config only** — it creates `scribe.config.json` and nothing else; the store
  is created later by `apply`.
- **Stores** — reads open through `openStore`; all handles are closed on project switch and quit.
- **Concept canvas** — the graph page (`routes/graph.tsx`) draws a concept with `components/graph-canvas.tsx`,
  laid out left to right by `@dagrejs/dagre` (`lib/graph-model.ts`); `edge-toolbar.tsx` toggles edge
  types with live counts (`documented-by` starts off: it is one hub wired to every vertex), and
  `vertex-panel.tsx` shows the clicked vertex and its neighbors, derived from the fetched edges.
  Colors come from `lib/graph-palette.ts` and the `packages/styles/scss/abstracts/_graph.scss` tokens
  (9 vertex types, 11 edge types, light and dark).
- **Edge endpoints** — `graph:concept` edges carry `fromKey` / `toKey` beside `_from` / `_to`, resolved
  in the main process (`withEndpointKeys` in `main/graph.ts`) with the library's `keyOf`. The renderer
  never splits a handle; the isolation test enforces it. Edges whose endpoint has no node in the
  concept (cross-concept) are skipped in the layout and counted.

## This repo's own graph

code-graph dogfoods itself: `scribe.config.json` at the root declares three concepts over its own
source (`code-graph-search`, `scribe-pipeline`, `concept-skills-layer`), and
`eval/tasks.code-graph.json` is the Layer-A gate.

```sh
just regraph   # extract + apply all three concepts, then run the eval gate (expects 7/7)
```

Run that after anything that changes the body text of a graphed function — including a
`pnpm format` pass, which rewrites `contentHash` and will otherwise leave the store showing drift
and `agent.stale` on every reformatted vertex.
