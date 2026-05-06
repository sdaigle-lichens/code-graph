import type { Database } from "arangojs";
import { aql } from "arangojs/aql";
import type { Vertex, Edge } from "../schema.js";

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
  vertex: Pick<
    Vertex,
    "_key" | "name" | "filepath" | "start_line" | "end_line" | "concept" | "type"
  >;
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

export async function queryConcept(
  db: Database,
  concept: string
): Promise<ConceptResult> {
  const cursor = await db.query<ConceptResult>(aql`
    LET verts = (
      FOR v IN vertices
        FILTER v.concept == ${concept} AND v.status == "live"
        RETURN v
    )
    LET edgs = (
      FOR e IN edges
        FILTER e.concept == ${concept}
        RETURN e
    )
    LET doc = DOCUMENT("docs", CONCAT(${concept}, "::skill"))
    RETURN { vertices: verts, edges: edgs, doc: doc }
  `);
  const rows = await cursor.all();
  return rows[0] ?? { vertices: [], edges: [], doc: null };
}

export async function queryImpact(
  db: Database,
  symbol: string,
  direction: "in" | "out" | "both",
  max: number
): Promise<ImpactResult> {
  // Resolve symbol — supports "concept::name" or "filepath:name" qualifiers
  let conceptFilter: string | null = null;
  let filepathFilter: string | null = null;
  let nameOnly = symbol;
  if (symbol.includes("::")) {
    const [c, n] = symbol.split("::", 2);
    conceptFilter = c;
    nameOnly = n;
  } else if (symbol.includes(":") && !symbol.startsWith("/")) {
    const idx = symbol.lastIndexOf(":");
    filepathFilter = symbol.slice(0, idx);
    nameOnly = symbol.slice(idx + 1);
  }
  const matchCursor = await db.query<Vertex>(aql`
    FOR v IN vertices
      FILTER v.name == ${nameOnly} AND v.status == "live"
        AND (${conceptFilter} == null OR v.concept == ${conceptFilter})
        AND (${filepathFilter} == null OR v.filepath == ${filepathFilter})
      RETURN v
  `);
  const matches = await matchCursor.all();

  if (matches.length === 0) {
    return { ambiguous: false, notFound: true };
  }
  if (matches.length > 1) {
    return { ambiguous: true, candidates: matches };
  }

  const startVertex = matches[0];
  const impactEdgeTypes = ["calls", "triggers", "delegates-to"];
  const results: ImpactEntry[] = [];

  if (direction === "in" || direction === "both") {
    const cur = await db.query<ImpactEntry>(aql`
      FOR v, e, p IN 1..2 INBOUND ${startVertex} edges
        FILTER e.type IN ${impactEdgeTypes}
        LIMIT ${max}
        RETURN DISTINCT { vertex: v, edge: e, depth: LENGTH(p.edges) }
    `);
    results.push(...(await cur.all()));
  }

  if (direction === "out" || direction === "both") {
    const cur = await db.query<ImpactEntry>(aql`
      FOR v, e, p IN 1..2 OUTBOUND ${startVertex} edges
        FILTER e.type IN ${impactEdgeTypes}
        LIMIT ${max}
        RETURN DISTINCT { vertex: v, edge: e, depth: LENGTH(p.edges) }
    `);
    results.push(...(await cur.all()));
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

export async function queryCross(
  db: Database,
  a: string,
  b: string
): Promise<{ entries: CrossEntry[] }> {
  const cursor = await db.query<CrossEntry>(aql`
    FOR e IN edges
      FILTER e.crosses_concept == true
      LET fromV = DOCUMENT(e._from)
      LET toV = DOCUMENT(e._to)
      FILTER fromV != null AND toV != null
      FILTER (fromV.concept == ${a} AND toV.concept == ${b})
          OR (fromV.concept == ${b} AND toV.concept == ${a})
      RETURN { edge: e, from: fromV, to: toV }
  `);
  const entries = await cursor.all();
  return { entries };
}

export async function queryFile(
  db: Database,
  filepath: string
): Promise<FileResult> {
  const cursor = await db.query<{
    vertex: Vertex;
    edges_in: EdgeNeighbor[];
    edges_out: EdgeNeighbor[];
  }>(aql`
    FOR v IN vertices
      FILTER v.filepath == ${filepath} AND v.status == "live"
      SORT v.start_line ASC
      LET ein = (
        FOR n, e IN 1..1 INBOUND v edges
          RETURN {
            edge: e,
            vertex: {
              _key: n._key, name: n.name, filepath: n.filepath,
              start_line: n.start_line, end_line: n.end_line,
              concept: n.concept, type: n.type
            }
          }
      )
      LET eout = (
        FOR n, e IN 1..1 OUTBOUND v edges
          RETURN {
            edge: e,
            vertex: {
              _key: n._key, name: n.name, filepath: n.filepath,
              start_line: n.start_line, end_line: n.end_line,
              concept: n.concept, type: n.type
            }
          }
      )
      RETURN { vertex: v, edges_in: ein, edges_out: eout }
  `);
  const entries = await cursor.all();

  const concepts = Array.from(new Set(entries.map((e) => e.vertex.concept)));
  const doc_by_concept: Record<string, DocVertex | null> = {};
  for (const c of concepts) {
    const docCursor = await db.query<DocVertex>(aql`
      RETURN DOCUMENT("docs", CONCAT(${c}, "::skill"))
    `);
    const rows = await docCursor.all();
    doc_by_concept[c] = rows[0] ?? null;
  }

  return { filepath, entries, doc_by_concept };
}

export async function queryVertexByName(
  db: Database,
  symbol: string
): Promise<VertexLookupResult> {
  let conceptFilter: string | null = null;
  let filepathFilter: string | null = null;
  let nameOnly = symbol;
  if (symbol.includes("::")) {
    const [c, n] = symbol.split("::", 2);
    conceptFilter = c;
    nameOnly = n;
  } else if (symbol.includes(":") && !symbol.startsWith("/")) {
    const idx = symbol.lastIndexOf(":");
    filepathFilter = symbol.slice(0, idx);
    nameOnly = symbol.slice(idx + 1);
  }

  const matchCursor = await db.query<Vertex>(aql`
    FOR v IN vertices
      FILTER v.name == ${nameOnly} AND v.status == "live"
        AND (${conceptFilter} == null OR v.concept == ${conceptFilter})
        AND (${filepathFilter} == null OR v.filepath == ${filepathFilter})
      RETURN v
  `);
  const matches = await matchCursor.all();

  if (matches.length === 0) return { kind: "not-found" };
  if (matches.length > 1) return { kind: "ambiguous", candidates: matches };

  const vertex = matches[0];
  const cursor = await db.query<{ neighbor: Vertex; edge: Edge }>(aql`
    FOR n, e IN 1..1 ANY ${vertex} edges
      FILTER IS_SAME_COLLECTION('vertices', n)
      RETURN { neighbor: n, edge: e }
  `);
  const neighbors = await cursor.all();
  return { kind: "found", vertex, neighbors };
}

export async function queryVertex(
  db: Database,
  filepath: string,
  line: number
): Promise<VertexResult> {
  const cursor = await db.query<{ vertex: Vertex; neighbors: Array<{ neighbor: Vertex; edge: Edge }> }>(aql`
    LET v = FIRST(
      FOR x IN vertices
        FILTER x.filepath == ${filepath}
           AND x.start_line <= ${line}
           AND x.end_line >= ${line}
           AND x.status == "live"
        SORT x.start_line DESC
        LIMIT 1
        RETURN x
    )
    LET neighbors = v != null ? (
      FOR n, e IN 1..1 ANY v edges
        FILTER IS_SAME_COLLECTION('vertices', n)
        RETURN { neighbor: n, edge: e }
    ) : []
    RETURN { vertex: v, neighbors: neighbors }
  `);
  const rows = await cursor.all();
  const row = rows[0];
  if (!row?.vertex) return null;
  return { vertex: row.vertex, neighbors: row.neighbors };
}
