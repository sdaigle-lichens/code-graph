---
name: scribe
description: "The one scribe entry point. The rule for what documentation goes where (concept skills under .claude/skills for agents, docs/ for humans, a referenced docs/ file for knowledge both need); the rule that a written SKILL.md is followed by extract + apply; the gap channel working agents report skill gaps through; and the enrichment procedure. Use when writing or moving project documentation, when a concept skill is accumulating diagrams or narrative, when deciding whether something belongs in a skill or a doc, or to enrich a concept."
allowed-tools: Bash, Read, Glob, Grep, Write
---

# Scribe

Two audiences, two homes, and one rule for telling them apart.

**Concept skills** (`.claude/skills/<concept>/`) are for Claude and its subagents. They are loaded
into a context window that costs money and attention, and they are read by something that can already
read the code. **`docs/`** is for humans, who cannot, and who need the picture before the mechanism.

Most documentation mistakes are a file in the wrong home rather than a file badly written.

## Which home

| Write it as | When it is |
| --- | --- |
| A **concept skill** | The mechanism and its invariants. A file map. The traps — what looks like the fix and isn't, what fails silently. What one concept assumes of another. |
| A **`docs/` file** | A diagram or schema drawing. An onboarding narrative. Screenshots. Rationale written to persuade. Anything whose value is in being *looked at*. |
| A **`docs/` file that a concept skill references** | Knowledge both audiences need: how to run a migration, how to add a route, the release process. One home, two readers. |

The third row is the one people skip, and it is the most useful. A `docs/migration-instructions.md`
written for a person, linked from the backend concept skill, is better than the same content twice —
because the two copies drift, and nothing reports it when they do.

## Signs you are in the wrong home

**A concept skill drifting toward `docs/`:**

- An ASCII or Mermaid diagram of more than a few boxes. A small layout sketch earns its place; a
  full architecture drawing is something to look at, and an agent reads the file map instead.
- A schema dump, an ER diagram, a full type listing.
- Narrative — "originally we tried X, then Y, and eventually settled on Z". Keep the *decision* and
  what it prevents; move the story.
- Anything addressed to "you" as a new team member.

When you find one, **offer to move it** and leave a reference behind. Don't move it silently — the
author put it there for a reason and may want to argue.

**A `docs/` file that should be a concept skill:** a doc nobody has read in a year that agents keep
rediscovering the hard way. If its content is mechanism and traps, it is a concept skill wearing the
wrong extension.

## Writing a concept skill

- **Lead with what it is and where it lives.** One paragraph, then a file map.
- **Prefer a table to a paragraph** for anything with more than three parallel cases.
- **Put the trap beside the step that causes it**, not in a list at the end.
- **Every claim is something you read.** A concept skill that describes code that isn't there is
  worse than no skill, because it is believed.
- **Cut as much as you add.** Length is a cost paid by every agent that loads the file.

## Writing a `docs/` file

- Lead with what the reader is trying to do.
- A diagram earns its place when it shows a relationship prose makes the reader hold in their head.
- Say when it was true. A human can tell a stale doc from a current one given a date; an agent
  usually can't, which is the other reason mechanism belongs in a skill.

## After writing a SKILL.md: extract + apply

A concept's `SKILL.md` is ingested into the graph as a doc vertex (`docs/<concept>::skill`), so a
written or revised one is not searchable until the store sees it. Whenever you write or revise the
SKILL.md of a concept declared in `scribe.config.json`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" extract <concept>
node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" apply <concept>
```

Run each alone in its own Bash call. `apply` reports drift; enrichment (below) is a separate,
token-spending step you only run when asked or when `update-concept-skills` calls for it.

**No tsconfig, or no `concepts` in `scribe.config.json`** (Terraform, docs-only repos): there is no
graph to feed. Skip extract + apply, and say so. Writing the SKILL.md and stamping it
(`skills stamp`) is the whole job; nothing else in this skill depends on a graph.

## The concept-skill flows

| Skill | For |
| --- | --- |
| `create-concept-skills` | No concept skills exist yet. Builds the whole list's skeleton (and `scribe.config.json` when absent). |
| `update-concept-skills` | The list exists and the code moved. Reconciles it, wide and shallow; refreshes the graph afterwards. |
| `update-single-concept-skill` | One concept skill is thin or an agent reported a gap. Deep and narrow. |

When you are the scribe agent and the project's concept skills need creating, reconciling or
deepening, you run the flows yourself:

1. **Pick the flow** from the table above: `node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" skills state`
   returns `{"present":false}` for `create`; a `last_update` other than `git rev-parse HEAD` means
   `update`, and `git rev-list --count <last_update>..HEAD` is how far behind. A thin skill or a
   reported gap is `update-single`.
2. **Pass on what you were given.** A caller's code-change report lets the update flow skip
   rediscovering what already changed; a gap delivered on your channel lane names the skill and the
   gap outright.
3. **Expect a proposal step to end your turn.** `create-concept-skills` and `update-concept-skills`
   settle their concept list with the user before writing, and no subagent has `AskUserQuestion`. At
   that step, emit the numbered proposal as your report and stop without writing any file. The caller
   settles it and invokes you again with the approved list. That is a completed turn, not a failure.
4. **Confirm.** Report which flow ran, which concept skills changed, and their new versions.

These flows call `code-graph.cjs` with `Bash` and read widely with `Agent`. The `Bash` you were given
is for that script and read-only `git` (`diff`, `log`, `show`, `rev-parse`) only; never a build, test
run, install or anything that writes outside `.claude/` and `docs/`.

Never hand-edit a concept skill's `metadata.version` or `metadata.last-update`. The flows write them
(`skills stamp`), and a hand-set version silently changes how much work the next pass does.

## Reporting a gap

Working agents write skill gaps to your own channel lane — `.claude/channels/scribe/` — rather than
into a caller's report: the skill they loaded and what it failed to tell them. That arrives inlined
in your context, labelled by sender, the next time you're invoked, whether or not this run's
workflow wired a route to you at all. For a concept skill it is the signal to run
`update-single-concept-skill` on it, and it is worth more than any audit you could run yourself: it
names a gap someone actually hit.

The file a working agent writes is `.claude/channels/scribe/<agent>.1.md`, holding a fenced `json`
block: `{ "skill_gaps": [{ "skill": "<skill-id>", "missing": "<what it did not tell you>" }] }`. It is
left unwritten when nothing was missing — a gap is never written just to fill the file. Maestro
relies on this exact path and shape; do not rename either.

## Enrichment (procedure)

Enrichment adds semantic fields to a concept's AST JSON. It is invoked by the update flows and the
retrieval skill's "yes, build it" path; never run it unprompted. Two paths, incremental first.

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

## Also true of the other files

The `CHANGELOG.md`, `AGENTS.md` File Structure sections and `.claude/rules/` are unchanged by any of
this — they have their own rules in the scribe agent's own file. This skill is only about the
concept-skill/`docs/` split, the graph refresh, the gap channel and enrichment.
