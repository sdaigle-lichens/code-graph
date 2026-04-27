# Phase 4.5 — Plan-alignment fixes (post phases 1-4)

## Goal

Catch three small drifts between phases 1-4 implementation and the plan before phase 5 starts depending on them:

1. `AstDoc` TS interface lies to consumers — missing `concept` field that `extract.ts` actually writes.
2. `plugin/commands/graph.md` exit-code table missing row for code `4` (ambiguous symbol). Plan + phase 6 specify it.
3. No zod schema for `AstDoc` / `EnrichedDoc`. Phase 5 needs runtime validation of `enriched.json` (LLM-authored, untrusted boundary).

This is a tiny corrective phase — no new features. Lock the contract before phase 5 reads it.

## Context

### Why validate `enriched.json` at apply time

The enriched file is written by a Claude Code subagent. Even with strict skill prompting + `Write`-only-to-`outPath` constraint, the file is structurally untrusted:

- Subagent could emit malformed JSON or missing required keys.
- Subagent could invent vertex `_key`s that don't exist in `ast.json`.
- Schema drift between skill prompt and `apply` consumer is a silent footgun.

Validating at the apply boundary catches all three classes early with a useful error rather than leaving partial state in the DB.

### Why `AstDoc.concept` matters

`extract.ts` writes `{ concept, vertices, edges, skill, meta }` at the top of `ast.json`. The TS `AstDoc` interface in `src/schema.ts` only declares `{ vertices, edges, skill, meta }`. Phase 5 (`apply.ts`) will load this file and want to assert `astDoc.concept === argConcept` before any DB write — without the field on the type, that check needs a cast.

### Why exit code 4 in `graph.md`

Plan §"Failure modes" lists exits `2/3/4/5/6`. `graph.md` lists `2/3/5/6` only. When `code-graph query impact <ambiguous>` exits 4 with candidate list on stderr, `/graph` should surface that to the user with a suggestion to disambiguate (concept name or filepath qualifier) rather than printing the raw stderr.

## Tasks

1. **Fix `src/schema.ts` `AstDoc`**:

   Add `concept: string` field. Add `AstDocSchema` and `EnrichedDocSchema` zod schemas alongside the existing TS interfaces. Re-derive the TS types from the zod schemas using `z.infer<>` so the two cannot drift again.

   ```ts
   import { z } from "zod";

   const VertexTypeEnum = z.enum([
     "store", "store-state", "store-action", "function", "hook",
     "component", "type-def", "callsite", "effect",
   ]);

   const EdgeTypeEnum = z.enum([
     "calls", "reads", "writes", "mounts", "subscribes", "uses-hook",
     "delegates-to", "has-type", "triggers", "describes", "documented-by",
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
     concept: z.string(),                       // ← was missing
     vertices: z.array(VertexSchema),
     edges: z.array(EdgeSchema),
     skill: z.object({
       path: z.string(),
       body: z.string(),
       contentHash: z.string(),
     }).optional(),
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

   export const EnrichedEdgeSchema = z.union([
     EnrichedAstEdgeSchema,
     EnrichedAgentEdgeSchema,
   ]);

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
   ```

   Delete the old hand-written interfaces (replaced by `z.infer`).

2. **Verify `src/scribe/extract.ts` still compiles** against the new types. The `concept` field is already written, so no behavior change — only the type now matches the runtime shape. Run `pnpm build` and confirm zero errors.

3. **Patch `plugin/commands/graph.md`** — add exit code 4 row to the table:

   | Code | Meaning           | Suggestion                                                                           |
   | ---- | ----------------- | ------------------------------------------------------------------------------------ |
   | `2`  | Server offline    | Run `code-graph up` to start the ArangoDB server                                     |
   | `3`  | Database missing  | Run `code-graph bootstrap` to initialize the database                                |
   | `4`  | Ambiguous symbol  | Disambiguate by concept (`/graph impact <concept>::<name>`) or filepath qualifier   |
   | `5`  | No config found   | Create a `scribe.config.json` in your project root                                   |
   | `6`  | Zero results      | Try rephrasing your query, or use the Explore agent for a broader search             |

4. **Sanity check**: from `code-graph/`, run `pnpm build`. Then from `~/Documents/gits/lichens-ordonnancement-ui` (after `scribe.config.json` exists), run `code-graph extract workorder-store`. Open the resulting `scribe-output/workorder-store.ast.json` and confirm `concept` field is present at the top level (already was — just verifying nothing broke).

## Done when

- `pnpm build` clean.
- `src/schema.ts` exports `AstDocSchema`, `EnrichedDocSchema` (and the underlying piece schemas) as zod schemas; TS types are `z.infer<>` derived.
- `plugin/commands/graph.md` exit-code table lists row 4.
- Existing `extract.ts` output unchanged on round-trip.

## Out of scope

- Wiring `EnrichedDocSchema.parse(...)` into `apply.ts` — that's phase 5 task. Phase 4.5 only ships the schema; phase 5 consumes it.
- Changing edge `_from` / `_to` validation to enforce collection prefix (`vertices/...` etc.) — defer; current `z.string()` is sufficient until apply needs to discriminate.
