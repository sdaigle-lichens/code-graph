# Phase 4 — Plugin packaging + enrich subagent

## Goal

Ship a Claude Code plugin from `code-graph/plugin/` that registers via `/plugin install code-graph`. Plugin contains the `scribe-code-graph` enrichment skill and the `/graph` and `/scribe-enrich` slash commands. After this phase, a user can `pnpm link --global` the package, run `/plugin install code-graph` once, and have the skill + commands wired into their Claude Code session.

## Context

### Plugin layout

```
code-graph/plugin/
├── plugin.json
├── skills/
│   └── scribe-code-graph/SKILL.md
└── commands/
    ├── graph.md            # /graph
    └── scribe-enrich.md    # /scribe-enrich <concept>
```

### `plugin.json` shape

```json
{
  "name": "code-graph",
  "version": "0.1.0",
  "description": "Code-concept graph — scribe + query for Claude Code",
  "skills": [{ "path": "skills/scribe-code-graph" }],
  "commands": [
    { "path": "commands/graph.md" },
    { "path": "commands/scribe-enrich.md" }
  ]
}
```

### Subagent (`scribe-code-graph` skill) — strict boundaries

- **Tools allowed:** `Read`, `Glob`, `Grep` only. No Bash, no Write to anything except its single output file, no Edit.
- **Writes:** only `<cwd>/scribe-output/<concept>.enriched.json`.
- **Must NOT touch AST-authoritative fields** (`filepath`, `start_line`, `end_line`, `signature`, `contentHash`, `type`, `name`, `displayKey`, `ast.*`).
- **Inputs (passed by `/scribe-enrich`):** concept name, astPath (CWD-relative), skillPath, outPath.
- **Output schema (`<concept>.enriched.json`):**
  ```json
  {
    "concept": "workorder-store",
    "vertices": [
      {
        "_key": "<vertex key from ast.json>",
        "purpose": "...",
        "inputs": ["..."],
        "outputs": ["..."],
        "cross_concept_refs": ["scheduler-store", "shift-logic"],
        "document_ref": null,
        "tags": ["dnd-target", "reorder"],
        "sig_seen": "<copy of the vertex's signature at enrichment time>"
      }
    ],
    "edges": [
      {
        "_key": "<edge key from ast.json — for AST edges>",
        "reason": "Action wraps util that returns new maps atomically."
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
- **Signature stability:** the agent records the signature it analyzed in `sig_seen`. Apply uses this to flag whether agent-authored prose still applies after re-extracts.
- **Agent-only edges (semantic):** `delegates-to`, `triggers`. AST never emits these — agent emits them when it observes a "this fn really exists to call that other fn" or "this UI event triggers this side effect" relationship.

### `/scribe-enrich <concept>` flow

1. Slash command resolves `scribe.config.json` from CWD ancestry.
2. Resolves `astPath = scribe-output/<concept>.ast.json`, `skillPath = <skillsDir>/<concept>/SKILL.md` (or `config.concepts[concept].skill`), `outPath = scribe-output/<concept>.enriched.json`.
3. Invokes the `scribe-code-graph` skill with these args.
4. Skill reads ast.json + skill.md, populates each vertex with semantic fields, writes enriched.json.

### `/graph` command routing

```
/graph <args>...
```

- If `args[0] ∈ {concept, impact, cross, vertex}` → run `code-graph query <args>...`
- Else → run `code-graph search "<args joined>"`

On exit codes:
- `2` (server offline) → suggest `code-graph up`
- `3` (DB missing) → suggest `code-graph bootstrap`
- `5` (no config) → suggest creating `scribe.config.json`
- `6` (zero hits) → suggest rephrasing or fall back to Explore agent

Skill prose arrives inline in search output already (no separate skill Read needed).

## Tasks

1. Create `code-graph/plugin/plugin.json` per shape above.
2. Create `code-graph/plugin/skills/scribe-code-graph/SKILL.md`. Sections:
   - **Frontmatter** — `name`, `description`, `allowed-tools: Read, Glob, Grep`.
   - **When to use** — invoked by `/scribe-enrich <concept>`. Never invoke directly.
   - **Inputs** — concept name, astPath, skillPath, outPath.
   - **Procedure** — read astPath, read skillPath, for each vertex in ast.json read the source file slice (`filepath` + `start_line`–`end_line`) for context, write enrichment fields. Cross-reference SKILL.md for invariants → tags. Identify cross-concept refs by looking at imports/calls into other concept directories.
   - **Output schema** — exactly the JSON shape above.
   - **Hard rules** — never touch AST fields; only write to outPath; do not invoke other tools; if context is unclear leave a field null rather than guessing.
   - **Signature stability** — set `sig_seen` to current vertex signature.
3. Create `code-graph/plugin/commands/scribe-enrich.md` — slash command body. Argument: `<concept>`. Body: resolves config from CWD, computes paths, then invokes the `scribe-code-graph` skill via the standard skill-invocation pattern with the four inputs.
4. Create `code-graph/plugin/commands/graph.md` — slash command body. Body: parses `$ARGUMENTS`. If first token is `concept|impact|cross|vertex`, runs `code-graph query $ARGUMENTS`; else runs `code-graph search "$ARGUMENTS"`. After CLI run, inspects exit code; on 2/3/5/6, prints the matching fallback suggestion. Otherwise echoes the markdown output to the conversation.
5. Update `code-graph/package.json` — add `"files": ["dist", "plugin", "package.json", "README.md"]` so the plugin dir is included when published.

## Done when

- `pnpm link --global` from `code-graph/`.
- In Claude Code, `/plugin install code-graph` succeeds and prints "installed" with a pointer to `plugin.json`.
- `/graph --help` resolves and explains routing.
- `/scribe-enrich --help` resolves and explains the concept arg.
- `scribe-code-graph` appears in available skills.

(Skill correctness verified end-to-end in Phase 8 when run on the real workorder-store concept; this phase only verifies plugin registration plumbing.)
