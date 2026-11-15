```json
{
  "hintsOnly": "Implementer hints, not the test scope. Derive your test plan from the ticket's acceptance criteria and the code first, then check these hints against it. They never narrow what you test: this list is biased toward what the implementer already handled, and the gaps are what it did not think of.",
  "filesChanged": ["<added|removed|renamed|modified> <path>, or 'none'"],
  "behaviors": [
    {
      "behavior": "<component/page — expected behavior>",
      "failureModes": ["<empty/loading/error state | invalid input | missing data | edge input | ...>"],
      "files": ["<source files the behavior lives in>"]
    }
  ],
  "notHandled": ["<case the implementation deliberately does not handle or left as an open decision, or 'none'>"],
  "howToRun": ["<the project's own recipe or script that runs the relevant tests with their environment, never the raw tool under it; or 'none: no tests for this part yet' — never a test framework, runner or structure to create>"],
  "preHandoffChecks": [{ "command": "<exact command run>", "result": "pass | fail | n/a" }]
}
```