Always return a JSON report at the end of your work. Output it as a fenced `json` code block:

```json
{
  "subagent": "backend",
  "verdict": "SUCCESS | FAIL",
  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },
  "description": "<summary of what was implemented>",
  "preHandoffChecks": [{ "command": "<exact command run>", "result": "pass | fail | n/a" }],
  "testHints": "<channel file you wrote your test hints to, or 'none: no later @test step'>"
}
```

## Test hints

Test hints never go in this report. When your injected context names a channel file for `test` (a direct route, or test hints because @test runs later in this workflow), write your hints there in the shape it gives and name that path in `testHints`; otherwise `testHints` is `none: no later @test step`. They are hints, not @test's scope: do not try to list everything @test should cover, and do list in `notHandled` every case you deliberately left open.

List every pre-handoff check you ran in `preHandoffChecks`, copied verbatim with its result, and mark one `n/a` only when it does not apply to your change. Run the project's own static check yourself before handing off, through the project's own recipe or script rather than the raw tool under it; do not leave it to the test agent.

If a skill you loaded was missing something you had to work out from the code yourself, write `.claude/channels/<scope>/scribe/backend.1.md` (`<scope>` is the channel scope named in your injected context) with a fenced `json` block: `{ "skill_gaps": [{ "skill": "<skill-id>", "missing": "<what it did not tell you>" }] }`. Leave it unwritten when nothing was missing — do not write a gap just to fill the file.

Your `"verdict"` and your final `HANDOFF:` line must agree. A real defect must end with the matching condition-edge label when the workflow has one. A verdict of FAIL with `HANDOFF: success` is invalid, and so is ending with no `HANDOFF:` line — the orchestrator is told about both and never treats either as success.