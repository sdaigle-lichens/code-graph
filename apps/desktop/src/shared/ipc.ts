// The IPC contract, shared by main / preload / renderer.
//
// Type-only apart from the two channel tables. Nothing here imports the code-graph library — that
// import belongs to exactly one main-process module (`main/graph.ts`), which asserts at compile
// time that the library's own types are assignable to the mirrors declared below. The renderer
// therefore never has the library, or node, in its type graph.

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

/**
 * Every call resolves to one of these — a main-process handler may throw freely, and the wrapper in
 * `main/ipc.ts` turns the throw into `{ ok: false }`, so the renderer always has something to render.
 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ProjectRef {
  root: string;
  name: string;
  lastOpened: string;
}

export interface ProjectState {
  current: ProjectRef | null;
  recent: ProjectRef[];
}

export type ProjectPickOutcome = { cancelled: true; state: ProjectState } | { cancelled: false; state: ProjectState };

// ─── Graph status ─────────────────────────────────────────────────────────────

export interface StoreCounts {
  /** Live vertices only. */
  vertices: number;
  /** Edges not archived. */
  edges: number;
  /** Docs not archived. */
  docs: number;
}

export interface GraphStatus {
  root: string;
  config: {
    /** Absolute path of the scribe.config.json that was found (may be in an ancestor of `root`). */
    path: string;
    configRoot: string;
    project: string;
    tsconfig: string;
  } | null;
  /** Set when a config file exists but does not parse, so the UI can say why `config` is null. */
  configError: string | null;
  store: {
    /** The file exists. False also whenever there is no config to resolve a path from. */
    present: boolean;
    path: string | null;
    /** `PRAGMA user_version`; null when there is no store or it could not be read. */
    schemaVersion: number | null;
    expectedSchemaVersion: number;
    schemaMatches: boolean;
    counts: StoreCounts | null;
    error: string | null;
  };
  /** Defaults offered when there is no config. */
  defaults: { project: string; tsconfig: string };
}

export interface GraphInitInput {
  projectRoot?: string;
  project: string;
  tsconfig: string;
}

// ─── Concepts ─────────────────────────────────────────────────────────────────

export interface ConceptSummary {
  name: string;
  /** Present in scribe.config.json. False for a concept that only has live vertices in the store. */
  inConfig: boolean;
  globs: string[];
  skill: string | null;
  liveVertices: number;
  liveEdges: number;
  /** A skill document row exists in the store. */
  hasSkillDoc: boolean;
  badges: {
    /** Zero live vertices. */
    neverExtracted: boolean;
    /** Live vertices exist, none carries an agent-written purpose. */
    neverEnriched: boolean;
    /** No `docs/<concept>::skill` row. */
    noSkillDoc: boolean;
  };
  /** The exact copyable command that populates the concept; run from the config root. */
  extractCommand: string;
}

export interface ConceptListResult {
  configRoot: string | null;
  /** False when there is no store, or its schema does not match; counts are then all zero. */
  storeAvailable: boolean;
  concepts: ConceptSummary[];
}

export interface ConceptAddInput {
  projectRoot?: string;
  name: string;
  globs: string[];
  /** Path to the skill markdown, relative to the config root. */
  skill?: string;
}

export interface ConceptDeleteInput {
  projectRoot?: string;
  name: string;
  /**
   * The two-step. `false` computes and returns the dangling-reference report and changes nothing;
   * `true` archives the rows, removes the concept from the config and rebuilds the search index.
   */
  confirm: boolean;
}

export interface DanglingRefInfo {
  fromConcept: string;
  kind: "cross_concept_ref" | "agent_edge";
  description: string;
}

export type ConceptDeleteResult =
  | {
      stage: "preview";
      name: string;
      liveVertices: number;
      danglingRefs: DanglingRefInfo[];
      reportMd: string;
      note: string;
    }
  | {
      stage: "deleted";
      name: string;
      archivedVertices: number;
      archivedEdges: number;
      danglingRefs: DanglingRefInfo[];
      reportMd: string;
    };

// ─── Concept graph (typed here, rendered by the canvas task) ──────────────────

/** Structural mirrors of the library's Vertex / Edge / DocVertex; main asserts assignability. */
export interface GraphVertex {
  _key: string;
  displayKey: string;
  concept: string;
  type: string;
  name: string;
  filepath: string;
  start_line: number;
  end_line: number;
  signature: string;
  purpose?: string;
  inputs?: string[];
  outputs?: string[];
  cross_concept_refs?: string[];
  tags?: string[];
  status: "live" | "archived";
  /** `stale` is set when the body changed after the purpose was written. */
  agent?: { authored_by: "claude" | null; stale: boolean };
}

export interface GraphEdge {
  _key: string;
  _from: string;
  _to: string;
  /** `_from` with its collection prefix stripped by the library's `keyOf`; equals a vertex `_key`. */
  fromKey: string;
  /** `_to` with its collection prefix stripped by the library's `keyOf`. May match no vertex (cross-concept). */
  toKey: string;
  type: string;
  concept: string;
  line?: number;
  crosses_concept?: boolean;
}

export interface GraphSkillDoc {
  _key: string;
  concept: string;
  kind: string;
  path: string;
  body_md: string;
  body_hash: string;
}

export interface ConceptGraph {
  concept: string;
  vertices: GraphVertex[];
  edges: GraphEdge[];
  doc: GraphSkillDoc | null;
}

export interface ConceptGraphInput {
  projectRoot?: string;
  concept: string;
}

// ─── The renderer API ─────────────────────────────────────────────────────────

/**
 * `projectRoot` is a VIEWING parameter, forwarded as-is. Main honors it only when it equals the open
 * project or a recent one, and otherwise falls back to the open project — so it cannot aim a read
 * at an arbitrary directory. Omit it to mean "the open project".
 */
export interface CodeGraphApi {
  project: {
    get(): Promise<Result<ProjectState>>;
    /** Native directory chooser; a chosen directory is added to the recent list and opened. */
    pick(): Promise<Result<ProjectPickOutcome>>;
    /** Only a root already in the recent list (or the open project) can be opened. */
    open(root: string): Promise<Result<ProjectState>>;
    forget(root: string): Promise<Result<ProjectState>>;
    /** Returns an unsubscribe function. */
    onChanged(cb: (state: ProjectState) => void): () => void;
  };
  graph: {
    status(projectRoot?: string): Promise<Result<GraphStatus>>;
    /** Creates scribe.config.json only (no store, no output dir). Only ever called on user accept. */
    init(input: GraphInitInput): Promise<Result<GraphStatus>>;
  };
  concept: {
    list(projectRoot?: string): Promise<Result<ConceptListResult>>;
    add(input: ConceptAddInput): Promise<Result<ConceptListResult>>;
    delete(input: ConceptDeleteInput): Promise<Result<ConceptDeleteResult>>;
    graph(input: ConceptGraphInput): Promise<Result<ConceptGraph>>;
  };
}
