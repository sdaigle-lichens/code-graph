# apps/desktop

Electron + React graph viewer consuming the `code-graph` library in-process.

- Only `src/main/graph.ts` may import `code-graph`. Every read goes through `openStore`
  (`existsSync` before `getStore`); `closeAllStores` runs on project switch and `will-quit`.
- All IPC goes through the single `handle()` wrapper in `main/ipc.ts`, returning `Result<T>`
  (`{ ok: true, data } | { ok: false, error }`). Channels and mirror types live in
  `src/shared/ipc.ts`. The renderer never sees the library or node.
- A renderer-supplied `projectRoot` is honored only via `resolveProjectRoot`.
- Edge endpoints are resolved with `keyOf` in main only (`withEndpointKeys` adds `fromKey`/`toKey`
  to `graph:concept` edges); the renderer never splits a handle. The canvas skips and counts edges
  whose endpoint is outside the concept. Layout: `@dagrejs/dagre`; `documented-by` edges start off.
- `graph:init` writes `scribe.config.json` only — never creates the store or extracts; the store
  appears on `apply`.
