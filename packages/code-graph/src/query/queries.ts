import type { DatabaseSync } from "node:sqlite";
import type { Vertex, Edge } from "../schema.js";
import { docKey, keyOf, toDoc, toDocs, vertexId } from "../scribe/rows.js";

type Row = { doc: string };

/** Edge types that `impact` follows: the ones that mean "this runs that". */
const IMPACT_EDGE_TYPES = ["calls", "triggers", "delegates-to"];

const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(", ");

/**
 * One hop of a traversal, as a joined row: the edge plus the vertex at its far
 * end. `INBOUND` follows `_to -> _from`, `OUTBOUND` follows `_from -> _to`.
 */
const HOP = {
  in: { match: "to_id", next: "from_key", nextId: "from_id" },
  out: { match: "from_id", next: "to_key", nextId: "to_id" },
} as const;

/**
 * ArangoDB's edge index walked a vertex's edges in the reverse of the order
 * they were written. That is not meaningful in itself, but it decides both the
 * order neighbours are rendered in and — once the caller de-duplicates — which
 * edge ends up representing a vertex reachable more than one way, so it is
 * reproduced rather than replaced with a nicer order.
 */
const EDGE_SCAN_ORDER = "DESC";

export function oneHop(
  store: DatabaseSync,
  dir: "in" | "out",
  startId: string,
  types: readonly string[] | null,
  crossOnly = false
): Array<{ edge: Edge; vertex: Vertex }> {
  const h = HOP[dir];
  const typeClause = types ? `AND e.type IN (${placeholders(types.length)})` : "";
  const crossClause = crossOnly ? "AND e.crosses_concept = 1" : "";
  const rows = store
    .prepare(
      `SELECT e.doc AS edoc, v.doc AS vdoc
         FROM edges e JOIN vertices v ON v.key = e.${h.next}
        WHERE e.${h.match} = ? ${typeClause} ${crossClause}
        ORDER BY e.rowid ${EDGE_SCAN_ORDER}`
    )
    .all(startId, ...((types ?? []) as string[])) as Array<{ edoc: string; vdoc: string }>;
  return rows.map((r) => ({ edge: JSON.parse(r.edoc) as Edge, vertex: JSON.parse(r.vdoc) as Vertex }));
}

/**
 * Depth-1 and depth-2 hops in one statement.
 *
 * Written out as two legs rather than a recursive CTE: the depth is a fixed 2,
 * so recursion would only add a cycle guard and a path accumulator without
 * buying anything. `e2.key <> d1.ekey` reproduces ArangoDB's `uniqueEdges:
 * "path"`, which stops a traversal from walking straight back down the edge it
 * arrived on.
 */
export function twoHops(
  store: DatabaseSync,
  dir: "in" | "out",
  startId: string,
  types: readonly string[],
  /** SQLite treats a negative limit as unbounded. */
  limit: number
): Array<{ vertex: Vertex; edge: Edge; depth: number }> {
  const h = HOP[dir];
  const ph = placeholders(types.length);
  const rows = store
    .prepare(
      `WITH d1 AS (
         SELECT e.key AS ekey, e.doc AS edoc, e.${h.nextId} AS next_id, e.${h.next} AS next_key, e.rowid AS erow
           FROM edges e
          WHERE e.${h.match} = ? AND e.type IN (${ph})
       )
       SELECT 1 AS depth, d1.edoc AS edoc, v.doc AS vdoc, d1.erow AS r1, 0 AS r2
         FROM d1 JOIN vertices v ON v.key = d1.next_key
       UNION ALL
       SELECT 2, e2.doc, v2.doc, d1.erow, e2.rowid
         FROM d1
         JOIN edges e2 ON e2.${h.match} = d1.next_id
                      AND e2.type IN (${ph})
                      AND e2.key <> d1.ekey
         JOIN vertices v2 ON v2.key = e2.${h.next}
        -- Depth-first: each depth-1 edge is followed immediately by the
        -- depth-2 edges reached through it. This is the order ArangoDB
        -- traversed in, and LIMIT is applied to these raw rows before the
        -- caller de-duplicates, so the order decides which edge represents a
        -- vertex that is reachable more than one way.
        ORDER BY r1 ${EDGE_SCAN_ORDER}, depth, r2 ${EDGE_SCAN_ORDER}
        LIMIT ?`
    )
    .all(startId, ...(types as string[]), ...(types as string[]), limit) as Array<{
    depth: number;
    edoc: string;
    vdoc: string;
  }>;
  return rows.map((r) => ({
    vertex: JSON.parse(r.vdoc) as Vertex,
    edge: JSON.parse(r.edoc) as Edge,
    depth: r.depth,
  }));
}

/**
 * One hop, resolving the far endpoint in whichever table its handle names.
 *
 * `queryFile` is the one traversal that never filtered its neighbours down to
 * vertices, so a file's `documented-by` edge to its skill doc shows up here —
 * with the vertex-shaped fields null, exactly as it did before. The Zed code
 * lens counts these, so dropping them would change what the editor reports.
 */
