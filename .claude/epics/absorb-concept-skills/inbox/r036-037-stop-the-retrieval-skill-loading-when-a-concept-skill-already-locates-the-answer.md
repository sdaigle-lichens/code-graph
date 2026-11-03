# Report r036: 037-stop-the-retrieval-skill-loading-when-a-concept-skill-already-locates-the-answer.md

- Task: 037-stop-the-retrieval-skill-loading-when-a-concept-skill-already-locates-the-answer.md
- Written: 2026-10-27T02:31:30.407Z
- From session: absorb-concept-skills-037

Outcome: 037 implemented and passed backend, human review, test, reviewer and scribe. Version 0.3.28 in all three files, bundle regenerated. pnpm check, pnpm test (492/492), just eval (7/7) and plugin validate are green.

Changes: retrieval skill description and "When NOT to use" skip the skill when a loaded concept skill names the file or symbol (kept for impact, cross, unknown location). SessionStart line carries the same qualifier; the hook stays inert. New eval case plugin/evals/08-skill-has-answer quotes the reminders concept skill in prompt.md. docs/evals.md has the case and the size table.

Offline sizes (chars/4): description 130 to 127 tokens; SKILL.md body 2422 to 2485; full file 2570 to 2630; SessionStart line 51 to 65.

Findings: the user-run pilot (2 runs, --keep-temp, cap 5 USD) has NOT been run. docs/evals.md has a PENDING block: check a kept trace for apply-seccomp first, then Skill calls per case and cost against the 0.3.27 pilot. Risk: "Use before Grep or Read" (dropped "first") may make smoke and locate load the skill less often; the pilot must confirm. The skill-fired grader is display-only, so "skill stayed out" is read from the trace. The SKILL.md body grew about 63 tokens; a body split (about 1k tokens saved, unmeasured) is proposed as a follow-up.

Suggested ticket changes: none beyond the pilot and the optional body-split follow-up.
