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
cg skills status --summary
cg skills check --json
```

`status --summary` (compact, about 2 KB for 16 concepts; the full `--json` is 30+ KB, read it only
for one concept's file list) gives per concept `id`, `v` (version), `at` (last-update), `commits`
and `files` since (over the concept's globs) and a `graph` count block; `list` carries the
repo-level window. `commits: null` means the window could not be counted (unstamped, unknown
commit, not a git repo): treat that skill as stale. `check` lists concepts with no
SKILL.md, path mismatches, unmarked skills and docs-only skills. **Each skill is diffed from its own
`lastUpdate`**, not the repo's — a skill deepened by `update-single-concept-skill` is ahead, and
re-doing it wastes the pass. A concept with `commits: 0` is untouched; skip it.

`status` also carries `unextracted: { changed, new, removed, files[] }` per concept: source files
under its globs that were edited, added or removed since the last `extract` (file counts, not
vertices; absent until the concept's `.ast.json` records `meta.files`, i.e. after one `extract` on
0.3.17+). Any non-zero count means the graph is behind the source: that concept goes through
`extract` + `apply` in step 3 and step 6 even when its vertex-level `graph.changed` reads 0.

`--summary` carries it as `unextracted: { changed, new, removed }` (counts only, no `files[]`).

This works with **no tsconfig and no graph**: `status` is a git-diff window over the globs (the
whole repo when a concept declares none), and is the whole staleness signal in such a repo.

### 3. Read what moved

For each concept with `commits > 0` or a non-zero `unextracted` count:

1. **Documentation first** — `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/`. A reframed concept shows
   up here in the author's words.
2. **The graph's drift report**, when the concept is built (a store exists and `tsconfig` is set):

   ```bash
   cg extract <concept> && cg drift <concept> --json
   ```

   Shape: `{ concept, new[], changed[], stale[], missing[], renameCandidates[], doc: { bodyHashChanged }, unextracted }`.
   (`drift` compares the `.ast.json` just written with the store; run `extract` first, as above, or its
   vertex lists miss unextracted edits. `unextracted` then reads zero.)
   `new`/`missing` are vertices added or gone — a concept gaining a whole directory or losing one is
   a candidate to **add or delete**; `changed`/`stale` are where the SKILL.md's claims may now be
   wrong (`stale` = prose enriched against an older body); `renameCandidates` are moves, not
   delete+add — revise file maps rather than treating them as new code; `doc.bodyHashChanged` says
   the SKILL.md itself was edited since the last `apply`.
3. **Without a graph** (no tsconfig, or the concept was never extracted): skip `drift`, and read the
   window instead — `git diff --stat <lastUpdate>..HEAD -- <globs>` and the file list from
   `cg skills status --json` (full form; read it for that concept only). For a large diff delegate to a subagent and ask only *which concepts are implicated*.

### 4. Decide what changes

Before deciding edit or stamp-only for a skill, run `cg skills status <concept-id>` and show its file list
(changed files with commit counts). A **stamp-only** needs you to read the SKILL.md sections covering those
files, and a one-line reason per stamp-only in this run's report (which files, why the prose still holds).

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

Stamping without editing the SKILL.md prints a blind-stamp warning naming the changed files (still exit 0).
Pass `--reviewed` only after the comparison above, never by default. Edit the skill first when the warning is right.

Exit 9 means the sandbox blocked the SKILL.md write: the output says `set exactly these lines in its
metadata block:` (or, for an unmarked skill, `replace the metadata block (or add it to the frontmatter)
with exactly:`) and the lines. Apply them with Edit, then re-run `cg skills status`.

Never call a bare `skills stamp` without `--bump`: at repo level it refuses (exit 1) over an
existing version; `--bump initial` would reset it to 1.0. Pass `--sha <session-start-commit>` if the session committed since it started.

**Then the graph** (skip entirely with no tsconfig / no `concepts`). Run it for every concept whose
skill you revised **and** every concept with a non-zero `unextracted` count, even when its skill text
needs no change:

```bash
cg extract <concept>
cg apply <concept>
```

for every concept whose code or SKILL.md changed. Then enrich, **incrementally by default**
(the procedure lives in the `scribe` skill, "Incremental path"):

1. Decide with `cg enrich targets <concept> --summary --json`: it lists what needs enriching,
   lazily by default: changed and stale vertices, plus never-enriched ones that are core or that
   this run's `extract` → `apply` saw as new, changed or renamed. Never-enriched, untouched,
   non-core vertices are not listed; `core.leftOut` counts them. Nothing listed: stop for this
   concept. `core.size`, `core.leftOut`, `core.thin` and `core.message` say how much was left out
   and whether the core is thin. A thin core goes to `update-single-concept-skill` to deepen the
   skill (run it from the main session; from a subagent, report it with `core.message`, do not run
   it). Each batch reads full details (signature, edges without a reason) for its own targets only:
   `cg enrich targets <concept> --json --vertex <key>...`.
2. **Main session (Agent tool):** fan the targets out in small batches to **Haiku** subagents,
   launched by you. Each returns a partial enrichment file.
   **Subagent (no Agent tool):** enrich **up to 20** targets yourself (purpose, tags, edge reason,
   same partial format), in this order: changed and stale, then vertices the SKILL.md names, then
   hubs, then the rest. List the remainder under "left to enrich" in the final report (names,
   filepaths, reasons) for a main session to fan out; they keep `agent.touched_at`, so they stay
   targets on the next run. Never skip the inline part because the list is long.
3. `cg enrich merge <concept> <partial>` for each, spot-check a few descriptions against the code
   (re-ask or drop bad ones), then `cg apply <concept>` to ingest.

A concept whose SKILL.md you **revised** is the exception: its tags and invariants feed every
description, so re-enrich the **whole concept** (the scribe skill's "Whole-concept path"): the
vertices already enriched plus the core, not every vertex; never-enriched non-core vertices stay
lazy. Then merge and apply the same way. `--all` is only for a full pass the user explicitly asks
for. Concepts with only code drift and no skill revision never need that.
With no tsconfig this whole step is skipped.

## Report

Four counts — added, deleted, revised, untouched — and the concept ids behind each; which concepts
were re-extracted and re-enriched (or that the graph step was skipped for lack of a tsconfig); any
skill that needs a deep pass (including any thin core); the "left to enrich" list when a subagent
had more than 20 targets; "core grew from N to M with this run's skill edit" when a SKILL.md revised
in this run grew a concept's core (`core.size` before and after the edit); and what the repo-level
version moved to.
