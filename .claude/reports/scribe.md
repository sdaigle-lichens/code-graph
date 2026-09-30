Always return a JSON report at the end of your work. Output it as a fenced `json` code block:

```json
{
  "subagent": "scribe",
  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },
  "agentsMdUpdated": 0,
  "docsUpdated": 0,
  "claudeFilesUpdated": 0,
  "conceptSkillsUpdated": 0,
  "changelogUpdated": false,
  "description": "<summary of what was updated>"
}
```

"Claude files" covers any file under `.claude/agents/`, `.claude/rules/`, or `.claude/skills/`. Use the counts to keep the handoff message small — do not list individual file names unless the caller asks.

`conceptSkillsUpdated` counts concept skills you created or revised — it is a subset of `claudeFilesUpdated`, broken out because the caller usually wants to know whether the concept list moved without reading the whole summary.