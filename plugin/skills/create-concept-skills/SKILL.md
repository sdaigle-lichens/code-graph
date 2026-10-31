---
name: create-concept-skills
description: "Builds a project's concept-skill list from scratch: reads the code-graph catalog to propose concepts, agrees them with the user, then writes scribe.config.json, a SKILL.md and sub-concepts/ skeleton per concept, stamps version 1.0, and builds the graph. Use when a repo has no concept skills yet, when the user asks to document the project's core concepts for agents or to initialise code-graph, or when update-concept-skills reports no list exists."
---

# Create Concept Skills

A **concept** is a named slice declared in `scribe.config.json` (globs + a SKILL.md). A **concept
skill** is that SKILL.md: `.claude/skills/<id>/SKILL.md`, written for Claude and its subagents, so an
agent can get oriented in a concept fast and then explore the code itself.

This skill builds the **skeleton** of the whole list — it names the concepts, declares them in
`scribe.config.json`, writes a SKILL.md for each, stamps them at **1.0**, and builds the graph.
`update-single-concept-skill` is where one concept is researched properly.

> **Budget matters more than completeness here.** Do not read the project exhaustively. The catalog
> is the cheap map; delegate any further reading to cheap subagents and keep their findings as
> *lists of candidate concepts*.

Every command below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" …` (written `cg` here).
Run each state-changing one (`stamp`, `extract`, `apply`) alone in its own Bash call.

## User's intention

$ARGUMENTS

(If that reads as an empty or literal placeholder, nothing was passed — work from the repo alone.)

**If it already carries an approved concept list**, a previous run proposed one and the caller has
settled it with the user. Skip steps 2–5, treat that list as final, go straight to step 6, and say in
your report that you resumed from an approved proposal.

## Workflow

Create a task per step with `TaskCreate` and wire them with `TaskUpdate addBlockedBy`.

### 1. Stop if a list already exists

```bash
cg skills state
cg skills list
```

`state` reports `{"present": true, ...}` when a list is recorded (in the `skills` block of
`scribe.config.json`, or the legacy `.claude/concept-skills.json`). If it does — **or** if `list`
finds any concept skills — stop and tell the user to run `update-concept-skills`. Rebuilding over an
existing list is how hand-written concept skills are lost. A run resuming from an approved proposal
may continue even if its skeleton is partly on disk.

An existing `scribe.config.json` **without** a list is fine: it declares concepts that have no skill
yet. Keep its concepts (step 4 starts from them) and never overwrite its other keys.

### 2. Read what the project says about itself

Dispatch a **subagent** (`Explore`, or `general-purpose` on a cheap model) for `README.md`, every
`CLAUDE.md`, `AGENTS.md`, `docs/`, and the descriptions of existing skills in every `.claude/skills`.
Ask for **candidate core concepts, one line each**, plus where the docs live — no file contents.

### 3. Map the code

**With a tsconfig** (TypeScript/React repo): the catalog is the map.

```bash
cg catalog --json [--tsconfig <path>]
```

It needs no store. It returns `units`, per-file `path`/`unit`/`exports`/`kind`/`leadingDoc`,
`imports[]` adjacency, `fanIn`/`fanOut`, and `hubs` (fan-in ≥ 5: shared infrastructure, **never a
concept root**). Cluster files into domains from names and structure only: directory cohesion,
shared name roots (`workorder*.ts`, `use-workorder*.ts`), export patterns, and `store` + `hook` +
`component` kinds sharing a root. Exclude hubs, tests, index and config files. Validate each
candidate against `imports[]`: mark it tight, disconnected (consider splitting) or spanning a hub.
Open files only to settle an ambiguous boundary — **at most 30 reads** in the pass.

**No tsconfig / not TypeScript** (Terraform, Python, docs repos): `catalog` fails, which is expected —
do not fight it. Dispatch a second subagent over the top-level structure (entry points, directory
layout, biggest modules) for candidate concepts and each one's home directory. The concepts get
`globs` by hand (step 6) and the flow skips every graph step.

### 4. Propose the list

For each concept: name, one-line description, home directory, `globs`, files captured with a few
samples, cohesion (✓ tight / ⚠ disconnected / ⚠ includes infrastructure), and any **sub-concepts**
(only parts that genuinely deserve their own file).

Cap the proposal at about **8 concepts per app unit and 4 per package unit**. Curation, not
coverage: utils, config and glue stay uncovered on purpose. Say which came from docs, which from the
catalog, and which you are least sure about. Overlap between concepts is information, not a conflict.

