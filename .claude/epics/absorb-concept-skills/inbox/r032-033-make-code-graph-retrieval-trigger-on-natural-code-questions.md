# Report r032: 033-make-code-graph-retrieval-trigger-on-natural-code-questions.md

- Task: 033-make-code-graph-retrieval-trigger-on-natural-code-questions.md
- Written: 2026-10-26T00:24:50.206Z
- From session: absorb-concept-skills-033

Follow-up to r031: the user-run 2-run pilot of 0.3.26 is in (7 cases, mean delta 0.00, $4.09).
Skill fired in 8/8 runs of the 4 positive cases where it is graded (baseline 0/7). Bash CLI used in 8/10 positive runs; cross-store-reminders fired the skill but ran 0 Bash (likely the 034 gap).
neg-no-config and neg-literal pass with the skill not firing. Seccomp failures did not block Bash.
Findings: all scores 1.00 in both arms, so the cases do not show benefit; the says-no-graph grader in 06 fails all votes despite correct behaviour (not scored, not changed).
Results table recorded in docs/evals.md. Pilot criteria for 033 are now met; full 3-run suite after 034.
