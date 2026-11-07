Always return a JSON report at the end of your work. Output it as a fenced `json` code block:

```json
{
  "subagent": "backend",
  "verdict": "SUCCESS | FAIL",
  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },
  "description": "<summary of what was implemented>",
  "testTargets": {
    "behaviors": [
      {
        "behavior": "<behavior you changed>",
        "failureModes": ["<empty/closed input | missing file | stale generated copy | edge input | ...>"],
        "files": ["<files the tests must touch>"]
      }
    ],
    "preHandoffChecks": [
      { "command": "<exact command run>", "result": "pass | fail | n/a" }
    ]
  }
}
```

## Test targets (mandatory)

The report feeds the backend -> test handoff, so the `testTargets` section is required, never omitted. For each behavior you changed, name the failure mode to test (empty or closed input, missing file, stale generated copy, edge input) and the files the tests must touch. List every pre-handoff check you ran, copied verbatim with its result, and mark one `n/a` only when it does not apply to your change. You must run the project's own static check yourself before handing off; do not leave it to the test agent.

If a skill you loaded was missing something you had to work out from the code yourself, write `.claude/channels/<scope>/scribe/backend.1.md` (`<scope>` is the channel scope named in your injected context) with a fenced `json` block: `{ "skill_gaps": [{ "skill": "<skill-id>", "missing": "<what it did not tell you>" }] }`. Leave it unwritten when nothing was missing — do not write a gap just to fill the file.

Your `"verdict"` and your final `HANDOFF:` line must agree. A real defect must end with the matching condition-edge label when the workflow has one. A verdict of FAIL with `HANDOFF: success` is invalid, and so is ending with no `HANDOFF:` line — the orchestrator is told about both and never treats either as success.