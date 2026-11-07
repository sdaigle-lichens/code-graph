Always return a JSON report at the end of your work. Output it as a fenced `json` code block:

```json
{
  "subagent": "test",
  "verdict": "SUCCESS | FAIL",
  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },
  "testResult": "<N passed, N failed>",
  "description": "<summary of what was tested>",
  "gates": [{ "command": "<exact command run>", "result": "<exit code, N passed / N failed>" }],
  "gatesSkipped": [{ "command": "<command not run>", "reason": "<why>" }],
  "notCaught": ["<one line per new test: what this test would NOT catch>"]
}
```

`gates` lists the exact verify commands you ran, copied verbatim with their result: the project test suite, lint, static check or typecheck, and any parity or generated-artifact check the change touches. Any of those you did not run goes in `gatesSkipped` with a reason. A verdict of SUCCESS is invalid if any of them was skipped without a stated reason.

The implementing agent's "Test targets" are the minimum, not the scope: cover every one, then add your own adversarial cases that it did not name, and list in `notCaught` what neither side covered.

For each new test you write, add one line to `notCaught` saying what that test would NOT catch, for example closed or empty input, a copy of a file that no test compares, or a missing feature rather than a wrong one.

If a skill you loaded was missing something you had to work out from the code yourself, write `.claude/channels/<scope>/scribe/test.1.md` (`<scope>` is the channel scope named in your injected context) with a fenced `json` block: `{ "skill_gaps": [{ "skill": "<skill-id>", "missing": "<what it did not tell you>" }] }`. Leave it unwritten when nothing was missing — do not write a gap just to fill the file.

Your `"verdict"` and your final `HANDOFF:` line must agree. A real defect must end with the matching condition-edge label when the workflow has one. A verdict of FAIL with `HANDOFF: success` is invalid, and so is ending with no `HANDOFF:` line — the orchestrator is told about both and never treats either as success.