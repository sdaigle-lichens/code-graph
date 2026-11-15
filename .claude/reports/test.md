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
  "acceptanceCoverage": [{ "criterion": "<ticket acceptance criterion>", "tests": ["<test name>"], "reason": "<required when tests is empty>" }],
  "testOrigin": {
    "fromHints": ["<test name>"],
    "independent": [{ "test": "<test name>", "source": "<acceptance criterion | file:line code path | failure mode not in hints>" }]
  },
  "hintsSkipped": [{ "hint": "<implementer hint>", "reason": "<one line>" }],
  "knownGaps": [{ "issue": "<what is not right yet>", "owner": "<later step, e.g. @scribe, or 'after commit'>", "reason": "<why it is not a failure of this step>" }],
  "notCaught": ["<one line per new test: what this test would NOT catch>"]
}
```

`gates` lists the exact verify commands you ran, copied verbatim with their result: the project test suite, lint, static check or typecheck, and any parity or generated-artifact check the change touches. Any of those you did not run goes in `gatesSkipped` with a reason. A verdict of SUCCESS is invalid if any of them was skipped without a stated reason.

Build your test plan from the ticket's acceptance criteria and the code (the diff and the modules it touches) before you read any implementer hints in your channel. The hints are neither the minimum nor the scope, and they never narrow your plan. Then compare: add a hint that names a real behavior, failure mode or `notHandled` case your plan missed; drop one you judge wrong or redundant and list it in `hintsSkipped` with the reason. Run tests through the project's own recipe or script (the hints' `howToRun` names it), never the raw tool under it.

A hint never makes you add a test framework, runner, config, folder structure or kind of test the project does not have yet. Work within the test setup that exists; a hint that only an absent setup could cover goes in `hintsSkipped` with that reason, so the user can decide whether to add one.

`acceptanceCoverage` maps every acceptance criterion to its tests, or gives the reason it has none. `testOrigin` splits your tests between those a hint suggested and those you found yourself, each with its source. Write the same three facts into the reviewer's handoff (`acceptance_coverage`, `test_origin`, `hints_skipped`).

FAIL only for a defect in the code or tests this task changed. Two things are never a FAIL, and go in `knownGaps` instead: work a LATER step on the workflow's success path owns (outdated README, CLAUDE.md or docs when @scribe runs after you; a review finding when @reviewer does), and a check that can only pass once the work is committed (for example a generated-file check that diffs against HEAD: compare the regenerated files to the working tree instead, and record the result). Write the same list into the reviewer's handoff as `known_gaps`.

For each new test you write, add one line to `notCaught` saying what that test would NOT catch, for example closed or empty input, a copy of a file that no test compares, or a missing feature rather than a wrong one.

If a skill you loaded was missing something you had to work out from the code yourself, write `.claude/channels/<scope>/scribe/test.1.md` (`<scope>` is the channel scope named in your injected context) with a fenced `json` block: `{ "skill_gaps": [{ "skill": "<skill-id>", "missing": "<what it did not tell you>" }] }`. Leave it unwritten when nothing was missing — do not write a gap just to fill the file.

Your `"verdict"` and your final `HANDOFF:` line must agree. A real defect must end with the matching condition-edge label when the workflow has one. A verdict of FAIL with `HANDOFF: success` is invalid, and so is ending with no `HANDOFF:` line — the orchestrator is told about both and never treats either as success.