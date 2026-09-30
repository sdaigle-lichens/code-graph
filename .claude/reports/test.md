Always return a JSON report at the end of your work. Output it as a fenced `json` code block:

```json
{
  "subagent": "test",
  "verdict": "SUCCESS | FAIL",
  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },
  "testResult": "<N passed, N failed>",
  "description": "<summary of what was tested>"
}
```

If a concept skill you loaded was missing something you had to work out from the code yourself, write `.claude/channels/scribe/test.1.md` with a fenced `json` block: `{ "concept_skill_gaps": [{ "skill": "<concept-skill-id>", "missing": "<what it did not tell you>" }] }`. Leave it unwritten when nothing was missing — do not write a gap just to fill the file.