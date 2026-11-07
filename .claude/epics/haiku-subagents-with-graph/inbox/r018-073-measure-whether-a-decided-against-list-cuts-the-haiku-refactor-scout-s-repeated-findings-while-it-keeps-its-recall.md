# Report r018: 073-measure-whether-a-decided-against-list-cuts-the-haiku-refactor-scout-s-repeated-findings-while-it-keeps-its-recall.md

- Task: 073-measure-whether-a-decided-against-list-cuts-the-haiku-refactor-scout-s-repeated-findings-while-it-keeps-its-recall.md
- Written: 2026-11-06T22:45:34.750Z
- From session: haiku-subagents-with-graph-073

Updated report for 073 (replaces r017's missing-commit gap).

Commit: 76cb516 (bench code, stored list bench/refactor/decided-against.json, tests, pre-registration, README). Full `pnpm verify` green on it: 14/14 tasks, 244 bench tests. The measured commit is filled into docs/evals.md in 00c1949 (docs only, one line). docs/report.md was left out of both commits, as were the unrelated .claude changes.

No paid run was started. The user still needs to run `--init-check` (claude is not on PATH in the sandbox), then the pilot and the paid run, with the commands in bench/README.md.
