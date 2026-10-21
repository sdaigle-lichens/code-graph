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

Run each alone in its own Bash call. `apply` reports drift; enrichment (`enrichment.md`) is a separate,
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
into a caller's report: the skill they loaded and what it failed to tell them. Under maestro that
arrives inlined in your context, labelled by sender, the next time you're invoked, whether or not this run's
workflow wired a route to you at all. Without maestro nothing is inlined: at the start of a run read
`.claude/channels/scribe/*.md`, handle each gap and say which files you handled. For a concept skill it is the signal to run
`update-single-concept-skill` on it, and it is worth more than any audit you could run yourself: it
names a gap someone actually hit.

The file a working agent writes is `.claude/channels/scribe/<agent>.1.md`, holding a fenced `json`
block: `{ "skill_gaps": [{ "skill": "<skill-id>", "missing": "<what it did not tell you>" }] }`. It is
left unwritten when nothing was missing — a gap is never written just to fill the file. Maestro
relies on this exact path and shape; do not rename either.

**An "enrich only" gap is not a skill gap.** A `missing` that starts with `enrich only:` lists search
hits an agent relied on that had no purpose (`enrich only: <name> (<filepath>), … — found by search
"<query>"`, written by the `code-graph-retrieval` skill). The SKILL.md did not fail anyone, so do not
revise it, research the concept or run `skills stamp`. Run `update-single-concept-skill`, which takes
its **Only a reported gap to close** branch directly: enrich the named vertices through the
incremental path in `enrichment.md` (`cg enrich targets <concept> --json --vertex <name>...`; from a subagent
inline, within the 20-target rule), then `cg enrich merge`, a spot-check and `cg apply`.

## Enrichment

Enrichment (adding `purpose`, `tags` and edge reasons to a concept's vertices) is invoked by the update
flows and the retrieval skill's "yes, build it" path; never run it unprompted. **Only when a run enriches,**
Read `${CLAUDE_PLUGIN_ROOT}/skills/scribe/enrichment.md` (incremental path, whole-concept path, output
schema, hard rules). Do not read it otherwise.

## Also true of the other files

The `CHANGELOG.md`, `AGENTS.md` File Structure sections and `.claude/rules/` are unchanged by any of
this — they have their own rules in the scribe agent's own file. This skill is only about the
concept-skill/`docs/` split, the graph refresh, the gap channel and enrichment.
