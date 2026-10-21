Always return a JSON report at the end of your work. Output it as a fenced `json` code block:

```json
{
  "subagent": "scribe",
  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },
  "agentsMdUpdated": 0,
  "docsUpdated": 0,
  "claudeFilesUpdated": 0,
  "changelogUpdated": false,
  "description": "<summary of what was updated>"
}
```

"Claude files" covers any file under `.claude/agents/`, `.claude/rules/`, or `.claude/skills/`. Use the counts to keep the handoff message small — do not list individual file names unless the caller asks.

End your final message with these plain-text lines, in this order:

1. `SKILL_GAPS_HANDLED: <file>, <file>, …` — only when you acted on skill-gap reports from `.claude/channels/scribe/`. Name every gap file you acted on, including one handled by enrichment only, one with a remainder left to enrich, and one with no graph to enrich. A gap file you do not name stays in your channel for the next scribe run.
2. `HANDOFF: <label>` — always last. `HANDOFF: success` when the documentation is done, even if you skipped a step (a graph refresh skipped for lack of a tsconfig, targets left to enrich): report skipped steps in the report body, never through the label. `done` or `complete` is not a label — no workflow routes it. When you could not finish, end with a condition label from your injected routes when one fits, else `HANDOFF: partial` with the reason in the body: the orchestrator's unrouted check stops there and asks the user.