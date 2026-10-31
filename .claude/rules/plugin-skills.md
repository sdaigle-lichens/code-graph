---
paths:
  - "plugin/skills/**"
---

# plugin/skills

Concept-skill flows shipped with the plugin. Each calls only
`node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs"`. Rules when editing them:

- Every flow must work with no tsconfig: graph steps (`catalog`, `extract`, `apply`, `drift`) are
  skipped and staleness comes from `skills status`' git-diff window.
- Repo-level `skills stamp` without `--bump` **refuses** over an existing version (1.0 only when none exists). Create = `--bump initial`,
  update = `--bump minor`, single-skill deepening = `--bump major`; install's migration of
  `.claude/concept-skills.json` uses `skills agents-set` (seeds the block, version untouched).
- `scribe` is the only scribe skill (enrichment lives in it). Keep its gap-channel contract
  (`.claude/channels/scribe/<agent>.1.md` with `{ "skill_gaps": [{ "skill", "missing" }] }`) verbatim:
  maestro depends on it. The format is pinned by `plugin/contracts/skill-gaps.example.json` and a test.
  Maestro vendors `plugin/contracts/skill-gaps.{example,schema}.json` into its test fixtures (copied at
  0.3.20) and never reads them from here. Any change under `plugin/contracts/` must be called out in
  that version's release note to maestro's manager, with the old and new shape. A breaking change (a
  renamed or removed field, or a new required one) keeps accepting the old shape for one version so
  maestro can follow.
- The plugin ships no hooks and adds no session context (the graph-context SessionStart hook was removed
  in 0.3.x, ticket 054): `plugin/hooks/` must not exist. `code-graph-retrieval` stays user-run
  (`disable-model-invocation: true`); do not reintroduce anything that steers sessions to the graph before grep.
- Nothing developer-facing (`CLAUDE.md`, `.claude/`) may live under `plugin/`; `pnpm check` fails on it.
