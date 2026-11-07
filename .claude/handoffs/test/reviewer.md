```json
{
  "tests_added": ["<test name — what it verifies>"],
  "results": ["<pass/fail summary>"],
  "commands_run": ["<exact command> => <exit code, N passed / N failed>"],
  "negative_control": ["<new test> - <how it was shown to fail without the fix or against the broken behaviour, or 'not demonstrated'>"],
  "real_path_exercised": ["<what ran for real: process, window, filesystem, CLI; or 'unit only'>"],
  "coverage_gaps": ["<behavior still untested, or 'none'>"],
  "files_touched": ["<list, or 'none'>"]
}
```