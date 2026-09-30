# Concept graph canvas

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The view this whole effort exists for: pick a concept and see its graph drawn — vertices as nodes, edges as edges, laid out automatically — restoring the visual inspection that was lost when the graph store moved from ArangoDB to embedded SQLite.

A concept selector at the top of the graph page drives a canvas below it. Selecting a concept fetches that concept's live vertices, edges and skill document over the channel the previous task established, and lays them out with a directed layered layout flowing left to right, with enough rank separation to read the labels and tight node separation so a hundred-odd nodes still fit a screen. Each vertex becomes a node labeled with its name and, underneath, its file path and starting line. Node color is keyed off the vertex type, and edge styling off the edge type, all from the shared design tokens so both light and dark themes hold up. When the concept has a skill document, it gets a visually distinct root node of its own.

A toolbar of edge-type toggles with live counts filters what is drawn, and the layout recomputes when a toggle or the selected concept changes. **The documentation edges start off.** This is not a preference, it is what the data demands: in this repo's store 74 of 313 edges are documentation edges, and every single one of them fans out from the one skill-document node to every live vertex in the concept. Drawn by default, the graph is one hub wired to everything and the layout communicates nothing. Turned on deliberately, that same hub-and-spoke is the useful answer to "what does this skill document cover".

Clicking a node opens a side panel on that vertex: its signature, its agent-written purpose, its inputs and outputs, its tags, its file path with the line range, a flag when the purpose is marked stale against the current body, and its neighbors — derived from the edges already fetched, no second round trip — each one a link that selects that node in turn.

Two things to get right rather than reinvent:

- **Edge endpoints are document handles, not bare keys.** The stored edge endpoints carry a collection prefix inherited from the graph's ArangoDB era. The library already exports the helper that strips it. Use that helper, not a local string split, so that when the handle format changes there is one place to change it.
  **Process boundary (from task 001):** the renderer may not import the library — the isolation test allows exactly one main-process importer, `apps/desktop/src/main/graph.ts`. So the helper (`keyOf` in `scribe/rows.ts`) must be applied in the main process: extend the `graph:concept` payload additively with resolved endpoint keys on each edge (e.g. `fromKey` / `toKey`), keeping `_from` / `_to`, the channel names and the existing shape intact. The renderer reads those fields and never splits a handle itself. Export `keyOf` from the library's `index.ts` if it is not already, and update the mirror type and isolation test accordingly.
- **Cross-concept edges.** `vertices` holds only the requested concept's vertices, so an edge can point at a vertex outside it (when `crosses_concept` is set). The canvas must tolerate edge endpoints with no matching node — skip them in the layout (or render them as a distinct stub) rather than crash — and a unit test must cover it.
- **Node identity is the vertex key.** It is a content-addressed hash of concept, file path, name and type, stable across re-extraction, which is what makes selection survive a refetch.

One reality check on scope, discovered by inspecting the actual store rather than the schema: the schema declares nine vertex types and eleven edge types, but this repo's own graph — a TypeScript command-line tool with no React in it — only ever produces two vertex types (plain functions and type definitions) and four edge types (calls, has-type, documented-by and describes). Build the full palette, because the React and state-store types are exactly what a consumer project will be full of, but do not expect to verify every color against this repo. Verifying the full palette needs a React project's graph, and the honest acceptance criterion here is that the types this store actually contains render correctly and the rest are defined and unit-testable.

## Acceptance criteria

- [ ] Selecting the search concept renders its 74 nodes laid out left to right with documentation edges off, and the labels are legible without zooming in.
- [ ] Toggling documentation edges on collapses the view into a visible hub-and-spoke from the skill-document node, and toggling it off restores the previous layout.
- [ ] The edge-type toolbar shows the four edge types this store actually contains with their real counts — calls 152, has-type 86, documented-by 74, describes 1 — and each toggle recomputes the layout.
- [ ] Switching concepts re-fetches and re-lays out without a reload, and selecting the pipeline concept shows its 54 nodes.
- [ ] Clicking the search function's node opens a side panel showing its signature and its file path with the line range, and its neighbor links select the neighboring node when clicked.
- [ ] A vertex whose purpose is marked stale against its current body is visibly flagged as such in the panel.
- [ ] Node colors are defined for all nine vertex types and edge styles for all eleven edge types, drawn from shared design tokens, and both themes are readable; the types absent from this repo's store are covered by a unit test rather than by eye.
- [ ] Edge endpoints are resolved with the library's handle helper, and no local string splitting of handles exists in the renderer.
- [ ] The workspace-wide build, typecheck, format check and test tasks are all green from the repo root, and the built app — not just the development server — renders the canvas correctly when run over the file protocol.

## Blocked by

- `001-desktop-app-shell-with-project-and-concept-management.md`

## Post-Mortem

- **Problem:** Reviewer failed the first pass. The panel showed no stale flag for a stale vertex that has no purpose, so AC6 was only partly met.
  **Fix:** none
- **Problem:** The neighbor list showed duplicate rows for repeated has-type and calls edges to the same target, which inflated the count.
  **Fix:** none
- **Problem:** Toggling documented-by on moved the skill-doc node off-screen, so the hub-and-spoke was not visible (AC2).
  **Fix:** none
