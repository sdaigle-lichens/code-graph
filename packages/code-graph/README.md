# code-graph

Graph-based code intelligence for Claude Code — BM25 + multi-hop retrieval over TypeScript/React
codebases, in an embedded SQLite store (`node:sqlite`, no server, no Docker).

This is the CLI and library package of the [code-graph](https://github.com/lichens-ai/code-graph)
workspace. The Claude Code plugin, the Zed extension and the docs live in the repository root — see
the [repo README](https://github.com/lichens-ai/code-graph#readme) for installation,
[docs/usage.md](https://github.com/lichens-ai/code-graph/blob/main/docs/usage.md) for the commands
and [docs/development.md](https://github.com/lichens-ai/code-graph/blob/main/docs/development.md)
for the workspace layout.

## CLI

```sh
code-graph extract <concept>   # ts-morph AST walk  → scribe-output/<concept>.ast.json
code-graph apply <concept>     # diff + upsert into scribe-output/graph.db, with a drift report
code-graph search "<query>"    # BM25 seed → 1–2 hop expansion → clustered markdown
code-graph status              # store, schema version, row counts
```

## Library

The `exports` map exposes the pure read path — the part with no `process.exit` and no stdout, safe
to call in-process (the desktop app's Electron main process does):

```ts
import { tryLoadConfig, resolveDbPath, getStore, queryConcept, closeStores } from "code-graph";

const config = tryLoadConfig(projectRoot); // null instead of exiting when there is no config
const store = getStore(resolveDbPath(config));
const { vertices, edges, doc } = await queryConcept(store, "my-concept");
closeStores();
```

`getStore` creates the database file if it is missing, so guard with `existsSync` when merely
inspecting a project. Subpath exports (`code-graph/query`, `code-graph/scribe/db`, …) are available
for narrower imports.

## License

ISC
