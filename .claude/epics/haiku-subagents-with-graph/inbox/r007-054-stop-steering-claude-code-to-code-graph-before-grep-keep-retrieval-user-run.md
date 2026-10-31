# Report r007: 054-stop-steering-claude-code-to-code-graph-before-grep-keep-retrieval-user-run.md

- Task: 054-stop-steering-claude-code-to-code-graph-before-grep-keep-retrieval-user-run.md
- Written: 2026-10-30T22:41:09.702Z
- From session: haiku-subagents-with-graph-054

## Outcome
Ticket 054 done. The SessionStart hook is deleted, code-graph-retrieval is user-run (disable-model-invocation), the docs/evals/rules are updated, and the version is bumped to 0.3.29 with the bundle regenerated. Manager review m006 was on-track; @test, @reviewer and @scribe all passed.

## Plugin eval changes
- Retired: `skill-fired` in 01-04; `chose-search` (01), `chose-impact` (02), `chose-cross` (03), `chose-search-or-concept` (04); `cli-ran` (05).
- Inverted: `skill-fired` in 06-08 became `skill-not-fired` (max 0).
- Kept: the answer-quality, grep-followed, did-not-build-graph, says-no-graph, graph-cli-not-used and used-grep graders.

## Not run (the user runs these from a plain terminal before shipping)
- The plugin evals (`claude plugin eval`): 06-08 inverted to skill-not-fired, the rest retired.
- `pnpm check`, `pnpm build`, `pnpm test` (the sandbox blocks the pnpm lockfile read). Run directly instead: check-versions, check-plugin-clean, ensure-dist, `src/skills/*.test.ts` (191 pass, 1 skipped) and `code-graph eval` (7/7 on 0.3.29).

## Findings
- The opt-in "query the graph first" CLAUDE.md block stays in docs/installation.md as the consumer's own choice.
- /graph now inlines the answer-first steps, since the model can no longer load the skill.
- Older Cases and pilot sections of docs/evals.md still describe the trigger-based suite and are flagged as history. docs/implementation/phase-9.md and phase-10.md are untouched.
- No automated guard asserts that `plugin/hooks` is absent; only the rule text covers it.

## Post-mortem
Clean session, nothing to record. Commit and merge stay with the user.
