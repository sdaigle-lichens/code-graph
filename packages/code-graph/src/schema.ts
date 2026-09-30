import { z } from "zod";

const VertexTypeEnum = z.enum([
  "store",
  "store-state",
  "store-action",
  "function",
  "hook",
  "component",
  "type-def",
  "callsite",
  "effect",
]);

const EdgeTypeEnum = z.enum([
  "calls",
  "reads",
  "writes",
  "mounts",
  "subscribes",
  "uses-hook",
  "delegates-to",
  "has-type",
  "triggers",
  "describes",
  "documented-by",
]);

export const VertexSchema = z.object({
  _key: z.string(),
  displayKey: z.string(),
  concept: z.string(),
  type: VertexTypeEnum,
  name: z.string(),
  filepath: z.string(),
  start_line: z.number(),
  end_line: z.number(),
  signature: z.string(),
  contentHash: z.string(),
  purpose: z.string().optional(),
  inputs: z.array(z.string()).optional(),
  outputs: z.array(z.string()).optional(),
  cross_concept_refs: z.array(z.string()).optional(),
  document_ref: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(["live", "archived"]),
  archivedAt: z.string().optional(),
  ast: z.object({ extracted_at: z.string(), extractor_version: z.string() }),
  agent: z.object({
    authored_by: z.enum(["claude"]).nullable(),
    authored_at: z.string().optional(),
    stale: z.boolean(),
    sig_seen: z.string().optional(),
  }),
});

export const EdgeSchema = z.object({
  _key: z.string(),
  _from: z.string(),
  _to: z.string(),
  type: EdgeTypeEnum,
  concept: z.string(),
  crosses_concept: z.boolean(),
  reason: z.string().optional(),
  lifecycle: z.enum(["useEffect", "handler", "mount", "callback"]).nullable().optional(),
  line: z.number().optional(),
  ast: z.object({ extracted_at: z.string() }),
  agent: z.object({ authored_by: z.enum(["claude"]).nullable() }),
});

export const AstDocSchema = z.object({
  concept: z.string(),
  vertices: z.array(VertexSchema),
  edges: z.array(EdgeSchema),
  skill: z
    .object({
      path: z.string(),
      body: z.string(),
      contentHash: z.string(),
    })
    .optional(),
  meta: z.object({
    extractor_version: z.string(),
    extracted_at: z.string(),
  }),
});

export const EnrichedVertexSchema = z.object({
  _key: z.string(),
  purpose: z.string().optional(),
  inputs: z.array(z.string()).optional(),
  outputs: z.array(z.string()).optional(),
  cross_concept_refs: z.array(z.string()).optional(),
  document_ref: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  sig_seen: z.string().optional(),
});

// Two flavors: AST-edge enrichment (just _key + reason) vs agent-authored
// semantic edges (full edge record).
export const EnrichedAstEdgeSchema = z.object({
  _key: z.string(),
  reason: z.string().optional(),
});

export const EnrichedAgentEdgeSchema = z.object({
  _from: z.string(),
  _to: z.string(),
  type: z.enum(["delegates-to", "triggers"]),
  concept: z.string(),
  reason: z.string().optional(),
  line: z.number().nullable().optional(),
  agent: z.object({ authored_by: z.literal("claude") }),
});

export const EnrichedEdgeSchema = z.union([EnrichedAstEdgeSchema, EnrichedAgentEdgeSchema]);

export const EnrichedDocSchema = z.object({
  concept: z.string(),
  vertices: z.array(EnrichedVertexSchema),
  edges: z.array(EnrichedEdgeSchema),
});

export type Vertex = z.infer<typeof VertexSchema>;
export type Edge = z.infer<typeof EdgeSchema>;
export type AstDoc = z.infer<typeof AstDocSchema>;
export type EnrichedVertex = z.infer<typeof EnrichedVertexSchema>;
export type EnrichedEdge = z.infer<typeof EnrichedEdgeSchema>;
export type EnrichedDoc = z.infer<typeof EnrichedDocSchema>;

// Shapes previously declared inline in scribe/apply.ts. The `docs` and
// `concepts` collections carry `status`/`archivedAt` only after
// delete-concept archives them, so both are optional here.
export const DocRecordSchema = z.object({
  _key: z.string(),
  concept: z.string(),
  kind: z.literal("skill"),
  path: z.string(),
  body_md: z.string(),
  body_hash: z.string(),
  status: z.enum(["live", "archived"]).optional(),
  archivedAt: z.string().optional(),
});

export const ConceptRecordSchema = z.object({
  _key: z.string(),
  owner_skill_path: z.string().optional(),
  last_scribed_at: z.string(),
});

export type DocRecord = z.infer<typeof DocRecordSchema>;
export type ConceptRecord = z.infer<typeof ConceptRecordSchema>;
