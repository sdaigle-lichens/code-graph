---
name: code-graph-update
description: "Checks that this project's code-graph setup is current: the plugin is enabled, any legacy .claude/concept-skills.json is migrated into scribe.config.json, the agents list is up to date, the ts-morph deps dir is readable from the session, and the concept-skill list is not behind HEAD. Repairs the setup and points at update-concept-skills for the content. Use when the user runs /code-graph-update or after updating the code-graph plugin."
disable-model-invocation: true
---

# Code Graph Update

Bring the project's code-graph **setup** up to date. This skill never researches or rewrites concept
skills; that is `update-concept-skills`.

Every CLI call is `node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" …` (written `cg`), each alone
in its own Bash call.

## User's intention

$ARGUMENTS

## Workflow

1. **Plugin enabled?** Read `${CLAUDE_PROJECT_DIR:-.}/.claude/settings.json`. If `enabledPlugins`
   lacks `"code-graph@code-graph": true` (or the marketplace name the plugin was installed from), say
   so and offer to add it exactly as `code-graph-install` step 1 does.

2. **State.** Run `cg skills state`.
   - `{"present": false}`: no list recorded. Offer `create-concept-skills`. If marked concept skills
     already exist (`cg skills list`), say `cg skills stamp --bump minor` records the list at the right
     version once they are reconciled; never invent a record and never stamp bare.
   - `source` is `.claude/concept-skills.json`: the legacy file is still the only record. Offer the
     migration of `code-graph-install` step 2 (`skills agents-set` with the same agents — version
     carried unchanged).

3. **Agents list.** Compare `cg skills agents` with `cg skills agents-discover`. Show any project
   agent not in the list and any listed agent that no longer exists. Ask before changing; apply with
   `cg skills agents-set <name>...`.

4. **Graph deps readable?** Only for a repo with a `tsconfig`, and before anything runs `extract`
   (`update-concept-skills` does). Run `cg deps status`:
   - `ts-morph: plugin …` or `project …`: fine.
   - `not loadable` (a deps dir `unreadable`) or `not visible`: the sandbox cannot read the deps dir,
     so `extract` would fail even though `deps install` already ran. Tell the user the absolute
     path(s) in the advice line to add to `sandbox.filesystem.allowRead` (offer the edit exactly as
     `code-graph-install` step 7 does), and do not suggest `deps install` for it.
   - `missing`: point at `code-graph-install` step 7 (`deps install` in the user's own shell).

5. **Freshness.** Run `cg skills status --summary`. `list.commits` is how far the list trails HEAD;
   each concept row shows its own `commits` and `files` count. This is a git-diff window over
   the concept globs, so it works with no tsconfig and no graph. Offer `update-concept-skills` when
   anything trails. Run `cg skills check --json` and mention concepts with no SKILL.md, path
   mismatches or unmarked skills.

6. **Report** what was checked, what was changed, and what is left for the user to decide.
