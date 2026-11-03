# Enrichment procedure

Read on demand by the `scribe` skill, only when a run enriches a concept. Enrichment adds semantic
fields to a concept's AST JSON. It is invoked by the update flows and the retrieval skill's "yes, build
it" path; never run it unprompted. Two paths, incremental first.

### Incremental path (default)

Enrich only what needs it (`cg` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs"`). The caller
drives it. Which step 2 applies depends on whether you have the Agent tool: the main session fans out
to Haiku; a subagent (no Agent tool, no `AskUserQuestion`) enriches inline or defers, see step 2.

1. Decide with `cg enrich targets <concept> --summary --json`, the small, inline-readable listing:
   counts per reason, the `core` block (`size`, `leftOut`, `thin`, `message`), the total of edges
   without a reason, and one short line per target (`key`, `name`, `type`, `loc`, `reasons`,
   `core`). It is lazy by default: changed and stale vertices, plus never-enriched vertices that are
   core (the SKILL.md names them, or hubs) or that an `extract` → `apply` saw as new, changed or
   renamed since the previous apply. Every other never-enriched vertex is counted in
   `core.leftOut`: report it as not enriched yet. An empty list means nothing to do. Do not read
   the full listing: each batch reads full details (signature, purpose, `edgesWithoutReason`) for
   **its own targets only** with `cg enrich targets <concept> --json --vertex <_key>...` (it
   narrows the output to those vertices). When `core.thin` is true the skill names too little to
   enrich well: route to `update-single-concept-skill` to deepen it (from a subagent, report it
   with `core.message`, do not run it).
2. **With the Agent tool (main session):** fan the targets out in small batches (about 10 vertices)
   to Haiku subagents, in parallel. Each gets its batch's keys, the concept's SKILL.md path and the
   output schema below, reads its own targets' details with `--json --vertex`, reads each vertex's
   slice, and writes a **partial** enrichment to `$TMPDIR/<concept>.partial.<n>.json`.
   **Without it (a subagent):** subagents cannot spawn subagents, so enrich **up to 20** targets
   yourself, never all-or-nothing. Pick them in this order: `changed` and `stale` first, then
   vertices the SKILL.md names, then hubs (the other `core: true` lines), then the rest. Read
   their details with one `--json --vertex` call, enrich them (`purpose`, `tags`, edge `reason`,
   same partial format, written to `$TMPDIR/<concept>.partial.1.json`), then continue with steps 3
   to 5. Put every target past the 20 under **"left to enrich"** in your final report (each one's
   name, filepath and reasons) so a main session can fan it out; each keeps its `agent.touched_at`
   until it is enriched, so it stays a target on the next run. When this run's own SKILL.md edit
   grew the core (compare `core.size` before and after the edit), say so in the report: "core grew
   from N to M with this run's skill edit".
3. For each partial: `cg enrich merge <concept> <partial>` (upserts by `_key` into
   `scribe-output/<concept>.enriched.json` and stamps `sig_seen` and `hash_seen` from ast.json; it
   does not run `apply`).
4. Spot-check a few merged descriptions against the code; re-ask the batch or drop the entries that
   are wrong.
5. `cg apply <concept>`.

Enrichers return `purpose`, `inputs`, `outputs`, `tags`, `cross_concept_refs`, `document_ref` and
edge `reason` only. They never write `sig_seen` or `hash_seen`. Each alone in its own Bash call.

### Whole-concept path

Use it when the concept's SKILL.md was revised (descriptions read the skill's tags and invariants).
A revised SKILL.md does not mean every vertex: re-enrich the vertices **already enriched** (the
`_key`s with a `purpose` in `scribe-output/<concept>.enriched.json`; their descriptions read the
old skill) **plus the core** (the `core: true` lines of `cg enrich targets <concept> --summary
--json`). Never-enriched non-core vertices stay lazy: they are enriched when a task touches them.
Give each batch its own keys and let it read their details with `cg enrich targets <concept> --json
--vertex <_key>...`; fan-out and the subagent's up-to-20 rule are the same as in step 2 above. Only
when the user explicitly asks for a full pass, `cg enrich targets <concept> --all --summary --json`
lists every vertex not enriched yet. Each enricher writes its result to a partial file (`outPath`);
the caller then runs `enrich merge` and `apply` exactly as in steps 3 to 5 above, so `sig_seen` and
`hash_seen` are stamped the same way.

