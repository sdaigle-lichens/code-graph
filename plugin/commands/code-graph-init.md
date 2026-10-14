---
description: One-time initialization — alias for the create-concept-skills skill (catalog-driven concepts, scribe.config.json, SKILL.md skeletons, graph build)
argument-hint: (no arguments)
---

# /code-graph-init

Initialize code-graph for this project. This is now an alias: invoke the `create-concept-skills`
skill (the former `code-graph-init` skill was merged into it), passing any arguments through.

```
/code-graph-init              ← you are here
  → create-concept-skills     catalog → proposal → scribe.config.json + SKILL.md skeletons → stamp 1.0
  → code-graph bootstrap, then per concept: extract → apply
  → update-single-concept-skill, then /scribe-enrich <concept>
```

If the project already has a concept-skill list, `create-concept-skills` stops and points at
`update-concept-skills`. To add one concept use `/add-concept [seed]`; to remove one,
`code-graph delete-concept <name>`. To enable the plugin in a project's settings and migrate a legacy
`.claude/concept-skills.json`, run `code-graph-install` first.

A project without a tsconfig is fine: the skill skips `catalog`, `extract` and `apply` and still
writes and stamps the concept skills.
