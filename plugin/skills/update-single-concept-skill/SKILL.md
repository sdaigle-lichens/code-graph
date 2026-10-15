---
name: update-single-concept-skill
description: "Takes one concept skill from skeleton to something worth loading: researches the concept (using code-graph query concept and impact when a graph exists), deepens its SKILL.md and sub-concepts, and writes per-agent notes for the agents the project actually uses. Use when a concept skill is thin, when an agent reports a gap in one, or when the user asks to improve or flesh out a specific concept skill."
---

# Update Single Concept Skill

The deep, narrow pass. `create-concept-skills` writes skeletons and `update-concept-skills` keeps
them true; this is where one concept skill becomes useful.

It is not a licence to read everything. The measure of a good concept skill is how quickly an agent
that loads it can start working and how many traps it walks the agent around — the notes a colleague
would give in five minutes before you touched the code.

Every command is `node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" …` (written `cg`). Run `stamp`,
`extract`, `apply` alone in their own Bash call.

## User's intention

$ARGUMENTS

(The concept skill to work on, or a gap report naming it. If nothing was passed, run step 1 and ask
which one.)

## Workflow

### 1. Find it, and read how mature it is

Run the `load-concept-skills` skill. **NO LIST** → tell the user to run `create-concept-skills`.

| Version | What it means | This pass |
| --- | --- | --- |
| `1.0` | A skeleton. Never researched. | Broad. Establish the mechanism, file map, relationships, first real traps. |
| `1.x` | Reconciled against diffs, never deepened. | Same — a minor bump is not a deep pass. |
| `2.0`+ | Already been through here. | Targeted. Find what is now wrong or missing; do not rewrite what is right. |

On a `2.0`+ skill read the existing file first and treat it as mostly correct: rewriting loses the
traps someone paid for in a debugging session. If a gap report named the skill, the `missing` text is
your starting question.

### 2. Understand the concept, and its neighbours

**With a graph** (the concept is built: `cg status` shows rows, `cg query concept <name>` exits 0):

```bash
cg query concept <name>            # every vertex with purpose, tags, edges — the concept's real shape
cg query impact <symbol> --direction in    # who depends on a load-bearing symbol
cg query cross <name> <neighbour>  # how two concepts really touch
cg search "<what the gap asked>"   # BM25 + expansion across concepts
```

Use the pointers (`@filepath:line`) as your `Read` targets; the graph says *where* and *why*, you
still read the source. Exit 6 (no results) or a concept the graph does not know: fall back to reading.
The graph reflects the last `apply` — verify a stale-looking pointer against the file.

**Without a graph** (no tsconfig, or never extracted): read the concept's own code through the file
map the skill carries and its globs in `scribe.config.json`, bounded by that map.

Either way, read enough of the **other** concept skills to place this one — what it assumes of them
and they of it. Delegate breadth to subagents; keep the synthesis. Worth writing down: a decision
that looks arbitrary until you know what it prevents, and a failure mode that does not announce
itself. Git history and comments are where those live.

### 3. Deepen the `SKILL.md`

- **What this is, and where it lives.** One paragraph, then a file/directory map.
- **How it works.** Mechanism and invariants — the reasoning needed *before* changing anything.
- **Its relationships.** Other concept skills it touches, by name.
- **Things that bite.** The traps; the section that earns the skill its context cost.
- **Sub-concepts.** One line each, linking `sub-concepts/*.md`.

Cut as much as you add.

### 4. Deepen the sub-concepts

Each `sub-concepts/*.md`: the mechanism, its files, its own traps. Add a sub-concept file only for a
part the concept genuinely has.

### 5. Write `agents/` notes — only where they earn their place

```bash
cg skills agents
```

Write `agents/<agent>.md` **only** for agents in that list, **only** where an agent needs something
the shared file shouldn't carry (how the backend agent implements against this concept, how test
tests it, what the reviewer looks for). An empty list means no agent notes. Reference each note from
the `SKILL.md`.

### 6. Clean it up

Run the `cleanup-skill` skill on this concept skill's directory, before stamping, so the recorded
version reflects the file a session will load.

### 7. Stamp it — a major bump

```bash
cg skills stamp <concept-id> --bump major
```

Alone in its own Bash call. The repo-level record is **not** touched: the list did not change, only
one skill's depth.

### 8. Refresh the graph (skip with no tsconfig / no graph)

```bash
cg extract <concept>
cg apply <concept>
```

The new SKILL.md body is ingested as the concept's doc vertex. Then offer the `scribe` skill's enrichment for `<concept>`:
a deepened skill's tags and invariants are what enrichment reads, and a concept enriched against the
skeleton is the stale one. In a repo with no tsconfig, stop at the stamp.

## Report

The concept skill, old and new version, and what changed: sections deepened, sub-concept files
added or removed, agent notes written (and the agents deliberately given none). If something belongs
in `docs/` rather than here — a diagram, schema, onboarding walkthrough — say so and offer to move
it; the `scribe` skill carries that rule.
