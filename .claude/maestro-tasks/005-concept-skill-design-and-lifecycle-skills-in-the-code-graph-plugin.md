# Concept-skill, design and lifecycle skills in the code-graph plugin

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Port maestro's concept-skills plugin skills (`~/gits/maestro/plugins/concept-skills/skills/`) into code-graph's `plugin/skills/`, calling `node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs"` instead of `concept-skills.cjs`, and make them graph-aware where a graph exists: `create-concept-skills` (merged with `code-graph-init`: catalog drives the concept proposal, then writes config, SKILL.md and stamps; create = 1.0), `update-concept-skills` (driven by `skills status --json` / `drift --json`, then extract and apply, then enrich after a revision — `scribe-enrich` folds in here; update = minor bump), `update-single-concept-skill` (deepens from `query concept` / `impact`; major bump), `scribe` (the placement rule plus 'after writing a SKILL.md run extract + apply'), `cleanup-skill`, `load-concept-skills` (a `!` inject of `skills list`), `explore-concept-skills` (adds `search` / `query concept`), and the design skills `code-architecture-design` and `use-code-architecture-design-check` (explore step uses `query cross` / `impact`). Everything must still work in a repo with no tsconfig, falling back to the git-diff staleness window. Merge the existing `scribe-code-graph` skill into `scribe` so there is one scribe entry point. `add-concept` hands off to `update-single-concept-skill` instead of refusing to scaffold a SKILL.md. Keep the gap-channel contract in `scribe` verbatim: working agents write `.claude/channels/scribe/<agent>.1.md` with `{ "skill_gaps": [{ "skill", "missing" }] }`, delivered on the scribe's next start — maestro relies on it. Add `code-graph-install/update/uninstall`: install enables `code-graph@code-graph` in the project's `enabledPlugins` and migrates `.claude/concept-skills.json` into `scribe.config.json`; uninstall disables cleanly and leaves SKILL.md files in place. Note from the layer-1 work: repo-level `skills stamp` without `--bump` resets the version to 1.0 (maestro parity). The update flows must pass `--bump minor`, and install's migration of `.claude/concept-skills.json` must carry the legacy version over unchanged, never reset it. Write the update flow against the `drift --json` shape `{ concept, new[], changed[], stale[], missing[], renameCandidates[], doc: { bodyHashChanged } }`, which a parallel task implements. Also fix stale docs: `code-graph-retrieval` still says exit 2 means `code-graph up`; exit 3's meaning differs between `graph.md` and `usage.md`; marketplace.json (0.1.0) vs plugin.json (0.2.0); `usage.md` skips step 3 and lacks `catalog` / `delete-concept`; refresh `docs/usage.md`, `docs/installation.md` and `CLAUDE.md` for the skills layer.

## Acceptance criteria

- [ ] All listed skills exist under plugin/skills with valid frontmatter and call only the bundled CLI
- [ ] Only one scribe skill ships, and it contains the gap-channel contract verbatim
- [ ] `add-concept` no longer refuses to scaffold a SKILL.md
- [ ] Install on a scratch project enables the plugin and migrates a legacy `.claude/concept-skills.json`; uninstall disables it and leaves SKILL.md files untouched; the migrated `skills` block keeps the legacy version
- [ ] Every skill flow documents its no-tsconfig path
- [ ] Exit-code docs agree across CLAUDE.md, usage.md, graph.md and code-graph-retrieval

## Blocked by

- `003-concept-skills-layer-1-in-the-code-graph-cli-shipped-as-a-bundled-plugin-script.md`
