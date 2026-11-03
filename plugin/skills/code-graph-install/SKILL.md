---
name: code-graph-install
description: "Sets up code-graph concept skills for this project: enables code-graph@code-graph in .claude/settings.json, migrates a legacy .claude/concept-skills.json into the skills block of scribe.config.json (version carried over unchanged), records the agents that get per-agent notes, and offers create-concept-skills. Use when the user runs /code-graph-install or asks to turn on / set up code-graph or concept skills for a project."
disable-model-invocation: true
---

# Code Graph Install

Turn the code-graph plugin on for one project. Everything here is project-local and re-runnable: a
second run changes nothing that is already right.

Every CLI call is `node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" …` (written `cg`). Run each
call alone in its own Bash call.

## User's intention

$ARGUMENTS

## Workflow

1. **Enable the plugin for the project.** Read `${CLAUDE_PROJECT_DIR:-.}/.claude/settings.json`
   (a missing file is `{}`; one that exists but does not parse as JSON: stop and tell the user rather
   than overwrite it). Make sure `enabledPlugins` has `"code-graph@code-graph": true`, keeping every
   other key exactly as it is. If the marketplace the plugin was installed from is not named
   `code-graph`, use that name after the `@`.

2. **Migrate the legacy state file, if there is one.** Check `.claude/concept-skills.json` (maestro's
   concept-skills plugin wrote it) and what the CLI reads:

   ```bash
   cg skills state
   cg skills agents
   ```

   `state` reports `source`: `.claude/concept-skills.json` means the list record still lives only in
   the legacy file. Show the user its `version`, `last_update` and the `agents` list, then migrate by
   re-writing the **same agents** — the first write of the `skills` block in `scribe.config.json`
   seeds `version`, `last_update` and `agents` from the legacy file:

   ```bash
   cg skills agents-set <name> <name>
   ```

   (pass exactly what `skills agents` printed; no names if it printed `[]`). **Never run a bare
   `skills stamp` or `skills stamp --bump initial` here**: a bare stamp refuses over an existing version and `--bump initial` resets it to 1.0.
   The legacy version must come through unchanged. Re-run `cg skills state` and verify `source` is now
   `scribe.config.json` and `version`/`last_update` equal what you showed. If `scribe.config.json` did
   not exist, the write created it holding only `project` and `skills`; say so — `create-concept-skills`
   fills in the rest. Leave `.claude/concept-skills.json` in place (the CLI never deletes it); once the
   block carries both fields it is ignored, and the user may delete it.

3. **Find the agents** (no legacy file, or its list should change):

   ```bash
   cg skills agents-discover
   ```

   It prints the project's `.claude/agents/*.md` agents plus, with Maestro, `agents_available` from
   `.claude/maestro.json`. Show the list and ask which should get `agents/<agent>.md` notes inside each
   concept skill (default all; empty means no agent notes). If the block already has an `agents` list,
   show it and keep it unless the user wants changes. Apply with `cg skills agents-set <name>...`.

4. **Maestro, only if it is there.** If `.claude/maestro.json` exists, ask whether the scribe agent
   should load `code-graph:scribe` so documentation placement follows the concept-skill rules and the
   gap channel keeps working. On yes, tell the user where: in the Maestro desktop app, open the
   workflow view, select the scribe instance and add the skill. **Do not edit `maestro.json`.**

5. **Offer the list.** `create-concept-skills` runs `extract`, so for a repo with a `tsconfig` do the
   deps check of step 7 first: an unreadable deps dir fails `extract` with a ts-morph error that
   `deps install` cannot fix. Then run `cg skills state`. `{"present":false}` → offer
   `create-concept-skills` now (it also writes `scribe.config.json`); if declined, say it can be run
   any time. A list already recorded → point at `update-concept-skills`. A repo with no `tsconfig` is
   fine: concept skills and their staleness tracking work without a graph.

6. **Keep the store out of git.** The graph store is `scribe-output/graph.db` (plus `-shm`/`-wal`),
   or the `dbPath` in `scribe.config.json` when set. Ignore the database files only, never the whole
   `scribe-output/` directory: the `.ast.json` / `.enriched.json` beside it are how a graph is shared.
   Read `${CLAUDE_PROJECT_DIR:-.}/.gitignore` (missing is empty) and, per pattern not already covered
   by an existing line, append it: `scribe-output/graph.db*` (or `<dbPath>*` relative to the config's
   directory). Skip the step when a line already ignores it; a re-run must add nothing.

7. **Graph dependencies (only for projects with TypeScript concepts).** The graph commands need
   `ts-morph`, which the plugin does not bundle. Run `cg deps status` (before any `extract`; step 5
   points here). If `ts-morph` shows `not loadable` or a deps dir shows `unreadable`, the dir exists
   but this session cannot read it: **do not offer `deps install`** (it would not help). Tell the user
   the absolute path(s) the advice line names to add to `sandbox.filesystem.allowRead`, and go to
   **Sandbox read access** below. If `ts-morph` shows `missing`, tell the user that `cg deps install`
   downloads it from the npm registry into the plugin's own directory (not the project), and offer to
   run it. `deps install` downloads from the npm registry,
   which the sandbox usually blocks, so tell the user to run it in their own shell (`! code-graph deps
   install`, or `node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" deps install`). If it resolves
   (plugin or project), do nothing for the install.
   Skip the whole step for a repo with no `tsconfig` or only docs-only concepts.

   **Sandbox read access.** Read `sandbox.enabled` in `~/.claude/settings.json` and the project's
   `.claude/settings.json` / `.claude/settings.local.json` (missing is empty). Only when it is true and
   `cg deps status` reports `ts-morph` not loadable, not visible or missing (the sandbox can deny
   `~/.cache` even after a successful `deps install`), offer to add the absolute path(s) named in
   `deps status`' advice line (with no advice line, the absolute `<XDG_CACHE_HOME|~/.cache>/code-graph`
   that `deps install` writes under) to `sandbox.filesystem.allowRead`. Say it is a lasting
   settings change and add it only on the user's yes. Default to the user settings
   (`~/.claude/settings.json`, since the cache is per user); offer `.claude/settings.local.json` as the
   alternative. Edit the JSON with Edit, merging into an existing `allowRead` array, and skip it when the
   path is already there (a re-run adds nothing). Skip this when the sandbox is not enabled.

8. **Report** in a few lines: whether the plugin was newly enabled, whether a legacy file was migrated
   (and the version it carried), the agents recorded, and the next command. Tell the user to restart
   Claude Code (or run `/reload-plugins`) if the plugin's skills do not show up straight away.
