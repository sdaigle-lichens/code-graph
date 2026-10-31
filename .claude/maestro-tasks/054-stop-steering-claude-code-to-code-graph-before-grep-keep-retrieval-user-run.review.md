## Goal
Stop the plugin steering sessions to the code graph before grep; keep retrieval available on demand as a user-run skill and the /graph command.

## Done
- Deleted the SessionStart hook (`plugin/hooks/graph-context.cjs`, `hooks.json`) and its guard test; sessions get no code-graph context line.
- `code-graph-retrieval` skill: `disable-model-invocation: true`, description reworded as user-run.
- Reworded `/graph` command, scribe skill, `docs/installation.md`, `docs/usage.md` and `docs/development.md` to describe retrieval as on demand.
- Plugin evals: retired `skill-fired` (01-04) and the unprompted-CLI graders (`chose-*` 01-04, `cli-ran` 05); inverted `skill-fired` to `skill-not-fired` in 06-08. Answer-quality and no-graph graders are kept.
- `docs/evals.md`: new decision section (2026-10-30) with the 041, 043, 044 and 051 evidence.
- Version 0.3.28 to 0.3.29 in the three files; bundle regenerated (one-line version change).

## Deviations
- `pnpm build`, `pnpm check` and `pnpm test` could not run in the sandbox (lockfile read blocked). Ran `check-versions`, `check-plugin-clean`, `ensure-dist` and the `src/skills/*.test.ts` tests directly (191 pass, 1 skipped).
- Plugin evals (`claude plugin eval`) were not run.
- `docs/implementation/phase-9.md` and `phase-10.md` still mention the skill (historical plans, left alone).
- `just eval` equivalent (`code-graph eval`) is 7/7.

## Decisions
- Deleted the hook outright instead of making it emit nothing.
- Kept the consumer's CLAUDE.md block in `docs/installation.md` as an explicit opt-in.
- Dropped the `plugin/hooks/**` path from the `plugin-skills.md` rule frontmatter.

## Touches
- `plugin/hooks/` (removed), `plugin/skills/code-graph-retrieval`, `plugin/skills/scribe`, `plugin/commands/graph.md`, plugin evals, `plugin/scripts/code-graph.cjs` (generated)
- `packages/code-graph/src/skills` (guard test removed), `.claude/rules/plugin-skills.md`
- `docs/installation.md`, `docs/usage.md`, `docs/development.md`, `docs/evals.md`
- Three version manifests

## Sibling impact
None known. The CLI, extract/apply, concept-skill flows and /graph behavior are unchanged.

## Questions
None.
