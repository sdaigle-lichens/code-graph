# Desktop app shell with project and concept management

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

A desktop application for code-graph that lets a human pick a project on disk, see whether code-graph is installed in it and what its graph store holds, and manage that project's concepts — the surface that replaces the graph inspection ArangoDB used to provide before the store became embedded SQLite.

The app opens on a project picker: a list of recently opened project directories persisted in the app's user-data directory, plus a native directory-chooser to add one. Choosing a project navigates to that project's page, which answers three questions at a glance: is there a scribe config here (and where), is there a graph store (and does its schema version match the one this build of the library expects), and what does the store contain — vertex, edge and doc counts overall and per concept. Below that, one row per concept showing its name, its globs, its live vertex and edge counts, and badges for the states that explain an empty or suspicious graph: never extracted, never enriched, no skill document. A project with no scribe config gets an offer to create one, with the project name defaulting to the directory basename and the tsconfig path defaulting to the conventional one.

Concepts can be added (name, globs, optional skill-document path) and deleted. Deletion is a two-step: first show the dangling-reference report the library computes — the cross-concept references that will break — then on confirmation archive the concept's rows, drop it from the scribe config, and rebuild the full-text index.

Running the extract and apply pipeline from the app is deliberately out of scope, which means a freshly added concept legitimately has zero vertices until the pipeline runs on the command line. Do not hide that: a concept row with no extraction shows the exact copyable command that would populate it, so nobody has to guess why a graph is empty.

Grounding facts that shape the build:

- **The main process can read the store directly.** Electron 40.10.6 ships Node 24.15, where `node:sqlite` is available unflagged. There is no CLI subprocess in the read path. This was verified, not assumed.
- **Only one module may import the code-graph library.** That library exposes a curated programmatic surface — a config loader that returns null instead of exiting, store-path resolution, a store handle cache, schema version and index rebuild, the concept query, and the concept-deletion primitives. Everything that calls `process.exit` or writes to stdout belongs to the CLI and is deliberately absent from that surface. Compose the pure pieces; never reach past them into the CLI runners.
- **Opening a project must never create a store.** The library's store-handle helper creates the directory and the database file as a side effect of being called. Every read path has to check the file exists first. Merely browsing to a project directory in the app must not leave a graph store behind in it.
- **Store handles are cached in a module-level map**, which was designed for a short-lived CLI process. A long-lived app has to close them on project switch and on quit, or it holds file handles on a database the user has moved on from.
- **Listing concepts needs the union of two sources.** The store's concepts table only gets a row when a concept declares a skill document, so reading that table alone hides concepts. The list is the scribe config's concept keys unioned with the distinct concepts among live vertices. This repo's own graph proves it: one of its two concepts has 54 live vertices and no concepts row.

Porting the shared design-system packages from the reference Turborepo is part of this task, not a task of its own — it is the prefactor this work needs, and it already contains nearly every component both pages want: a chip input for globs, a dialog, copyable text, a select, a slide-over panel, toasts and form fields. Copy the styles and UI packages as they are, names unchanged, including the vendored font files and the font-vendoring script. Keep the class-based dark mode and the parser-blocking theme bootstrap script, because the renderer's content-security policy forbids inline script.

The process boundary is the part most worth getting right. The renderer runs with node integration off and context isolation on, and reaches the main process only through a single named namespace exposed on the context bridge — no generic invoke escape hatch, no node builtins in renderer code. Every call returns a discriminated result so a main-process handler can throw freely and the renderer always has something to render. A renderer-supplied project root is honored only when it matches the currently open project or a recent one; anything else degrades to the open project rather than reading an arbitrary directory off the filesystem. A test asserts all of those boundary properties, so a later change that punches a hole in the isolation fails a test rather than shipping.

The channel contract is the one artifact worth pinning down exactly, because the graph canvas that follows builds against it:

```ts
export const IPC = {
  projectGet: "project:get",
  projectPick: "project:pick",
  projectOpen: "project:open",
  projectForget: "project:forget",
  graphStatus: "graph:status",
  graphInit: "graph:init",
  conceptList: "concept:list",
  conceptAdd: "concept:add",
  conceptDelete: "concept:delete",
  conceptGraph: "graph:concept",
} as const;
export const IPC_EVENTS = { projectChanged: "project:changed" } as const;
```

`conceptGraph` is wired and typed in this task even though nothing renders a canvas yet — it returns the concept's live vertices, its edges and its skill document, which is exactly the shape the query layer already produces. The next task consumes it and should not have to change the contract.

Follow the conventions of the existing Turborepo app this repo's monorepo was modeled on: the same Electron build tooling, the same split of type-checking configs between the node and web halves, hash-based routing so the built app works over the file protocol, and the same user-data project store. Where that app solved a problem with a comment explaining a real upstream bug, the comment is the point — carry it over rather than cleaning it up.

## Acceptance criteria

- [ ] The app starts in development mode and opens a window with a project picker; recently opened projects persist across a restart, and one can be removed from the list.
- [ ] Opening this repo's own directory shows a status card with the scribe config path, the store present, the schema version matching the library's, and 128 live vertices / 313 edges / 1 doc.
- [ ] The concept list shows both of this repo's concepts with their real counts — 74 live vertices for the search concept and 54 for the pipeline concept — and the pipeline concept appears even though it has no row in the store's concepts table.
- [ ] Adding a concept with a name and globs round-trips into the project's scribe config file and appears in the list immediately, flagged as never extracted with a copyable command to populate it.
- [ ] Deleting a concept first shows the dangling-reference report, and only on confirmation archives the rows, removes it from the config, and rebuilds the full-text index.
- [ ] Opening a directory that has no scribe config offers to create one, and no graph store or output directory appears in that directory unless the user accepts.
- [ ] The isolation test passes: one exposed namespace, no generic invoke channel, no node builtins imported in renderer code, and the code-graph library imported in exactly one main-process module.
- [ ] Switching projects and quitting both close the cached store handles, verifiable by switching away from a project and confirming the database file is no longer held open.
- [ ] The workspace-wide build, typecheck, format check and test tasks are all green from the repo root, and the existing command-line eval gate still reports 5 of 5.

## Blocked by

None — can start immediately
