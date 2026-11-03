---
name: code-graph-uninstall
description: "Turns code-graph off for this project: disables code-graph@code-graph in .claude/settings.json, then names each artefact code-graph install and use added (the skills block, the .gitignore line, the sandbox allowRead entry, the deps cache, scribe gap files) and offers to remove each, one consent per item, default no. SKILL.md files, scribe.config.json concepts, scribe-output/ and tsconfig.code-graph.json are kept. Use when the user runs /code-graph-uninstall or asks to stop using the code-graph plugin in a project."
disable-model-invocation: true
---

# Code Graph Uninstall

Switch code-graph off for one project without deleting any documentation. Disabling the plugin is the
only step that happens without a question. Every other artefact below is offered on its own, with its
own yes or no, and **the default is no**: remove an item only on an explicit yes for that item.

CLI calls are `node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs"` (written `cg`), each alone in
its own Bash call.

## User's intention

$ARGUMENTS

## Workflow

1. **Disable the plugin.** Read `${CLAUDE_PROJECT_DIR:-.}/.claude/settings.json`. If it does not
   parse, stop and tell the user. Remove the `"code-graph@code-graph"` entry (or `@` whatever
   marketplace it was installed from) from `enabledPlugins`, or set it to `false` if the user prefers
   to keep a record. Leave every other key untouched; drop `enabledPlugins` only if that leaves it
   empty. If the entry is not there, say the plugin was not enabled for this project.

2. **List what install and use added.** Check each item below, then show the user the ones that exist
   as one list (item, where it is, what removing it does) before asking about any of them. Skip, and
   say so, an item that is not there. Then ask one question per item, default **no**.

   a. **The `skills` block** in `scribe.config.json` (`version`, `last_update`, `agents`). Show
      `cg skills state` and `cg skills agents`. Keeping it is the better default: it is a committed
      record of the list's history, and a later install picks up where this one stopped. On yes, edit
      `scribe.config.json` so every other key is untouched. A leftover `.claude/concept-skills.json` is a
      separate item with its own question.

   b. **The `.gitignore` line** from install step 6: `scribe-output/graph.db*` (or `<dbPath>*` when
      `scribe.config.json` sets `dbPath`) in `${CLAUDE_PROJECT_DIR:-.}/.gitignore`. Removing it makes
      the store files show up in `git status` again. On yes, remove only that line.

   c. **The `sandbox.filesystem.allowRead` entry** from install step 7: the absolute
      `<XDG_CACHE_HOME|~/.cache>/code-graph` path, in `~/.claude/settings.json` (user) or
      `.claude/settings.local.json` (local). Look in both; it may be in neither. Say it is a lasting
      settings change and which file holds it. On yes, remove just that path from the array with Edit
      and leave the other entries and keys alone. If a hook asks before a settings edit, explain what
      the edit is and wait for the user; do not work around it.

   d. **The deps cache**: `~/.cache/code-graph/deps` (under `$XDG_CACHE_HOME` when set), and
      `$CLAUDE_PLUGIN_DATA/deps` when that is set. Run `cg deps status` for the exact paths. This is the
      npm-installed `ts-morph`; **other projects on this machine may share it**, and `deps install`
      needs the npm registry to bring it back. On yes, delete those directories and nothing else under
      `~/.cache/code-graph`.

   e. **Gap files** under `${CLAUDE_PROJECT_DIR:-.}/.claude/channels/scribe/` (the
      `<agent>.1.md` files agents wrote their skill gaps to). List them. On yes, delete those files
      only, not the channel directories of other plugins.

3. **What is kept on purpose.** Tell the user these stay, and why:

   - every `.claude/skills/<id>/SKILL.md` carrying `metadata.type: concept-skill`: an ordinary skill
     that keeps working with the plugin off. **Do not touch, move or delete a SKILL.md.**
   - `scribe.config.json` and its `concepts`;
   - `scribe-output/` (the graph store, `.ast.json` and `.enriched.json`);
   - `tsconfig.code-graph.json`.

   If the user wants any of those gone, tell them to delete them themselves.

4. **Maestro.** If `.claude/maestro.json` lists `code-graph:scribe` (or any `code-graph:` skill) on an
   agent, tell the user those entries now point at a skill that is no longer available and should be
   removed in the Maestro app's workflow view. Do not edit `maestro.json`.

5. **Report** what was disabled, which items were removed, which were kept (the default-no items and
   the kept-on-purpose list), and what the user still has to do.