function oneHopAnyTable(
  store: DatabaseSync,
  dir: "in" | "out",
  startId: string
): Array<{ edge: Edge; neighbor: Record<string, unknown> }> {
  const h = HOP[dir];
  const rows = store
    .prepare(
      `SELECT e.doc AS edoc, coalesce(v.doc, d.doc, c.doc) AS ndoc
         FROM edges e
         LEFT JOIN vertices v ON v.key = e.${h.next} AND e.${h.nextId} LIKE 'vertices/%'
         LEFT JOIN docs     d ON d.key = e.${h.next} AND e.${h.nextId} LIKE 'docs/%'
         LEFT JOIN concepts c ON c.key = e.${h.next} AND e.${h.nextId} LIKE 'concepts/%'
        WHERE e.${h.match} = ? AND coalesce(v.doc, d.doc, c.doc) IS NOT NULL
        ORDER BY e.rowid ${EDGE_SCAN_ORDER}`
    )
    .all(startId) as Array<{ edoc: string; ndoc: string }>;
  return rows.map((r) => ({
    edge: JSON.parse(r.edoc) as Edge,
    neighbor: JSON.parse(r.ndoc) as Record<string, unknown>,
  }));
}

/** Neighbours in either direction, vertices only. */
function anyNeighbors(store: DatabaseSync, vertexKey: string): Array<{ neighbor: Vertex; edge: Edge }> {
  const id = vertexId(vertexKey);
  return [...oneHop(store, "in", id, null), ...oneHop(store, "out", id, null)].map((h) => ({
    neighbor: h.vertex,
    edge: h.edge,
  }));
}

/** Splits `name`, `concept::name` and `path/to/file.ts:name` into filters. */
function parseSymbol(symbol: string): {
  nameOnly: string;
  conceptFilter: string | null;
  filepathFilter: string | null;
} {
  if (symbol.includes("::")) {
    const [c, n] = symbol.split("::", 2);
    return { nameOnly: n, conceptFilter: c, filepathFilter: null };
  }
  if (symbol.includes(":") && !symbol.startsWith("/")) {
    const idx = symbol.lastIndexOf(":");
    return {
      nameOnly: symbol.slice(idx + 1),
      conceptFilter: null,
      filepathFilter: symbol.slice(0, idx),
    };
  }
  return { nameOnly: symbol, conceptFilter: null, filepathFilter: null };
}

function resolveByName(store: DatabaseSync, symbol: string): Vertex[] {
  const { nameOnly, conceptFilter, filepathFilter } = parseSymbol(symbol);
  return toDocs<Vertex>(
    store
      .prepare(
        // node:sqlite binds anonymous `?` only — numbered `?N` placeholders
        // raise "column index out of range" — so repeated values are re-bound.
        `SELECT doc FROM vertices
          WHERE name = ? AND status = 'live'
            AND (? IS NULL OR concept = ?)
            AND (? IS NULL OR filepath = ?)
          ORDER BY type, key`
      )
      .all(nameOnly, conceptFilter, conceptFilter, filepathFilter, filepathFilter) as Row[]
  );
}

export function skillDoc(store: DatabaseSync, concept: string): DocVertex | null {
  return toDoc<DocVertex>(store.prepare("SELECT doc FROM docs WHERE key = ?").get(docKey(concept)) as Row | undefined);
}

export type DocVertex = {
  _key: string;
  concept: string;
  kind: string;
  path: string;
  body_md: string;
  body_hash: string;
};

export type ConceptResult = {
  vertices: Vertex[];
  edges: Edge[];
  doc: DocVertex | null;
};

export type ImpactEntry = {
  vertex: Vertex;
  edge: Edge;
  depth: number;
};

export type ImpactResult =
  | { ambiguous: true; candidates: Vertex[] }
  | { ambiguous: false; notFound: true }
  | { ambiguous: false; notFound: false; startVertex: Vertex; results: ImpactEntry[] };

export type CrossEntry = {
  edge: Edge;
  from: Vertex;
  to: Vertex;
};

export type VertexResult = {
  vertex: Vertex;
  neighbors: Array<{ neighbor: Vertex; edge: Edge }>;
} | null;

export type VertexLookupResult =
  | { kind: "not-found" }
  | { kind: "ambiguous"; candidates: Vertex[] }
  | { kind: "found"; vertex: Vertex; neighbors: Array<{ neighbor: Vertex; edge: Edge }> };

export type EdgeNeighbor = {
  edge: Edge;
  vertex: Pick<Vertex, "_key" | "name" | "filepath" | "start_line" | "end_line" | "concept" | "type">;
};

export type FileVertexEntry = {
  vertex: Vertex;
  edges_in: EdgeNeighbor[];
  edges_out: EdgeNeighbor[];
};

export type FileResult = {
  filepath: string;
  entries: FileVertexEntry[];
  doc_by_concept: Record<string, DocVertex | null>;
};

export async function queryConcept(store: DatabaseSync, concept: string): Promise<ConceptResult> {
  const vertices = toDocs<Vertex>(
    store
      .prepare(
        `SELECT doc FROM vertices
          WHERE concept = ? AND status = 'live'
          ORDER BY type, key`
      )
      .all(concept) as Row[]
  );
  const edges = toDocs<Edge>(
    store.prepare("SELECT doc FROM edges WHERE concept = ? ORDER BY rowid").all(concept) as Row[]
  );
  return { vertices, edges, doc: skillDoc(store, concept) };
}

