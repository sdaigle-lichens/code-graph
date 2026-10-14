---
name: code-graph-update
description: "Checks that this project's code-graph setup is current: the plugin is enabled, any legacy .claude/concept-skills.json is migrated into scribe.config.json, the agents list is up to date, and the concept-skill list is not behind HEAD. Repairs the setup and points at update-concept-skills for the content. Use when the user runs /code-graph-update or after updating the code-graph plugin."
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

4. **Freshness.** Run `cg skills status --json`. `list.commitsSince` is how far the list trails HEAD;
   each concept row shows its own `commitsSince` and `filesChanged`. This is a git-diff window over
   the concept globs, so it works with no tsconfig and no graph. Offer `update-concept-skills` when
   anything trails. Run `cg skills check --json` and mention concepts with no SKILL.md, path
   mismatches or unmarked skills.

5. **Report** what was checked, what was changed, and what is left for the user to decide.
