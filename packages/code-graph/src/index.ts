// The package's programmatic surface — what an in-process consumer (the desktop app's Electron
// main process) is allowed to reach for. The subpath exports in package.json expose the same
// modules individually; this barrel is the curated view.
//
// What is deliberately NOT re-exported here, and why:
//
//   - `loadConfig` (config.ts) and `deleteConcept` (scribe/delete-concept.ts) — both call
//     `process.exit` and write to stdout. They are the CLI's own entrypoints. A host process that
//     exits because a config was missing is a crashed app, so consumers take `tryLoadConfig` and
//     compose the pure pieces (`archiveConcept`, `removeConceptFromConfig`, …) instead.
//   - everything in `query/preflight.ts`, `query/run.ts` and `search()` — same reason: those own
//     the CLI's exit codes and its markdown-to-stdout rendering.
//   - `scribe/extract.ts` and `catalog/catalog.ts` — the only modules that pull in `ts-morph`.
//     Keeping them off this surface keeps a bundler from following the whole TypeScript compiler
//     into a consumer's build.

export { tryLoadConfig } from "./config.js";
export type { ScribeConfig } from "./config.js";

export { VertexSchema, EdgeSchema, AstDocSchema, DocRecordSchema, ConceptRecordSchema } from "./schema.js";
export type { Vertex, Edge, AstDoc, DocRecord, ConceptRecord } from "./schema.js";

export {
  oneHop,
  twoHops,
  skillDoc,
  queryConcept,
  queryImpact,
  queryCross,
  queryFile,
  queryVertex,
  queryVertexByName,
} from "./query/queries.js";
export type {
  DocVertex,
  ConceptResult,
  ImpactEntry,
  ImpactResult,
  CrossEntry,
  VertexResult,
  VertexLookupResult,
  EdgeNeighbor,
  FileVertexEntry,
  FileResult,
} from "./query/queries.js";

export { resolveDbPath, getStore, closeStores } from "./scribe/db.js";
export { SCHEMA_VERSION, FTS_WEIGHTS, applySchema, rebuildSearchIndex, bootstrapStore } from "./scribe/bootstrap.js";
export {
  toDoc,
  toDocs,
  vertexId,
  docKey,
  docId,
  keyOf,
  toMatchExpr,
  getRecord,
  putRecord,
  mergeRecord,
  inTransaction,
} from "./scribe/rows.js";
export type { DocRow, StoreTable } from "./scribe/rows.js";

export {
  removeConceptFromConfig,
  computeDanglingRefs,
  formatDanglingRefReport,
  archiveConcept,
} from "./scribe/delete-concept.js";
export type { DanglingRef } from "./scribe/delete-concept.js";
