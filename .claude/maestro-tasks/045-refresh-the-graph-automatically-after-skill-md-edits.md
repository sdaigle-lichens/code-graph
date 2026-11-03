# Refresh the graph automatically after SKILL.md edits

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The scribe skill tells agents to run extract then apply after writing a concept's SKILL.md, but they skip it: in maestro's task 136 the scribe edited the plugin-libs-parity skill and never ran it, and a later apply on task-queue found 10 vertices stale from earlier unrecorded edits. A rule in a skill can be skipped; a hook cannot. Add a code-graph plugin hook that runs when a session or subagent stops (Stop / SubagentStop). For each concept declared in scribe.config.json whose SKILL.md body changed since its last apply, it runs extract then apply. Running at the end debounces several edits and covers SKILL.md edits by any agent or the main session, not only the scribe. The hook never approves renames: apply today stops at an interactive rename prompt, and --approve-drift recorded real renames as inserts plus archives (4 inserted, 2 archived on installing-maestro), losing enrichment. So the hook applies only clean cases and tells the session which concepts need a manual `apply <concept>` and why. This changes apply's contract (likely a non-interactive mode that defers renames instead of prompting, in the CLI source), so settle the design before implementing: how a changed SKILL.md is detected, the non-interactive apply behaviour, how the hook reports deferred concepts, and the hook's time budget, measured on a real repo with several concepts. Also in scope: tests for the hook and any new apply flag, the scribe skill text and docs/usage.md updated to say the hook now enforces the rule, regenerating the committed plugin bundle, and a version bump across the three version files.

## Acceptance criteria

- [ ] After a session or subagent stops having edited a concept's SKILL.md, that concept's graph is refreshed without anyone running extract or apply
- [ ] A concept whose apply would need a rename decision is not applied; the hook names it and says to run `apply <concept>` by hand, and no rename is ever recorded as an insert plus an archive
- [ ] apply can run non-interactively without blocking on the rename prompt, and its existing interactive behaviour is unchanged when that mode is not used
- [ ] A repo with no scribe.config.json, no concepts or no tsconfig is a silent no-op, and a stop with no changed SKILL.md does no extract or apply
- [ ] The hook's measured runtime on a multi-concept repo is recorded, and its timeout is set from it
- [ ] Tests cover the clean case, the deferred-rename case and the no-op cases; `pnpm build`, `pnpm check` and `pnpm test` pass, and `just eval` stays 7/7
- [ ] The scribe skill and docs/usage.md describe the hook; the version is bumped together in packages/code-graph/package.json, plugin/.claude-plugin/plugin.json and .claude-plugin/marketplace.json, and plugin/scripts/code-graph.cjs is regenerated

## Blocked by

None — can start immediately

## Post-Mortem

- **Problem:** Parallel worktree sessions share the main checkout's `.claude/channels/`. @backend overwrote an existing `test/backend.1.md`, and sibling 048's @test then received 045's payload. 045's payloads ended up as `scribe/backend.2.md` and `scribe/reviewer.2.md`, not the files the agents reported, so the orchestrator had to find them by grepping.
  **Fix:** none
- **Problem:** @backend edited `skill-refresh.ts` with a python rewrite script, against the guardrail to edit only with Edit/Write. The reviewer found no damage.
  **Fix:** none
- **Problem:** @scribe ran `refresh-skills` from the main checkout, because the shell starts there and `cd` is banned (ticket 056). That ran against the main checkout's config and store, not the worktree's, so the worktree's graph was never refreshed for the scribe-pipeline edit.
  **Fix:** none
- **Problem:** `.claude/rules/plugin-skills.md` still says `plugin/hooks/` must not exist, which this ticket makes false. @scribe's edit to it was refused (self-modification), so it needs a person to update it.
  **Fix:** none
- **Problem:** The SubagentStop hook flagged "no HANDOFF line" on @test's interim stop, while it was waiting on background work. Its final report did end with `HANDOFF: success`.
  **Fix:** none
