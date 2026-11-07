# Report r017: 073-measure-whether-a-decided-against-list-cuts-the-haiku-refactor-scout-s-repeated-findings-while-it-keeps-its-recall.md

- Task: 073-measure-whether-a-decided-against-list-cuts-the-haiku-refactor-scout-s-repeated-findings-while-it-keeps-its-recall.md
- Written: 2026-11-06T22:44:24.456Z
- From session: haiku-subagents-with-graph-073

Outcome: task 073 built and reviewed. Nothing is committed yet, so the measured-commit hash in docs/evals.md is unfilled.

Verified state: uncommitted working tree on branch haiku-subagents-with-graph (no commit exists for this work). On it, node --test bench/*.test.mjs gave 244 pass, 0 fail; pnpm check --force gave 6/6 tasks; the 073 and 071 dry runs and both prep --check runs passed. No paid run was started.

Built: opt-in haiku-decided-against scout arm paired against haiku-metrics-primer. Set 073 has 5 cases (f-r5, f-s5, f-c2, f-l1, f-l3). f-l2 is excluded because no list entry touches it. The hand-built list holds 14 entries in bench/refactor/decided-against.json. Pre-registration is in docs/evals.md (Ticket 073). Pilot and paid commands are in docs/evals.md and bench/README.md.

Findings: @test added a planted-tree test. A reviewer note that the dry-branch `else if (!a.decided)` is redundant was checked by @scribe and is not redundant. The handoff line from @backend carried a stray quote, which the hook flagged; I treated it as success.

Follow-ups: commit the list and new bench files before any paid run, then fill in the measured commit. Run `--init-check` (needs claude on PATH), then the pilot, then the paid run. Recording the results is a separate ticket. docs/report.md is an unrelated untracked file.
