# Report r023: 025-bring-the-scribe-s-default-load-back-near-its-pre-merge-size-and-stop-budget-leaks.md

- Task: 025-bring-the-scribe-s-default-load-back-near-its-pre-merge-size-and-stop-budget-leaks.md
- Written: 2026-10-21T13:33:16.582Z
- From session: maestro-27239325

Outcome: task 025 done in worktree task-025 (uncommitted, unmerged). All four parts implemented, version 0.3.18, bundle regenerated. Package tests 383 pass, pnpm check 6/6, just eval 7/7.
- scribe SKILL.md 16666 -> 8958 B; enrichment procedure in plugin/skills/scribe/enrichment.md.
- search --json: gaps compacted (one line per gap concept; the double listing came from overlapping concepts/fixable/thinCores/unenrichable buckets), trimmed before hits, dropped.gaps added, floor ~150 tokens. N=400 on 16 concepts <= 1600 B (tested).
- skills status --summary added (tested <= 8 KB); update flows use it.
- FTS_FORMAT=2 in new meta table; search rebuilds once on missing/older format; tested.
Findings: (1) a truly read-only graph.db fails earlier in bootstrapStore (same on HEAD), so the 'run code-graph reindex' hint only shows for lock/busy write failures; documented. (2) 'unwritable' is also returned on a busy lock, message can mislead. (3) claude plugin validate NOT run (claude not on PATH in sandbox). (4) root pnpm test fails in sandbox on mkdir; package tests run directly pass. (5) Worktree needed node_modules symlink and a copied enriched.json for eval.
Suggested follow-ups: skip schema writes on read-only stores in bootstrapStore; run extract+apply for edited concept skills after merge.
