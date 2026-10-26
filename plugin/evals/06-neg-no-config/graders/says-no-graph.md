---
type: llm
weight: 0.5
arm: with-only
focus: last_message
---

PASS if the answer states or clearly implies that this project is not set up for the code graph (no scribe.config.json, no graph or concepts configured, so graph search is unavailable), or that it read the source directly because no graph exists.
FAIL if the answer says nothing about a graph being unavailable or the project not being set up for it.
