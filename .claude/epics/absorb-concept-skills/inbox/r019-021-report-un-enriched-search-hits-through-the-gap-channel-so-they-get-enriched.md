# Report r019: 021-report-un-enriched-search-hits-through-the-gap-channel-so-they-get-enriched.md

- Task: 021-report-un-enriched-search-hits-through-the-gap-channel-so-they-get-enriched.md
- Written: 2026-10-19T14:45:43.862Z
- From session: Un-enriched search hits reporting

Outcome: 021 done (uncommitted in the main checkout). Workflow backend: @backend, human review (approved), @test, @reviewer, @scribe all SUCCESS.

Changes:
- Plain-text search (formatSearch) ends a hit with no or empty purpose in " — _not enriched_"; --json is unchanged. There are 4 tests in search.test.ts.
- code-graph-retrieval: agents append one "enrich only" skill_gaps entry for un-enriched hits the answer used. Each entry has at most 5 vertices and one skill, and entries are deduped per session by (skill, vertex). All existing gap-file rules are kept, and the wording says the SKILL.md is not to be revised.
- update-single-concept-skill: a gap made only of "enrich only" entries goes straight to the "Only a reported gap to close" branch: enrich targets --vertex (inline within 020's 20-target rule), merge, a spot-check, apply. There is no research pass, no SKILL.md edit and no skills stamp. A gap that mixes both kinds runs the full pass. The scribe skill says the same.
- The gap-channel contract text is unchanged. The version is 0.3.14 in all three files and the bundle is regenerated (identical after an uncached rebuild).
- Docs: .claude/skills/code-graph-search/SKILL.md and docs/usage.md describe the marker and the enrich-only flow.

Verification: pnpm check and typecheck pass, code-graph tests 325/325, desktop tests 114/114, just eval 7/7.
Not run: claude plugin validate (claude CLI not on PATH in the sandbox). Root pnpm test fails only because turbo drops TMPDIR, so tsx tries /tmp/tsx-1000 and the sandbox refuses it.

Findings and suggested tickets:
- Optional: make turbo pass TMPDIR through (e.g. globalPassThroughEnv) so root pnpm test works in the sandbox.
- Minor: the scribe SKILL.md writes --vertex <name> while update-single step 8 writes --vertex <key>. Both work, but the wording could be aligned.
- The scribe subagent's first HANDOFF line was free text instead of "success". It was corrected on resume.
