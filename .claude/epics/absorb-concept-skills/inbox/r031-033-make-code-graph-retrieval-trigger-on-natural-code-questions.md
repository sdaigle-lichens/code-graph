# Report r031: 033-make-code-graph-retrieval-trigger-on-natural-code-questions.md

- Task: 033-make-code-graph-retrieval-trigger-on-natural-code-questions.md
- Written: 2026-10-26T00:14:36.985Z
- From session: absorb-concept-skills-033

Outcome: 033 implemented, uncommitted, version 0.3.26. Review PASS.
Cause: agent opens with Grep/git ls-files, never consults skill list; runs seeing scribe.config.json read skills/<concept>/SKILL.md directly. Old description led with "Query the code-graph database" and mentioned the config only last.
Fix: description rewritten around question shapes and the scribe.config.json signal; inert SessionStart hook (plugin/hooks/graph-context.cjs, silent without config, one additionalContext line, exit 0, no writes), 3 tests. Docs updated.
Checks: pnpm check, 483 package tests, just eval 7/7, plugin validate pass.
NOT MET: the user-run 2-run pilot (Skill/Bash counts per case, both arms, vs 0/7 baseline; 06-neg-no-config) has not been run. Ticket marked done before that evidence exists.
Finding: Bash calls in eval sessions failed with apply-seccomp setgroups errors; the CLI path may stay at 0 regardless of wording.
Suggested: keep a follow-up to record pilot results before 034.
