// THE ONE MODULE THAT IMPORTS THE code-graph LIBRARY. test/isolation.test.ts holds it to that.
//
// It composes only the library's pure surface (`code-graph`'s index): `tryLoadConfig` rather than
// `loadConfig`, and `archiveConcept` + `removeConceptFromConfig` rather than `deleteConcept` — the
// latter call `process.exit` and write to stdout, which in this process would be a crashed app.
//
// Two hazards shape everything below:
//
//  1. `getStore()` CREATES the directory and the database file as a side effect of being called.
//     Every read path therefore goes through `openStore`, which checks the file exists first, so
//     merely browsing to a directory never leaves a store behind. Nothing here creates one: the store
//     is made by the CLI's `apply`.
//  2. Handles are cached in a module-level map built for a short-lived CLI. This process is
//     long-lived, so `closeAllStores` runs on project switch and on quit; `useProject` also closes
//     them when a request names a different project than the previous one, so a viewing-only read of
//     a recent project cannot leave a handle behind either.

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  SCHEMA_VERSION,
  archiveConcept,
  closeStores,
  computeDanglingRefs,
  formatDanglingRefReport,
  getStore,
  keyOf,
  queryConcept,
  removeConceptFromConfig,
  resolveDbPath,
  toDocs,
  tryLoadConfig,
} from "code-graph";
import type { ConceptResult, ScribeConfig } from "code-graph";
import {
  addConcept,
  extractCommand,
  initialConfig,
  serializeConfig,
  validateConceptName,
  validateGlobs,
  validateSkillPath,
  type RawConfig,
} from "./config-edit.js";
import type {
  ConceptAddInput,
  ConceptDeleteInput,
  ConceptDeleteResult,
  ConceptGraph,
  ConceptGraphInput,
  ConceptListResult,
  ConceptSummary,
  DanglingRefInfo,
  GraphInitInput,
  GraphStatus,
  StoreCounts,
} from "../shared/ipc.js";

// The shared mirrors must stay assignable from what the library actually returns. Fails typecheck,
// not runtime, when the library's shape drifts from the contract the canvas will build against.
type AssertAssignable<_T extends U, U> = true;
export type _ConceptGraphMirrorsLibrary = AssertAssignable<
  ConceptResult,
  {
    vertices: ConceptGraph["vertices"];
    edges: Omit<ConceptGraph["edges"][number], "fromKey" | "toKey">[];
    doc: ConceptGraph["doc"];
  }
>;

const CONFIG_FILE = "scribe.config.json";
const LIVE_EDGE = "coalesce(json_extract(doc, '$.status'), 'live') != 'archived'";

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);

// ─── Handle lifecycle ─────────────────────────────────────────────────────────

let lastRoot: string | null = null;

/** Close every cached handle. Called on project switch, on forget, and on quit. */
export function closeAllStores(): void {
  closeStores();
  lastRoot = null;
}

function useProject(root: string): void {
  if (lastRoot !== null && lastRoot !== root) closeStores();
  lastRoot = root;
}

function requireRoot(root: string): string {
  if (!root) throw new Error("No project is open.");
  let isDir = false;
  try {
    isDir = statSync(root).isDirectory();
  } catch {
    /* fallthrough */
  }
  if (!isDir) throw new Error(`Project directory not found: ${root}`);
  useProject(root);
  return root;
}

/** True only for a directory that exists — used to validate a picked or reopened root. */
export function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// ─── Config + store access ────────────────────────────────────────────────────

function configPathOf(config: ScribeConfig): string {
  return join(config.configRoot, CONFIG_FILE);
}

function readRaw(config: ScribeConfig): RawConfig {
  return JSON.parse(readFileSync(configPathOf(config), "utf8")) as RawConfig;
}

function writeRaw(config: ScribeConfig, raw: RawConfig): void {
  writeFileSync(configPathOf(config), serializeConfig(raw), "utf8");
}

type OpenedStore =
  | { kind: "absent"; path: string }
  | { kind: "mismatch"; path: string; version: number | null }
  | { kind: "ok"; path: string; store: DatabaseSync };

function readUserVersion(store: DatabaseSync): number {
  return num((store.prepare("PRAGMA user_version").get() as Row).user_version);
}

/** The only door to a store on a read path: never creates one. */
function openStore(config: ScribeConfig): OpenedStore {
  const path = resolveDbPath(config);
  if (!existsSync(path)) return { kind: "absent", path };
  const store = getStore(path);
  const version = readUserVersion(store);
  if (version !== SCHEMA_VERSION) return { kind: "mismatch", path, version };
  return { kind: "ok", path, store };
}

function counts(store: DatabaseSync): StoreCounts {
  const one = (sql: string) => num((store.prepare(sql).get() as Row).c);
  return {
    vertices: one("SELECT count(*) AS c FROM vertices WHERE status = 'live'"),
    edges: one(`SELECT count(*) AS c FROM edges WHERE ${LIVE_EDGE}`),
    docs: one(`SELECT count(*) AS c FROM docs WHERE ${LIVE_EDGE}`),
  };
}