export async function queryImpact(
  store: DatabaseSync,
  symbol: string,
  direction: "in" | "out" | "both",
  max: number
): Promise<ImpactResult> {
  const matches = resolveByName(store, symbol);
  if (matches.length === 0) return { ambiguous: false, notFound: true };
  if (matches.length > 1) return { ambiguous: true, candidates: matches };

  const startVertex = matches[0];
  const startId = vertexId(startVertex._key);
  const results: ImpactEntry[] = [];

  if (direction === "in" || direction === "both") {
    results.push(...twoHops(store, "in", startId, IMPACT_EDGE_TYPES, max));
  }
  if (direction === "out" || direction === "both") {
    results.push(...twoHops(store, "out", startId, IMPACT_EDGE_TYPES, max));
  }

  // Deduplicate by vertex._key
  const seen = new Set<string>();
  const deduped = results.filter((r) => {
    if (seen.has(r.vertex._key)) return false;
    seen.add(r.vertex._key);
    return true;
  });

  return { ambiguous: false, notFound: false, startVertex, results: deduped.slice(0, max) };
}

export async function queryCross(store: DatabaseSync, a: string, b: string): Promise<{ entries: CrossEntry[] }> {
  // Joining `vertices` on both ends is equivalent to ArangoDB's DOCUMENT()
  // lookup here: crosses_concept is only ever set on vertex-to-vertex edges
  // (apply.ts writes false for the describes / documented-by edges that point
  // at docs and concepts).
  const rows = store
    .prepare(
      `SELECT e.doc AS edoc, f.doc AS fdoc, t.doc AS tdoc
         FROM edges e
         JOIN vertices f ON f.key = e.from_key
         JOIN vertices t ON t.key = e.to_key
        WHERE e.crosses_concept = 1
          AND ((f.concept = ? AND t.concept = ?) OR (f.concept = ? AND t.concept = ?))
        ORDER BY e.rowid`
    )
    .all(a, b, b, a) as Array<{ edoc: string; fdoc: string; tdoc: string }>;
  return {
    entries: rows.map((r) => ({
      edge: JSON.parse(r.edoc) as Edge,
      from: JSON.parse(r.fdoc) as Vertex,
      to: JSON.parse(r.tdoc) as Vertex,
    })),
  };
}

export async function queryFile(store: DatabaseSync, filepath: string): Promise<FileResult> {
  const vertices = toDocs<Vertex>(
    store
      .prepare(
        `SELECT doc FROM vertices
          WHERE filepath = ? AND status = 'live'
          ORDER BY start_line ASC`
      )
      .all(filepath) as Row[]
  );

  // Nulls rather than omitted keys: a doc or concept endpoint has none of these
  // fields, and the previous projection emitted them as null.
  const summarize = (n: Record<string, unknown>): EdgeNeighbor["vertex"] =>
    ({
      _key: n._key ?? null,
      name: n.name ?? null,
      filepath: n.filepath ?? null,
      start_line: n.start_line ?? null,
      end_line: n.end_line ?? null,
      concept: n.concept ?? null,
      type: n.type ?? null,
    }) as unknown as EdgeNeighbor["vertex"];

  const entries: FileVertexEntry[] = vertices.map((v) => {
    const id = vertexId(v._key);
    return {
      vertex: v,
      edges_in: oneHopAnyTable(store, "in", id).map((h) => ({ edge: h.edge, vertex: summarize(h.neighbor) })),
      edges_out: oneHopAnyTable(store, "out", id).map((h) => ({ edge: h.edge, vertex: summarize(h.neighbor) })),
    };
  });

  const doc_by_concept: Record<string, DocVertex | null> = {};
  for (const c of Array.from(new Set(entries.map((e) => e.vertex.concept)))) {
    doc_by_concept[c] = skillDoc(store, c);
  }

  return { filepath, entries, doc_by_concept };
}

export async function queryVertexByName(store: DatabaseSync, symbol: string): Promise<VertexLookupResult> {
  const matches = resolveByName(store, symbol);
  if (matches.length === 0) return { kind: "not-found" };
  if (matches.length > 1) return { kind: "ambiguous", candidates: matches };

  const vertex = matches[0];
  return { kind: "found", vertex, neighbors: anyNeighbors(store, vertex._key) };
}

export async function queryVertex(store: DatabaseSync, filepath: string, line: number): Promise<VertexResult> {
  // The innermost enclosing span wins, so a callsite inside a function resolves
  // to the callsite rather than the function.
  const vertex = toDoc<Vertex>(
    store
      .prepare(
        `SELECT doc FROM vertices
          WHERE filepath = ? AND start_line <= ? AND end_line >= ? AND status = 'live'
          ORDER BY start_line DESC
          LIMIT 1`
      )
      .get(filepath, line, line) as Row | undefined
  );
  if (!vertex) return null;
  return { vertex, neighbors: anyNeighbors(store, vertex._key) };
}