### Inputs

| Name | Description |
|------|-------------|
| `concept` | Concept name (e.g. `workorder-store`) |
| `astPath` | CWD-relative path to `scribe-output/<concept>.ast.json` |
| `skillPath` | CWD-relative path to `<skillsDir>/<concept>/SKILL.md` |
| `outPath` | The partial enrichment file (`$TMPDIR/<concept>.partial.<n>.json`); the caller merges it into `scribe-output/<concept>.enriched.json` |

### Procedure

1. **Read** `astPath` — load all vertices and edges from `ast.json`.
2. **Read** `skillPath` — load the concept's SKILL.md to extract invariants, tags vocabulary, and domain constraints.
3. **For each vertex** in `ast.json`:
   - Read the source file slice identified by `filepath` + `start_line`–`end_line` using Read with `offset`/`limit`.
   - Analyze the slice to determine:
     - `purpose` — one sentence describing what the vertex does.
     - `inputs` — list of meaningful parameter/prop names with brief notes; empty array if none.
     - `outputs` — what the vertex returns or produces; empty array if none.
     - `tags` — labels matching invariants or patterns found in SKILL.md (e.g. `dnd-target`, `reorder`); empty array if none apply.
     - `cross_concept_refs` — other concept names referenced via imports or calls into other concept directories; identify by scanning import paths and call targets. Empty array if none.
     - `document_ref` — link to external documentation if clearly referenced in a comment or jsdoc; `null` otherwise.
4. **For each existing AST edge** in `ast.json`, output an edge record with only `_key` and `reason` (one sentence explaining why the edge exists).
5. **Identify agent-authored semantic edges** — scan vertex slices for delegation patterns (`delegates-to`) and event-trigger patterns (`triggers`). Emit edges with `_from`, `_to`, `type`, `concept`, `reason`, `line` (or `null`), and `agent.authored_by: "claude"`. Only emit these when observed directly — do not infer.
6. **Write** the enriched output to `outPath` using the exact JSON schema below.

When context is ambiguous, set the field to `null` or `[]` rather than guessing.

### Output schema

```json
{
  "concept": "<concept name>",
  "vertices": [
    {
      "_key": "<vertex key from ast.json>",
      "purpose": "...",
      "inputs": ["..."],
      "outputs": ["..."],
      "cross_concept_refs": ["other-concept-name"],
      "document_ref": null,
      "tags": ["tag-name"]
    }
  ],
  "edges": [
    {
      "_key": "<edge key from ast.json — for AST edges>",
      "reason": "One sentence explaining why this edge exists."
    },
    {
      "_from": "vertices/<src key>",
      "_to": "vertices/<dst key>",
      "type": "delegates-to|triggers",
      "concept": "<concept>",
      "reason": "...",
      "line": null,
      "agent": { "authored_by": "claude" }
    }
  ]
}
```

### Enrichment hard rules

- **Never modify AST-authoritative fields**: `filepath`, `start_line`, `end_line`, `signature`, `contentHash`, `type`, `name`, `displayKey`, `ast.*`.
- **Only write to `outPath`** during enrichment — no other files; a single `Write`, no `Edit`.
- If context is unclear, leave field `null` or `[]`. Do not fabricate.
- Do not invoke other skills or agents from inside the enrichment.
- Do not write `sig_seen` or `hash_seen`: `enrich merge` stamps them from `ast.json`, and `apply`
  compares them with the next extract to flag stale prose.
- After writing `outPath`, the caller runs `enrich merge` (incremental) and then `code-graph apply
  <concept>`; enrichment itself does not.
