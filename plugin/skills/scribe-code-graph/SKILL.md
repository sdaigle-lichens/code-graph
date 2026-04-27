---
name: scribe-code-graph
description: Enriches a code-graph AST JSON with semantic fields (purpose, inputs, outputs, tags, cross_concept_refs, agent-authored edges). Invoked by /scribe-enrich — never invoke directly.
allowed-tools: Read, Glob, Grep, Write
---

## When to use

Invoked exclusively by `/scribe-enrich <concept>`. Never invoke directly.

## Inputs

Four values passed by `/scribe-enrich`:

| Name | Description |
|------|-------------|
| `concept` | Concept name (e.g. `workorder-store`) |
| `astPath` | CWD-relative path to `scribe-output/<concept>.ast.json` |
| `skillPath` | CWD-relative path to `<skillsDir>/<concept>/SKILL.md` |
| `outPath` | CWD-relative path to `scribe-output/<concept>.enriched.json` |

## Procedure

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
     - `sig_seen` — copy the vertex's `signature` field verbatim from `ast.json`.
4. **For each existing AST edge** in `ast.json`, output an edge record with only `_key` and `reason` (one sentence explaining why the edge exists).
5. **Identify agent-authored semantic edges** — scan vertex slices for delegation patterns (`delegates-to`) and event-trigger patterns (`triggers`). Emit edges with `_from`, `_to`, `type`, `concept`, `reason`, `line` (or `null`), and `agent.authored_by: "claude"`. Only emit these when observed directly — do not infer.
6. **Write** the enriched output to `outPath` using the exact JSON schema below.

When context is ambiguous, set the field to `null` or `[]` rather than guessing.

## Output schema

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
      "tags": ["tag-name"],
      "sig_seen": "<copy of the vertex's signature at enrichment time>"
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

## Hard rules

- **Never modify AST-authoritative fields**: `filepath`, `start_line`, `end_line`, `signature`, `contentHash`, `type`, `name`, `displayKey`, `ast.*`.
- **Only write to `outPath`** — no other files.
- **No Bash, no Edit** — only `Read`, `Glob`, `Grep`, and a single `Write` to `outPath` (no other files).
- If context is unclear, leave field `null` or `[]`. Do not fabricate.
- Do not invoke other skills or agents.

## Signature stability

Record `sig_seen` as the verbatim `signature` from `ast.json` at enrichment time. Downstream apply logic compares this against the signature on the next extract to flag stale prose: if they differ, the enrichment may no longer describe the current implementation.
