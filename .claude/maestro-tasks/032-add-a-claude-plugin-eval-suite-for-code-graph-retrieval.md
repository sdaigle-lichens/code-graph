# Add a `claude plugin eval` suite for the code-graph-retrieval flow

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The user wants an official `claude plugin eval` suite (docs: code.claude.com/docs/en/plugin-evals.md) for
the plugin's `code-graph-retrieval` skill. Maestro's manager handed this over to this repo. A first,
free-standing eval session finished step 0; this ticket restarts the work as a worker and picks up at
step 1.

**Settled already (don't re-ask):**
- Flow: `code-graph-retrieval`, one flow per suite. The first case's slug is `smoke`.
- Step 0 inventory: the plugin has 14 skills and the `/graph` command, no MCP server (no `.mcp.json`
  anywhere under `plugin/`) and no README in `plugin/`.
- The suite measures the quality difference between with-plugin and without-plugin runs, not token
  savings: the result JSON only carries `costUsd` and `durationSeconds`.

**Interview:** run `claude plugin eval init smoke` from inside this session. It prints an interview
script; follow it one step per turn from step 1 (define quality). Every approval gate in it (quality
spec, inputs, graders) is the user's answer in this tab, not the manager's.

**Fixture (a graph must exist before Claude starts):**
- Each run starts in an empty workspace with only the plugin loaded: no project `.claude/`, CLAUDE.md
  or skills.
- Build a small TypeScript fixture with `scribe.config.json` (two or three concepts with globs) and a
  concept SKILL.md per concept.
- Commit each `<concept>.ast.json`, generated once with a real `extract` in this repo and never written
  by hand: `apply` validates it with `AstDocSchema.parse`. Keep `meta.files`. Re-extract whenever the
  fixture source changes.
- The setup step runs only `apply` (no ts-morph or tsconfig needed, but it needs `node:sqlite`, so
  Node >= 22.5, else exit 8). It must not run `extract`, which needs ts-morph that an empty workspace
  won't have and never downloads.
- `.gitignore` already keeps `plugin/evals/**/scribe-output/` (except `graph.db*`) and ignores
  `**/evals/results/`.

**Format (open, settle in the pilot):** maestro's manager read the docs as a `case.yaml` with
`context.scaffold_script`: it runs only with `--scaffold`, for at most 120 s, and may create files and
git state only. The first eval session saw `evals/NN-slug/prompt.md` with frontmatter plus
`graders/*.md`. Follow what the init script says, and confirm how a setup step is expressed.

**Cases:**
- At least two positive cases where the right answer needs the graph. One should be a "how does X
  work" that should pick `search`; one should be a "what breaks if I change Y" that should pick
  `query impact`.
- One negative case with no `scribe.config.json`: the skill should not fire, or should say there is no
  graph.
- Graders check the command chosen, the answer's grounding in the fixture, and exit-code handling
  where a case triggers 6 or 7.

**Pilot:** the user runs it with `!` (`claude` isn't on the sandbox PATH; add `--trust-plugin` with
`--json`). The first pilot should print `CLAUDE_PLUGIN_ROOT` and `node --version` from the setup step.
If `CLAUDE_PLUGIN_ROOT` is empty there, use a path relative to the eval directory. The skill itself
calls `node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs"`, which Claude Code expands for plugin
skills.

**Housekeeping:**
- Run every session from the repo root, never from `plugin/`. A session started in `plugin/` creates
  `plugin/.claude/`, and `pnpm check` (check-plugin-clean) fails on it.
- Version 0.3.25 is already bumped in all three files, with the bundle regenerated and the `.gitignore`
  rules in place, all uncommitted. They ship with this ticket; don't bump again.

Out of scope: a token-savings A/B (`claude -p --output-format json`); evals for any other skill or for
`/graph`; changes to the retrieval skill itself (report weaknesses the pilot shows as findings instead).

## Acceptance criteria

- [ ] The quality spec, inputs and graders were each approved by the user at the interview's gates
- [ ] `plugin/evals/` holds the fixture (source, `scribe.config.json`, SKILL.md files, committed `.ast.json` files) and at least three cases: two positive (search, impact) and one negative (no config)
- [ ] The setup step builds the graph with `apply` only; the pilot output shows a non-empty `CLAUDE_PLUGIN_ROOT` (or the fallback path used) and Node >= 22.5
- [ ] A user-run pilot completes with results in `evals/results/` (gitignored); the report gives pass/fail per case for both arms, plus `costUsd` and `durationSeconds`
- [ ] The report states which format the eval uses (`case.yaml` or `prompt.md`) and how setup is expressed
- [ ] `pnpm check` (with no `plugin/.claude/`), package tests and `just eval` (7/7) are green; `claude plugin validate` passes; still version 0.3.25

## Blocked by

None.