### 5. Settle it with the user

**If `AskUserQuestion` is available** (main session): ask per concept — accept / edit globs / rename /
reject — with real option labels and descriptions, and about where a multi-package concept belongs.
After the verdicts show a coverage summary (N concepts, M files, K% of source; what is intentionally
uncovered) and get a final confirmation before writing. Concept keys are immutable once written: they
feed the vertex `_key` hash.

**If it is NOT available** (you are a subagent): decide nothing and write nothing. Emit the step-4
proposal as your report, mark it unconfirmed, and say that re-invoking this skill with the approved
list resumes at step 6. That is a completed turn, not a failure.

### 6. Write config and skeletons

**`scribe.config.json`** — create it, or add only the missing `concepts` keys to the existing one,
preserving every other field:

```json
{
  "project": "<package.json name without @scope, confirmed>",
  "tsconfig": "<detected, omit when there is none>",
  "skillsDir": ".claude/skills",
  "concepts": {
    "<concept>": { "globs": ["<glob>", "…"], "skill": "<path to its SKILL.md>" }
  }
}
```

**Each SKILL.md** goes in the `.claude/skills/` nearest its code, with two overrides:

- **Never write into a tree the repo publishes** (a plugin directory, a package copied into an
  installable artifact) — a concept skill there ships to users who are not its audience. Use the
  nearest `.claude` outside it, in practice the repo root.
- Anything repo-wide, or belonging to no one package, goes at the root. A `CLAUDE.md` that names where
  developer docs live settles the question over both.

```
<dir>/.claude/skills/<concept-id>/
  SKILL.md
  sub-concepts/<sub-concept>.md
```

Frontmatter is `name` and `description` only — stamping adds the markers. The body: one paragraph on
what the concept is and where it lives; the file map (a table past a handful); relationships to other
concept skills by name; a `## Sub-concepts` section, one line per file. Write only the approved
sub-concepts; a stub that says nothing is worse than no file. **No `agents/` directory** — that is
`update-single-concept-skill`'s job.

For the `skill` path in the config: use the SKILL.md you just wrote. Where the key contains `/`
(`web/workorder-store`), the id directory is its last segment.

### 7. Stamp — create is 1.0

```bash
cg skills stamp <concept-id>... --bump initial
cg skills stamp --bump initial
```

First every skill written, in one call, then the repo-level `skills` block. Both default to `HEAD`.
**Before stamping, warn the user** that the sandbox often blocks writes under the project's own
`.claude/skills`, so some stamps may come back unwritten and you will offer to apply their lines with
Edit. A blocked write does not stop the rest of the batch; it exits 9 and lists every blocked
SKILL.md under `N stamp(s) computed, not written; apply these lines by hand with Edit:`.
Never hand-edit `metadata.version` or `metadata.last-update`, except on exit 9 (sandbox blocked the
write): per blocked skill the output says `set exactly these lines in its metadata block:` (unmarked
skill: `replace the metadata block (or add it to the frontmatter) with exactly:`) and the lines. Apply
them with Edit, then re-run `cg skills status`.

### 8. Build the graph (skip with no tsconfig)

```bash
cg bootstrap
cg extract --all
cg apply --all
```

`bootstrap` once, then `extract` + `apply` over every concept in one call each — zero tokens, and the new SKILL.md is
ingested as a doc vertex so `search` finds it. **Do not enrich now**: enrichment spends tokens and
is better done when a SKILL.md has real content — run the `scribe` skill's enrichment for `<concept>` after
`update-single-concept-skill`. In a repo with **no tsconfig** skip this whole step: the skills and
the stamps are complete without a graph, and staleness is tracked by the git-diff window of
`cg skills status`.

## What belongs in a concept skill

For an agent about to change the code: the mechanism and invariants; where things live (a file map
beats a paragraph); the traps — what looks like the fix and is not, what fails silently; what this
concept assumes of the others. Not diagrams, schemas or onboarding narrative (those go to `docs/`;
the `scribe` skill is the rule), not an account of every function, nothing you have not read.

## Report

How many concept skills were created and where each landed; any concept the user rejected; what the
config and the repo-level stamp now say; whether the graph was built or skipped (and why). Close by
naming `update-single-concept-skill` as the next step for the concept that matters most, and
the `scribe` enrichment for after it.
