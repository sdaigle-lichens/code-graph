# Phase 4 — Plugin packaging + enrich subagent

## Goal

Ship a Claude Code plugin from `code-graph/plugin/` that loads via `claude --plugin-dir <path>`. Plugin contains the `scribe-code-graph` enrichment skill and the `/graph` and `/scribe-enrich` slash commands. After this phase, a user can `pnpm link --global` the package (for the `code-graph` CLI binary used by `/graph`) and start a Claude Code session with `claude --plugin-dir /path/to/code-graph/plugin` to load the skill + commands. Marketplace publishing is a follow-up — out of scope here.

## Context

### Plugin layout

Per Claude Code plugin spec, the manifest lives in `.claude-plugin/plugin.json` and skills/commands directories are auto-discovered (do **not** list them in the manifest).

```
code-graph/plugin/
├── .claude-plugin/
│   └── plugin.json         # manifest (name + metadata only)
├── skills/
│   └── scribe-code-graph/SKILL.md
└── commands/
    ├── graph.md            # /graph
    └── scribe-enrich.md    # /scribe-enrich <concept>
```

### `plugin.json` shape

Manifest holds metadata only — no `skills` / `commands` arrays. Claude Code auto-discovers from the `skills/` and `commands/` directories.

```json
{
  "name": "code-graph",
  "version": "0.1.0",
  "description": "Code-concept graph — scribe + query for Claude Code",
  "author": {
    "name": "Samuel Daigle",
    "email": "daigles@lichens.ai"
  },
  "keywords": ["code-graph", "scribe", "ast", "arangodb"]
}
```

### Subagent (`scribe-code-graph` skill) — strict boundaries

- **Tools allowed:** `Read`, `Glob`, `Grep`, `Write`. No Bash, no Edit. `Write` is restricted by Hard rules to a single file (`outPath`).
- **Writes:** only `<cwd>/scribe-output/<concept>.enriched.json`.
- **Must NOT touch AST-authoritative fields** (`filepath`, `start_line`, `end_line`, `signature`, `contentHash`, `type`, `name`, `displayKey`, `ast.*`).
- **Inputs (passed by `/scribe-enrich`):** concept name, astPath, skillPath, outPath. All paths are resolved relative to the config root (the directory containing `scribe.config.json`), not CWD — `code-graph extract` writes under `<configRoot>/scribe-output/`, so the skill must read from the same base.
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
2. Resolves paths (all relative to config root):
   - `astPath = scribe-output/<concept>.ast.json`
   - `skillPath` — `config.concepts[concept].skill` if set, else `<config.skillsDir>/<concept>/SKILL.md`, else fail.
   - `outPath = scribe-output/<concept>.enriched.json`
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

1. Create `code-graph/plugin/.claude-plugin/plugin.json` per shape above. Skills/commands are auto-discovered from sibling `skills/` and `commands/` dirs — do not enumerate them in the manifest.
2. Create `code-graph/plugin/skills/scribe-code-graph/SKILL.md`. Sections:
   - **Frontmatter** — `name`, `description`, `allowed-tools: Read, Glob, Grep, Write` (Write needed to emit `outPath`; Hard rules constrain it to that single file).
   - **When to use** — invoked by `/scribe-enrich <concept>`. Never invoke directly.
   - **Inputs** — concept name, astPath, skillPath, outPath.
   - **Procedure** — read astPath, read skillPath, for each vertex in ast.json read the source file slice (`filepath` + `start_line`–`end_line`) for context, write enrichment fields. Cross-reference SKILL.md for invariants → tags. Identify cross-concept refs by looking at imports/calls into other concept directories.
   - **Output schema** — exactly the JSON shape above.
   - **Hard rules** — never touch AST fields; only write to outPath; do not invoke other tools; if context is unclear leave a field null rather than guessing.
   - **Signature stability** — set `sig_seen` to current vertex signature.
3. Create `code-graph/plugin/commands/scribe-enrich.md` — slash command body. Argument: `<concept>`. Body: resolves `scribe.config.json` from CWD ancestry, then computes:
   - `astPath = <configRoot>/scribe-output/<concept>.ast.json`
   - `skillPath` — fallback chain: (1) `config.concepts[concept].skill` if set, else (2) `<configRoot>/<config.skillsDir>/<concept>/SKILL.md` if `skillsDir` set, else (3) fail with msg telling user to set one of them.
   - `outPath = <configRoot>/scribe-output/<concept>.enriched.json`

   Verify `astPath` exists (else tell user to run `code-graph extract <concept>` first). Then invoke the `scribe-code-graph` skill with the four inputs.
4. Create `code-graph/plugin/commands/graph.md` — slash command body. Body: parses `$ARGUMENTS`. If first token is `concept|impact|cross|vertex`, runs `code-graph query $ARGUMENTS`; else runs `code-graph search "$ARGUMENTS"`. After CLI run, inspects exit code; on 2/3/5/6, prints the matching fallback suggestion. Otherwise echoes the markdown output to the conversation.
5. Update `code-graph/package.json` — add `"files": ["dist", "plugin", "package.json", "README.md"]` so the plugin dir is included when published.

## Done when

- `pnpm link --global` from `code-graph/` succeeds (makes the `code-graph` CLI binary available globally — needed by `/graph` which shells out to it).
- Starting a session in `~/Documents/gits/lichens-ordonnancement-ui` with `claude --plugin-dir /Users/samueldaigle/Documents/gits/code-graph/plugin` loads the plugin without errors.
- `/graph` resolves as a slash command in the loaded session.
- `/scribe-enrich` resolves as a slash command in the loaded session.
- `scribe-code-graph` appears in the available skills list.
- `claude plugin validate /Users/samueldaigle/Documents/gits/code-graph/plugin` reports no errors.

(Skill correctness verified end-to-end in Phase 8 when run on the real workorder-store concept; this phase only verifies plugin registration plumbing. Marketplace publishing — `/plugin marketplace add` + `/plugin install code-graph@<marketplace>` — is a separate concern, deferred until the plugin stabilises.)
