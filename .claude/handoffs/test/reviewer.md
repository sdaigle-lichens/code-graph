```json
{
  "tests_added": ["<test name — what it verifies>"],
  "test_origin": {
    "from_hints": ["<test name>"],
    "independent": ["<test name> - <source: acceptance criterion | file:line code path | failure mode not in hints>"]
  },
  "acceptance_coverage": ["<acceptance criterion> => <test names, or 'untested: <reason>'>"],
  "hints_skipped": ["<implementer hint> - <reason>, or 'none'"],
  "results": ["<pass/fail summary>"],
  "commands_run": ["<exact command> => <exit code, N passed / N failed>; include the project's own format, lint and type checks and the tests you report, every one run AFTER your last edit — re-run them if you edited anything since, never report an earlier run>"],
  "verified_tree": "<the tree those commands ran against: the commit, or the working tree state (e.g. uncommitted changes on top of a commit) — and confirm no file was edited after the runs>",
  "negative_control": ["<new test> - <how it was shown to fail without the fix or against the broken behaviour, or 'not demonstrated'>"],
  "real_path_exercised": ["<what ran for real: process, window, filesystem, CLI; or 'unit only'>"],
  "coverage_gaps": ["<behavior still untested, or 'none'>"],
  "known_gaps": ["<issue> - <owner: a later step such as @scribe, or 'after commit'> - <why it is not a failure now>, or 'none'"],
  "files_touched": ["<list, or 'none'>"]
}
```