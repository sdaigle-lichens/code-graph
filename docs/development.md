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
