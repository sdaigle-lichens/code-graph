# Harden the unattended concept-skill update run

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Follow-ups from task 078's review, all on the unattended update path (the headless run the Stop hook starts and the runner that installs its staged files). Needs code (CLI refusals, runner rollback, the code-graph git wrapper) and tests:

1. CLI-side refusals when running unattended (the CODE_GRAPH_UNATTENDED marker, or whatever 078 uses to mark the headless run): `enrich prune --yes`, `delete-concept --yes` and a `--root` outside the run's project exit non-zero with one stderr line naming the refusal, and write nothing. Today only skill text stops them, and a pruned enriched file is unrecoverable. The same commands keep working in a normal session.

2. Rollback of a created concept: when a run adds a concept and then fails (extract, apply or install), the runner restores the SKILL.md today but leaves the concept declared in scribe.config.json. Roll the declaration back too, so a failed run leaves the config as it found it.

3. `code-graph git` strips the GIT_* configuration environment (at least GIT_EXTERNAL_DIFF, GIT_CONFIG_COUNT / GIT_CONFIG_KEY_* / GIT_CONFIG_VALUE_*, GIT_CONFIG_PARAMETERS, GIT_CONFIG_GLOBAL / GIT_CONFIG_SYSTEM, GIT_PAGER) before running git, so the environment can't make a read-only git command run another program.

4. Widen the update-run.test.ts pin so that no plain `git diff|log|show` instruction is left on the unattended path (skills and prompts it reads); all of them go through `code-graph git`.

Includes rebuilding the committed plugin bundle and bumping the version in the three version files.

## Acceptance criteria

- [ ] Under the unattended marker, enrich prune --yes, delete-concept --yes and a --root outside the project each exit non-zero with one stderr line and change no file; tests cover each, and the same commands still work without the marker
- [ ] A run that adds a concept and then fails leaves scribe.config.json and the SKILL.md as they were before the run; a test covers it
- [ ] code-graph git runs git with the GIT_* configuration variables removed; a test sets GIT_EXTERNAL_DIFF and shows it is not run
- [ ] The update-run test fails if any plain git diff|log|show instruction appears on the unattended path
- [ ] Version bumped in the three version files together; pnpm build, pnpm check and pnpm test are green, plugin/scripts/code-graph.cjs regenerated, just eval stays 7/7

## Touched surfaces

- packages/code-graph/src/scribe/update-run.ts, update-staging.ts and their tests
- packages/code-graph/src/scribe/enrich.ts, delete-concept.ts (refusals)
- packages/code-graph/src/cli.ts (code-graph git, --root check)
- plugin/skills/update-concept-skills/SKILL.md (only if a plain git instruction remains)
- plugin/scripts/code-graph.cjs (generated bundle)
- packages/code-graph/package.json, plugin/.claude-plugin/plugin.json, .claude-plugin/marketplace.json (version)

## Blocked by

None — can start immediately
