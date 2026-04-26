export interface Vertex {
  _key: string;
  displayKey: string;
  concept: string;
  type:
    | "store"
    | "store-state"
    | "store-action"
    | "function"
    | "hook"
    | "component"
    | "type-def"
    | "callsite"
    | "effect";
  name: string;
  filepath: string;
  start_line: number;
  end_line: number;
  signature: string;
  contentHash: string;
  purpose?: string;
  inputs?: string[];
  outputs?: string[];
  cross_concept_refs?: string[];
  document_ref?: string | null;
  tags?: string[];
  status: "live" | "archived";
  archivedAt?: string;
  ast: { extracted_at: string; extractor_version: string };
  agent: {
    authored_by: "claude" | null;
    authored_at?: string;
    stale: boolean;
    sig_seen?: string;
  };
}

export interface Edge {
  _key: string;
  _from: string;
  _to: string;
  type:
    | "calls"
    | "reads"
    | "writes"
    | "mounts"
    | "subscribes"
    | "uses-hook"
    | "delegates-to"
    | "has-type"
    | "triggers"
    | "describes"
    | "documented-by";
  concept: string;
  crosses_concept: boolean;
  reason?: string;
  lifecycle?: "useEffect" | "handler" | "mount" | "callback" | null;
  line?: number;
  ast: { extracted_at: string };
  agent: { authored_by: "claude" | null };
}

export interface AstDoc {
  vertices: Vertex[];
  edges: Edge[];
  skill: { path: string; body: string; contentHash: string };
  meta: { extractor_version: string; extracted_at: string };
}

export interface EnrichedVertex {
  _key: string;
  purpose?: string;
  inputs?: string[];
  outputs?: string[];
  cross_concept_refs?: string[];
  document_ref?: string | null;
  tags?: string[];
  sig_seen?: string;
}

export interface EnrichedEdge {
  _key: string;
  reason?: string;
}

export interface EnrichedDoc {
  vertices: EnrichedVertex[];
  edges: EnrichedEdge[];
}
