---
paths:
  - "plugin/skills/**"
---

# plugin/skills

Concept-skill flows shipped with the plugin. Each calls only
`node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs"`. Rules when editing them:

- Every flow must work with no tsconfig: graph steps (`catalog`, `extract`, `apply`, `drift`) are
  skipped and staleness comes from `skills status`' git-diff window.
- Repo-level `skills stamp` without `--bump` resets to **1.0**. Create = `--bump initial`,
  update = `--bump minor`, single-skill deepening = `--bump major`; install's migration of
  `.claude/concept-skills.json` uses `skills agents-set` (seeds the block, version untouched).
- `scribe` is the only scribe skill (enrichment lives in it). Keep its gap-channel contract
  (`.claude/channels/scribe/<agent>.1.md` with `{ "skill_gaps": [{ "skill", "missing" }] }`) verbatim:
  maestro depends on it. The format is pinned by `plugin/contracts/skill-gaps.example.json` and a test.
  Maestro vendors `plugin/contracts/skill-gaps.{example,schema}.json` into its own test fixtures (copied
  at 0.3.20): any contract change must be sent to maestro's manager so it re-copies them.
- Nothing developer-facing (`CLAUDE.md`, `.claude/`) may live under `plugin/`; `pnpm check` fails on it.