// ─── Status ───────────────────────────────────────────────────────────────────

export function graphStatus(root: string): GraphStatus {
  requireRoot(root);
  const defaults = { project: basename(root), tsconfig: "tsconfig.json" };
  const base = (over: Partial<GraphStatus>): GraphStatus => ({
    root,
    config: null,
    configError: null,
    store: {
      present: false,
      path: null,
      schemaVersion: null,
      expectedSchemaVersion: SCHEMA_VERSION,
      schemaMatches: false,
      counts: null,
      error: null,
    },
    defaults,
    ...over,
  });

  const config = tryLoadConfig(root);
  if (!config) {
    // tryLoadConfig folds "no file" and "file does not parse" into null; tell them apart.
    const own = join(root, CONFIG_FILE);
    return base({ configError: existsSync(own) ? `${own} exists but is not a valid scribe config.` : null });
  }

  const info = {
    path: configPathOf(config),
    configRoot: config.configRoot,
    project: config.project,
    tsconfig: config.tsconfig,
  };
  let opened: OpenedStore;
  try {
    opened = openStore(config);
  } catch (err) {
    return base({
      config: info,
      store: {
        present: true,
        path: resolveDbPath(config),
        schemaVersion: null,
        expectedSchemaVersion: SCHEMA_VERSION,
        schemaMatches: false,
        counts: null,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
  const store: GraphStatus["store"] = {
    present: opened.kind !== "absent",
    path: opened.path,
    schemaVersion: opened.kind === "mismatch" ? opened.version : opened.kind === "ok" ? SCHEMA_VERSION : null,
    expectedSchemaVersion: SCHEMA_VERSION,
    schemaMatches: opened.kind === "ok",
    counts: null,
    error: null,
  };
  if (opened.kind === "ok") {
    try {
      store.counts = counts(opened.store);
    } catch (err) {
      store.error = err instanceof Error ? err.message : String(err);
    }
  }
  return base({ config: info, store });
}

/** Create scribe.config.json ONLY — no store, no output directory. The user's explicit accept. */
export function initProject(root: string, input: GraphInitInput): GraphStatus {
  requireRoot(root);
  if (tryLoadConfig(root)) throw new Error("A scribe config already exists for this project.");
  const project = typeof input?.project === "string" ? input.project.trim() : "";
  const tsconfig = typeof input?.tsconfig === "string" ? input.tsconfig.trim() : "";
  if (!project) throw new Error("Project name is required.");
  if (!tsconfig) throw new Error("tsconfig path is required.");
  const file = join(root, CONFIG_FILE);
  // `wx`: never clobber a file `tryLoadConfig` rejected as invalid.
  writeFileSync(file, serializeConfig(initialConfig(project, tsconfig)), { encoding: "utf8", flag: "wx" });
  const config = tryLoadConfig(root);
  if (!config) throw new Error("Wrote scribe.config.json but could not read it back.");
  return graphStatus(root);
}

// ─── Concepts ─────────────────────────────────────────────────────────────────

function summaries(config: ScribeConfig, opened: OpenedStore): ConceptListResult {
  const live = new Map<string, { vertices: number; enriched: number; edges: number }>();
  const skillDocs = new Set<string>();
  if (opened.kind === "ok") {
    const { store } = opened;
    for (const r of store
      .prepare(
        `SELECT concept, count(*) AS v,
                sum(CASE WHEN coalesce(json_extract(doc, '$.purpose'), '') != '' THEN 1 ELSE 0 END) AS e
           FROM vertices WHERE status = 'live' GROUP BY concept`
      )
      .all() as Row[]) {
      live.set(String(r.concept), { vertices: num(r.v), enriched: num(r.e), edges: 0 });
    }
    for (const r of store
      .prepare(`SELECT concept, count(*) AS c FROM edges WHERE ${LIVE_EDGE} GROUP BY concept`)
      .all() as Row[]) {
      const entry = live.get(String(r.concept));
      if (entry) entry.edges = num(r.c);
    }
    for (const r of store.prepare(`SELECT concept FROM docs WHERE ${LIVE_EDGE}`).all() as Row[]) {
      if (typeof r.concept === "string") skillDocs.add(r.concept);
    }
  }

  // The store's `concepts` table only gets a row when a concept declares a skill, so it is NOT a
  // list of concepts. The list is the config's keys unioned with the distinct live-vertex concepts.
  const names = [...new Set([...Object.keys(config.concepts ?? {}), ...live.keys()])].sort();
  const concepts: ConceptSummary[] = names.map((name) => {
    const cfg = config.concepts?.[name];
    const stats = live.get(name) ?? { vertices: 0, enriched: 0, edges: 0 };
    const hasSkillDoc = skillDocs.has(name);
    return {
      name,
      inConfig: !!cfg,
      globs: cfg?.globs ?? [],
      skill: cfg?.skill ?? null,
      liveVertices: stats.vertices,
      liveEdges: stats.edges,
      hasSkillDoc,
      badges: {
        neverExtracted: stats.vertices === 0,
        neverEnriched: stats.vertices > 0 && stats.enriched === 0,
        noSkillDoc: !hasSkillDoc,
      },
      extractCommand: extractCommand(config.configRoot, name),
    };
  });
  return { configRoot: config.configRoot, storeAvailable: opened.kind === "ok", concepts };
}

export function listConcepts(root: string): ConceptListResult {
  requireRoot(root);
  const config = tryLoadConfig(root);
  if (!config) return { configRoot: null, storeAvailable: false, concepts: [] };
  return summaries(config, openStore(config));
}

function requireConfig(root: string): ScribeConfig {
  requireRoot(root);
  const config = tryLoadConfig(root);
  if (!config) throw new Error("This project has no scribe config yet.");
  return config;
}

export function addConceptToProject(root: string, input: ConceptAddInput): ConceptListResult {
  const config = requireConfig(root);
  const name = validateConceptName(input?.name);
  const globs = validateGlobs(input?.globs);
  const skill = validateSkillPath(input?.skill);
  writeRaw(config, addConcept(readRaw(config), { name, globs, skill }));
  return listConcepts(root);
}

type VertexSummary = { _key: string; concept: string; name?: string; cross_concept_refs?: string[] };
type EdgeSummary = {
  _from: string;
  _to: string;
  concept: string;
  type?: string;
  agent?: { authored_by?: string | null };
};

/** The CLI's own dangling-ref collection, minus its stdout and its readline prompt. */
function danglingFor(store: DatabaseSync, name: string): { refs: DanglingRefInfo[]; liveVertices: number } {
  const mine = toDocs<VertexSummary>(store.prepare("SELECT doc FROM vertices WHERE concept = ?").all(name) as never);
  const others = toDocs<VertexSummary>(
    store
      .prepare(
        `SELECT doc FROM vertices
          WHERE concept != ? AND status = 'live'
            AND json_array_length(coalesce(json_extract(doc, '$.cross_concept_refs'), '[]')) > 0`
      )
      .all(name) as never
  );
  const edges = toDocs<EdgeSummary>(
    store.prepare("SELECT doc FROM edges WHERE concept != ? AND authored_by IS NOT NULL").all(name) as never
  );
  const liveVertices = num(
    (store.prepare("SELECT count(*) AS c FROM vertices WHERE concept = ? AND status = 'live'").get(name) as Row).c
  );
  return {
    refs: computeDanglingRefs(name, new Set(mine.map((v) => v._key)), others, edges),
    liveVertices,
  };
}

const DELETE_NOTE =
  "Deleting archives the concept's rows and removes it from scribe.config.json. Its scribe-output/<concept>.ast.json and .enriched.json files are left on disk.";

export function deleteConceptFromProject(root: string, input: ConceptDeleteInput): ConceptDeleteResult {
  const config = requireConfig(root);
  const name = validateConceptName(input?.name);
  const opened = openStore(config);
  const store = opened.kind === "ok" ? opened.store : null;
  if (opened.kind === "mismatch") {
    throw new Error(`The graph store schema (${opened.version}) does not match this build (${SCHEMA_VERSION}).`);
  }
  const inConfig = !!config.concepts?.[name];
  const { refs, liveVertices } = store ? danglingFor(store, name) : { refs: [], liveVertices: 0 };
  if (!inConfig && liveVertices === 0) throw new Error(`Concept "${name}" not found.`);
  const reportMd = formatDanglingRefReport(refs);

  if (!input.confirm) return { stage: "preview", name, liveVertices, danglingRefs: refs, reportMd, note: DELETE_NOTE };

  // archiveConcept rebuilds the full-text index inside its own transaction.
  const archived = store
    ? archiveConcept(store, name, new Date().toISOString())
    : { archivedVertices: 0, archivedEdges: 0 };
  if (inConfig) writeRaw(config, removeConceptFromConfig(readRaw(config), name) as RawConfig);
  return { stage: "deleted", name, ...archived, danglingRefs: refs, reportMd };
}

export async function conceptGraph(root: string, input: ConceptGraphInput): Promise<ConceptGraph> {
  const config = requireConfig(root);
  const concept = validateConceptName(input?.concept);
  const opened = openStore(config);
  if (opened.kind !== "ok") throw new Error("There is no usable graph store for this project.");
  const { vertices, edges, doc } = await queryConcept(opened.store, concept);
  return { concept, vertices, edges: edges.map(withEndpointKeys), doc };
}

/** Additive: `_from`/`_to` stay as stored; the renderer reads the resolved keys and never splits a handle. */
export function withEndpointKeys<E extends { _from: string; _to: string }>(
  e: E
): E & { fromKey: string; toKey: string } {
  return { ...e, fromKey: keyOf(e._from), toKey: keyOf(e._to) };
}
