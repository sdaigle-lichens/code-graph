# Concept-skills layer 1 in the code-graph CLI, shipped as a bundled plugin script

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

code-graph gains the language-agnostic concept-skill layer that maestro's concept-skills plugin has today, so any repo (Terraform included) can keep versioned concept SKILL.md files without the graph. Port maestro's concept-skills marker/version library (`~/gits/maestro/packages/concept-skills/src/{concept-skills,fs-scan}.ts` plus the needed helpers from its `@repo/claude-fs`: frontmatter metadata parsing and skill-dir reading) into a new skills module inside the code-graph package, inlined with no dependency on maestro. It covers: the marker (`metadata: { type: concept-skill, version: "major.minor", last-update: <sha> }`, byte-compatible so maestro's existing stamped skills are picked up unedited), version parsing and minor/major bumps, nested `.claude/skills` discovery, and byte-preserving idempotent stamping. The repo-level state (`version`, `last_update`, `agents[]`) moves from `.claude/concept-skills.json` into a `skills` block in `scribe.config.json`, reading the legacy file as a fallback. New CLI group: `skills list [--json]`, `skills state`, `skills stamp`, `skills check` (concepts without a SKILL.md, marked skills without a concept — allowed, they are docs-only — and path mismatches), and `skills status --json` reporting git freshness per concept (version, last-update, commits since last-update over the concept's globs). Ship it as a committed esbuild bundle `plugin/scripts/code-graph.cjs` (model: maestro's `packages/concept-skills/scripts/build-plugin-lib.mjs`) with a generated-do-not-edit header and a turbo task. `typescript` and `ts-morph` are external: graph commands resolve them from the target project via `createRequire(<project>/package.json)` and fail with a clear 'install dependencies first' message when absent. Layer-1 code paths must load neither those nor `node:sqlite`, so `skills *` runs on any supported Node and never prints the experimental-sqlite warning (it would leak into `!` skill injections). The global dev binary keeps working.

## Acceptance criteria

- [ ] Ported unit tests pass from the root (`pnpm build && pnpm test`), including byte-identical idempotent stamping and nested `.claude` discovery
- [ ] On a scratch copy of ~/gits/maestro, `node plugin/scripts/code-graph.cjs skills list --json` matches `node plugins/concept-skills/scripts/concept-skills.cjs list --json` id for id and version for version
- [ ] `skills state` reads the legacy `.claude/concept-skills.json` when `scribe.config.json` has no `skills` block, and `skills stamp` writes the block
- [ ] `skills list/check/status` produce no stderr warning and never load node:sqlite, typescript or ts-morph
- [ ] A graph command run from the bundle in a project without typescript installed exits with a clear install-dependencies message
- [ ] Bundle size reported and well under 1 MB; `just eval` still green

## Blocked by

None — can start immediately

## Post-Mortem

- **Problem:** First @reviewer pass FAILED (persistence): `stampConceptSkill` rejoined CRLF frontmatter with `\n`, so CRLF SKILL.md files got mixed line endings and no-op re-stamps rewrote the file. The bug was inherited verbatim from maestro's implementation; the port copied it, and @test pinned it as a todo instead of failing. Needed a @backend loop-back plus a second @test pass.
  **Fix:** none
- **Problem:** The `backend` workflow puts all test writing on @test, but the task's first acceptance criterion is "ported unit tests pass", so @backend could not meet it alone and handed it off; the human review saw an unmet criterion.
  **Fix:** none
- **Problem:** @scribe ended without a `HANDOFF:` line; routed as success from its report.
  **Fix:** none
