---
name: update-concept-skills
description: "Reconciles an existing concept-skill list against what changed since it was last updated, driven by code-graph's skills status and drift reports: which concepts were added, which went away, which skills need revising; then refreshes the graph (extract, apply) and re-enriches revised concepts. Use after a feature lands, when an agent was added or removed, when a code-change report needs folding into the concept skills, or when the concept list has gone stale."
---

# Update Concept Skills

The list already exists; this skill keeps it true. It is the shallow, wide pass — it reconciles the
whole list against what changed. `update-single-concept-skill` is the deep, narrow one. A
**code-change report** in `$ARGUMENTS` makes it much cheaper.

Every command is `node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" …` (written `cg`). Run each
`stamp`, `extract`, `apply` alone in its own Bash call.

## User's intention

$ARGUMENTS

(If that reads as an empty or literal placeholder, nothing was passed — derive the changes yourself.)

**If it carries an approved list of concepts to add or delete**, a previous run proposed one and the
caller settled it. Step 5 is done: apply it in step 6 without re-proposing, and say you resumed.

## Which mode you are in

| Signal | Mode | What changes |
| --- | --- | --- |
| `$ARGUMENTS` carries a report of code changes | **Report-driven** | Trust the report for *what* changed; use `status`/`drift` only to check it missed no concept. |
| An agent was added or removed | **Agent-scoped** | Only `agents/` subdirectories and the `agents` list are in scope. Skip step 4.1–4.3. |
| Neither | **Full** | Derive the changes from the reports in step 3. |

## Workflow

Create a task per step with `TaskCreate`, wired with `TaskUpdate addBlockedBy`.

### 1. Confirm a list exists

```bash
cg skills state
```

Run the `load-concept-skills` skill for the list. **NO LIST** → stop; tell the user to run
`create-concept-skills`. A list that exists but whose `state` is `{"present": false}` is real, just
unrecorded: carry on, step 6 records it.

### 2. Find the freshness picture

```bash
cg skills status --json
cg skills check --json
```

`status` gives per concept `version`, `lastUpdate`, `commitsSince`, `filesChanged` (over the
concept's globs) and `scope`; `list` carries the repo-level window. `check` lists concepts with no
SKILL.md, path mismatches, unmarked skills and docs-only skills. **Each skill is diffed from its own
`lastUpdate`**, not the repo's — a skill deepened by `update-single-concept-skill` is ahead, and
re-doing it wastes the pass. A concept with `commitsSince: 0` is untouched; skip it.

This works with **no tsconfig and no graph**: `status` is a git-diff window over the globs (`scope`
falls back to `"repo"` when a concept declares none), and is the whole staleness signal in such a
repo. If `reason` is `unstamped`/`unknown-commit`/`not-a-git-repo`, treat that skill as stale.

### 3. Read what moved

For each concept with `commitsSince > 0`:

1. **Documentation first** — `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/`. A reframed concept shows
   up here in the author's words.
2. **The graph's drift report**, when the concept is built (a store exists and `tsconfig` is set):

   ```bash
   cg extract <concept> && cg drift <concept> --json
   ```

   Shape: `{ concept, new[], changed[], stale[], missing[], renameCandidates[], doc: { bodyHashChanged } }`.
   `new`/`missing` are vertices added or gone — a concept gaining a whole directory or losing one is
   a candidate to **add or delete**; `changed`/`stale` are where the SKILL.md's claims may now be
   wrong (`stale` = prose enriched against an older body); `renameCandidates` are moves, not
   delete+add — revise file maps rather than treating them as new code; `doc.bodyHashChanged` says
   the SKILL.md itself was edited since the last `apply`.
3. **Without a graph** (no tsconfig, or the concept was never extracted): skip `drift`, and read the
   window instead — `git diff --stat <lastUpdate>..HEAD -- <globs>` and `filesChanged` from
   `status`. For a large diff delegate to a subagent and ask only *which concepts are implicated*.

### 4. Decide what changes

Work through all five, in order, writing the answer to each even when "nothing":

1. **Concepts to add** — core code belonging to no existing skill (`new[]` with no home; files from
   `cg catalog --json` covered by no glob; or a code-change report naming one).
2. **Concepts to delete** — a skill whose subject is gone. A concept that merely shrank is revised.
3. **Skills to revise** — the `SKILL.md`, a `sub-concepts/*.md`, or both. Most changes land here.
4. **`agents/` notes to revise** — only for agents in `cg skills agents`. A removed agent loses its
   notes; an added agent gets none from this skill.
5. **The `agents` list itself** — compare `cg skills agents` with `cg skills agents-discover`. A
   project agent the list lacks is a proposed addition; a listed agent that no longer exists, a
   removal. Both go into step 5's proposal; apply only after the user agrees, with
   `cg skills agents-set <name>...` (it replaces the whole list).

### 5. Confirm additions and deletions

**Only additions and deletions** — revisions to existing skills need no asking. If step 4 found none,
go straight to step 6. A deletion needs the user because a skill may hold hard-won notes that outlive
the code.

**With `AskUserQuestion`** (main session): ask with real labelled options, as in `create-concept-skills`
step 5.

**Without it** (subagent): do step 6 for the **revisions only**, then report the proposed additions
and deletions as a numbered list with reasons, marked unconfirmed. Re-invoking with the approved list
applies it. Never create or delete a concept skill on your own judgement.

### 6. Write, stamp, refresh the graph

Apply the changes, keeping each file lean — this pass reconciles, it does not expand. A skill needing
more says so in the report and is left for `update-single-concept-skill`. Declare a new concept in
`scribe.config.json` (`concepts.<key>.globs` and `skill`) preserving every other key; remove a
deleted one with `cg delete-concept <name>` (when a graph exists).

For every skill you touched — **a minor bump**:

```bash
cg skills stamp <concept-id> --bump minor
```

A skill created this run gets `--bump initial`. A skill you did not touch is **not** stamped: its
`last-update` states when it was last checked against code, and moving it forward for free makes a
stale skill invisible. Then the repo-level record — always minor, even when concepts were added or
deleted (a major is a wholesale re-derivation, `create-concept-skills`' job):

```bash
cg skills stamp --bump minor
```

Never call a bare `skills stamp` without `--bump`: at repo level it defaults to `initial` and resets
the version to 1.0. Pass `--sha <session-start-commit>` if the session committed since it started.

**Then the graph** (skip entirely with no tsconfig / no `concepts`):

```bash
cg extract <concept>
cg apply <concept>
```

for every concept whose code or SKILL.md changed. Then **enrich** each concept whose SKILL.md you
**revised** (its tags and invariants feed enrichment): run the `scribe` skill's enrichment for `<concept>` — the enrichment
procedure lives in the `scribe` skill — and `cg apply <concept>` again to ingest it. Concepts with
only code drift and no skill revision need extract + apply, and enrichment only if `drift` listed
`stale` vertices.

## Report

Four counts — added, deleted, revised, untouched — and the concept ids behind each; which concepts
were re-extracted and re-enriched (or that the graph step was skipped for lack of a tsconfig); any
skill that needs a deep pass; and what the repo-level version moved to.
