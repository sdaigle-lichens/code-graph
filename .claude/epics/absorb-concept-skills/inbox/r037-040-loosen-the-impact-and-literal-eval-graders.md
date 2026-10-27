# Report r037: 040-loosen-the-impact-and-literal-eval-graders.md

- Task: 040-loosen-the-impact-and-literal-eval-graders.md
- Written: 2026-10-27T14:29:38.926Z
- From session: absorb-concept-skills-040

Outcome: 040 done in worktree /home/superadmin/gits/code-graph-task-040 (branch task-040), uncommitted and unmerged. Changed plugin/evals/02-impact-movetask/graders/answer.md (extra real stale-doc mentions allowed; FAIL only for a missing or nonexistent caller), plugin/evals/07-neg-literal/graders/answer.md (paraphrased TODO text accepted at the three right locations; FAIL for a missing or nonexistent TODO) and a docs/evals.md note next to the Ticket 037 failure bullets.
Findings: by reasoning, both failing pilot answers (impact with-run 2, literal with-run 1) would now pass, and impact with-run 1 still passes. The fixture does contain the stale-doc files the impact answer named.
Caveats: `pnpm check` was NOT run (worktree has no node_modules; installs not allowed in the sandbox). Only prettier --check on the 3 files and check-versions.mjs passed. No live eval run of the new wording.
Suggested ticket changes: run `pnpm check` after merge; optionally a `--runs 1` eval limited to cases 02 and 07 to confirm.
