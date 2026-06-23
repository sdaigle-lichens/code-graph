# LSP

## Behavior

- The LSP shells out to `code-graph query file <path> --json` per opened/saved buffer (debounced, cached 30 s).
- Hover at any vertex → markdown card with purpose, tags, cross-concept refs, edge counts, callers/callees.
- Code-lens at each vertex's first line → `↓ N · ↑ M · ⇄ K` summary (callees / callers / cross-refs).
- Document-link → click the lens line to jump to the first outbound edge target.
- Go-to-definition (F12) → first outbound target via graph data.
- ArangoDB unreachable: server backs off 60 s, no UI noise after the first message.
- File outside any concept's globs: empty result, no errors.

## CLI underneath

```sh
code-graph query file src/store/workorder.store.ts --json
code-graph query file src/store/workorder.store.ts            # human-readable
```
