# Report r001: 003-concept-skills-layer-1-in-the-code-graph-cli-shipped-as-a-bundled-plugin-script.md

- Task: 003-concept-skills-layer-1-in-the-code-graph-cli-shipped-as-a-bundled-plugin-script.md
- Written: 2026-10-14T02:54:32.697Z

# Task 003 — concept-skills layer 1 in the code-graph CLI: DONE (uncommitted)

## Outcome
All 6 acceptance criteria verified by @reviewer (second pass):
- 227/227 tests (ported maestro concept-skills/frontmatter/state tests + new real-file CLI/report tests), typecheck + check green.
- `skills list --json` from `plugin/scripts/code-graph.cjs` matches maestro's `concept-skills.cjs list --json` on a scratch copy: 17/17 ids and versions.
- `skills state` falls back to `.claude/concept-skills.json`; `skills stamp` writes the `skills` block in `scribe.config.json` (legacy file never written).
- `skills list/check/status/state`: zero stderr, never load node:sqlite / typescript / ts-morph (lazy imports in cli.ts).
- Bundle graph commands in a project without typescript exit 1 with an "install dependencies first" message.
- Bundle 456 KiB (minified, deterministic); `just eval` 5/5.
Built: `packages/code-graph/src/skills/` (+ version.ts, project-deps.ts), `code-graph skills list|state|stamp|check|status|agents|agents-discover|agents-set`, `scripts/build-plugin.mjs`, turbo `bundle` task (root `pnpm build` now runs `build bundle`). Docs: CLAUDE.md, docs/usage.md, development.md, installation.md.

## Findings / post-mortem
- First review FAILED on CRLF stamping (bug inherited from maestro's stampConceptSkill); fixed with a backend loop-back, now covered by 3 CRLF tests. Maestro itself still has this bug.
- @backend cannot write tests, so the "ported tests pass" criterion is unmeetable before @test in the backend workflow.
- @scribe returned no HANDOFF line.

## Suggested ticket changes
- 006 (dogfood/publish) or a maestro ticket: upstream the CRLF fix to maestro's concept-skills.
- Repo-level `skills stamp` without `--bump` resets version to 1.0 (maestro parity). Migration steps in 005/006 should pass `--bump minor`, or consider making `stamp` keep the existing version by default.
- Untested: mixed LF/CRLF SKILL.md; `skills status` passes stored sha into a git range unguarded (low risk). Possible small follow-up.
- Root `plan.md` is untracked; decide commit vs docs/implementation/.
- The global `code-graph` symlink is not on PATH on this machine; only `dist/cli.js` was verified.
