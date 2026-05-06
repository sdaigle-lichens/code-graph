# Phase 3 — Extract (ts-morph)

## Goal

`code-graph extract <concept>` walks the consumer project's source files (matching the concept's globs in `scribe.config.json`), emits structural vertices and edges, embeds the concept's SKILL.md verbatim, and writes `scribe-output/<concept>.ast.json`.

## Context

- Runs in the consumer project's CWD. Reads `scribe.config.json` via `loadConfig()`.
- Loads ts-morph `Project` from `config.tsconfig` (path relative to consumer repo root).
- Resolves the concept's `globs` against the consumer repo root → set of source files.
- Reads `config.concepts[concept].skill` (path to SKILL.md) — embeds body + sha256 contentHash into ast.json.

### Vertex types and detection rules

- `store` — Zustand store: pattern `create<...>()((set, get) => ({ ... }))` or `create((set, get) => ({...}))`. The whole `create(...)` call expression is the vertex.
- `store-state` — keys in the store object literal that are non-functions (data fields).
- `store-action` — keys that are functions (action methods).
- `function` — top-level exported/non-exported `function` declarations and arrow function const exports that aren't components or hooks.
- `hook` — function whose name starts with `use` + camelCase (e.g. `useDndWorkorderList`).
- `component` — function whose name is PascalCase and returns JSX.
- `type-def` — `type X = ...` and `interface X { ... }`.
- `effect` — `useEffect(() => ..., [...])` callsite. Vertex = the useEffect call.
- `callsite` — reserved for explicit cross-concept reference call sites (rarely emitted by AST; mostly agent territory).

### Edge types AST emits

- `calls` — fn A's body calls fn B (B is a vertex in scope). Resolve via `getReferencedSymbols` / `findReferences`.
- `reads` — store action body reads a `store-state` key (via `get().X` or `useStore(s => s.X)`).
- `writes` — store action body writes a key via `set({ X: ... })` or `set(s => ({ X: ... }))`.
- `mounts` — component A renders component B (JSX child).
- `uses-hook` — component or hook A calls hook B.
- `has-type` — function signature references type-def vertex.

(Skip: `subscribes`, `delegates-to`, `triggers`, `describes`, `documented-by` — those come from agent or apply-time logic.)

### Vertex `_key`

`sha1(concept + "::" + filepath + "::" + name + "::" + type)` — first 32 hex chars.

### `displayKey`

`"<concept>::<type>::<name>"`.

### `contentHash`

`sha256(node.getText())` — base16. Used by apply to detect body changes.

### Edge `_key`

`sha1(_from + "|" + _to + "|" + type + "|" + line)` — first 32 hex chars.

### Output schema (`<concept>.ast.json`)

```json
{
  "concept": "workorder-store",
  "vertices": [ /* Vertex[] */ ],
  "edges": [ /* Edge[] */ ],
  "skill": {
    "path": ".claude/skills/workorder-store/SKILL.md",
    "body": "<verbatim file contents>",
    "contentHash": "sha256:..."
  },
  "meta": {
    "extractor_version": "code-graph@0.1.0",
    "extracted_at": "2026-04-25T..."
  }
}
```

Each vertex emitted in extract has only AST-owned fields populated; agent fields (`purpose`, `inputs`, `outputs`, `cross_concept_refs`, `document_ref`, `tags`, `agent.*`) are omitted (agent populates later in enrich).

`status: "live"` set by apply, not extract.

## Tasks

1. Create `src/scribe/extract.ts`. Entrypoint: `extract(conceptName: string): Promise<void>`.
2. Load config. Resolve consumer repo root (`config.configRoot`). Load `Project` from `<configRoot>/<config.tsconfig>`.
3. Resolve `config.concepts[conceptName].globs` against `configRoot` — get list of `SourceFile`s from the ts-morph project (filter `project.getSourceFiles()` by matching path).
4. For each source file, walk the AST:
   - Detect Zustand `create(...)` calls → emit `store` vertex; recurse into the object literal to emit `store-state` and `store-action` children.
   - Top-level fn/arrow-fn declarations → classify as hook (`use[A-Z]...`), component (PascalCase + returns JSX), or function.
   - Top-level `type` / `interface` → emit `type-def` vertex.
   - `useEffect(...)` calls → emit `effect` vertex (`name` = `"effect-${line}"`).
5. Compute `contentHash = sha256(node.getText())` per vertex.
6. Compute `_key` and `displayKey` per vertex.
7. Build edges:
   - `calls` / `uses-hook` — for each fn/hook/component/store-action vertex, find `CallExpression`s in body. Resolve callee symbol via `getSymbol()`; follow `getAliasedSymbol()` to bridge import aliases (so cross-file calls resolve to the original declaration). If the resolved symbol's declaration node is a registered vertex, emit `uses-hook` when target is a `hook`, else `calls`.
   - `reads` / `writes` — within store actions, scan for `set({...})` / `set(s => ({...}))` (writes), `get().X` (reads), and `useStore(s => s.X)` selectors against the *parent* store (reads). Match property names against `store-state` vertices belonging to the **same parent store** (tracked via a `vertexToStore` map) — avoids name collisions when a concept extracts multiple stores.
   - `mounts` — within component bodies, find JSX elements (`JsxOpeningElement` + `JsxSelfClosingElement`) whose tag resolves to another component vertex.
   - `has-type` — for fn/hook/component/store-action bodies, find `TypeReference` nodes whose type name resolves to a `type-def` vertex.

   Store imports: when emitting a `store` vertex, alias the enclosing `VariableDeclaration` in `nodeToKey` so that downstream resolution of `import { useFooStore }` finds the store vertex (the symbol's declaration is the variable, not the `create(...)` call).
8. For all edges, set `concept` = current concept and `crosses_concept = false` (apply will recompute when joining across concepts; in v1 a single concept extract has all endpoints in same concept).
9. Read `<configRoot>/<config.concepts[concept].skill>` → embed body + sha256 contentHash into output `skill` field.
10. Set `meta.extractor_version` from `package.json` version. Set `extracted_at` ISO timestamp.
11. Ensure `<configRoot>/scribe-output/` exists. Write `<concept>.ast.json` (pretty-printed JSON).
12. Wire `code-graph extract <concept>` in `src/cli.ts`.
13. Print summary: `<N> vertices, <M> edges, skill body <K> chars` to stderr.

## Done when

- `cd ~/Documents/gits/lichens-ordonnancement-ui && code-graph extract workorder-store` succeeds.
- Output file `scribe-output/workorder-store.ast.json` exists.
- Vertex count is in the 15–25 range expected by the pilot.
- Skill body present, non-empty (matches `wc -c .claude/skills/workorder-store/SKILL.md`).
- At least one `calls` edge resolves between two emitted vertices.
- Re-running extract twice produces byte-identical output (deterministic IDs and ordering).

## Pitfalls

- ts-morph reference resolution requires the right `tsconfig` — verify `tsconfig.app.json` includes the workorder-store globs (in lichens that's the app tsconfig, not the root).
- Sort vertices and edges by `_key` before writing for determinism.
- For multiline JSX, `getText()` includes whitespace — that's fine, it's hashed consistently across runs.
