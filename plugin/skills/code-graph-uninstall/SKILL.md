---
name: code-graph-uninstall
description: "Turns code-graph off for this project: disables code-graph@code-graph in .claude/settings.json and, only if the user agrees, removes the skills block from scribe.config.json. SKILL.md files, scribe.config.json and the graph store are left in place. Use when the user runs /code-graph-uninstall or asks to stop using the code-graph plugin in a project."
disable-model-invocation: true
---

# Code Graph Uninstall

Switch code-graph off for one project without deleting any documentation.

CLI calls are `node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" …` (written `cg`), each alone in
its own Bash call.

## User's intention

$ARGUMENTS

## Workflow

1. **Disable the plugin.** Read `${CLAUDE_PROJECT_DIR:-.}/.claude/settings.json`. If it does not
   parse, stop and tell the user. Remove the `"code-graph@code-graph"` entry (or `@` whatever
   marketplace it was installed from) from `enabledPlugins`, or set it to `false` if the user prefers
   to keep a record. Leave every other key untouched; drop `enabledPlugins` only if that leaves it
   empty. If the entry is not there, say the plugin was not enabled for this project.

2. **The recorded state.** Show `cg skills state` and `cg skills agents` (the `skills` block of
   `scribe.config.json`, which also holds the list's `version` and `last_update`). Ask whether to
   remove that block. Default **no**: it is a committed record of the list's history, and keeping it
   means a later install picks up where this one stopped. Remove it only on an explicit yes, editing
   `scribe.config.json` so every other key is untouched. Do the same for a leftover
   `.claude/concept-skills.json`, and only on an explicit yes.

3. **Leave everything else.** Every `.claude/skills/<id>/` carrying `metadata.type: concept-skill`
   is an ordinary skill and keeps working with the plugin off — **do not touch, move or delete a
   SKILL.md**. The same goes for `scribe.config.json`'s `concepts` and for `scribe-output/` (the graph
   store). If the user wants them gone, tell them to delete those themselves.

4. **Maestro.** If `.claude/maestro.json` lists `code-graph:scribe` (or any `code-graph:` skill) on an
   agent, tell the user those entries now point at a skill that is no longer available and should be
   removed in the Maestro app's workflow view. Do not edit `maestro.json`.

5. **Report** what was disabled, what was kept, and what the user still has to do.
