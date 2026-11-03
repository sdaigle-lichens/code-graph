# Stop steering Claude Code to code-graph before grep, keep retrieval user-run

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

User decision (2026-10-30, epic haiku-subagents-with-graph): the plugin stops pushing sessions to use the code graph instead of grep and read, but graph retrieval stays available on demand. Evidence: on Haiku edit tasks (tickets 044 and 051) the graph gave no gain, Haiku never called the CLI, and even pasted best-case graph output tied the no-graph arm (100/120); on Opus read-only questions (041) the graph did not cut cost. The counterpoint, kept by leaving retrieval available by hand: on Haiku read-only questions (043) the shipped plugin scored 107/108 against 91/108 without the graph.

Changes, covering code, tests, skill files, evals, docs and release steps:
- The plugin's SessionStart hook no longer adds the context line telling sessions to load the retrieval skill before grepping. Remove the hook and its registration, or make it emit nothing; update or remove its guard test and the project rule that describes the hook.
- The code-graph-retrieval skill stays in the plugin but is no longer invoked by the model on its own: it becomes a user-run skill, with frontmatter and description reworded to match.
- Follow-on wording: the /graph command's reference to the skill's answer-first handling, the scribe skill's mentions, and the user and developer docs (usage, installation, development) describe retrieval as on demand. Plugin evals that grade whether the retrieval skill fired are retired or inverted per eval so the suite matches the new behavior.
- Record the decision and its evidence in the evals doc.
- Bump the version in the package, the plugin manifest and the marketplace manifest together; regenerate the committed plugin bundle if any package source changes.

Unchanged: the concept-skill flows (create, update, explore, load, scribe; explore-concept-skills still queries the graph when another skill calls it), the code-graph CLI, extract and apply, and the /graph command itself. No paid bench run.

## Acceptance criteria

- [ ] A session started in a project with scribe.config.json receives no code-graph context line from the plugin.
- [ ] The code-graph-retrieval skill is not model-invoked (its frontmatter disables model invocation) and can still be run by the user.
- [ ] No plugin skill, command or doc tells sessions to use the graph before grep or read by default; the /graph command and the CLI still work.
- [ ] Plugin evals no longer expect the retrieval skill to fire by itself; each affected eval is retired or inverted, and the change is listed in the ticket's report.
- [ ] The hook guard test and the project rule describing the hook are updated or removed to match.
- [ ] docs/evals.md records the decision with the 041, 043, 044 and 051 evidence.
- [ ] The three version files are bumped together, pnpm check passes (or, in the sandbox, check-versions and check-plugin-clean pass when run directly), package tests pass, and the bundle is regenerated if package source changed.
- [ ] just eval stays 7/7.

## Blocked by

None — can start immediately
