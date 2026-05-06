// Subset of the JSON shape produced by `code-graph query file --json`.
// We don't depend on the parent project's types to keep this server portable.

export type Vertex = {
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
  document_ref?: string | null;
  tags?: string[];
  status: "live" | "archived";
  agent: { authored_by: "claude" | null; stale: boolean };
};

export type Edge = {
  _key: string;
  _from: string;
  _to: string;
  type: string;
  concept: string;
  crosses_concept: boolean;
  reason?: string;
  line?: number;
};

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

export type DocVertex = {
  _key: string;
  concept: string;
  kind: string;
  path: string;
  body_md: string;
};

export type FileResult = {
  filepath: string;
  entries: FileVertexEntry[];
  doc_by_concept: Record<string, DocVertex | null>;
};
