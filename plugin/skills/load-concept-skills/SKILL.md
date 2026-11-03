---
name: load-concept-skills
description: "Loads the project's concept-skill list via the bundled code-graph CLI and reports whether one exists. A building block another skill calls from its own step — not invoked directly by the user."
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" skills list)
user-invocable: false
---

# Load Concept Skills

Runs the project's concept-skill list and hands the raw result back to whichever skill called this
one. What to do with an empty list is the caller's decision, not this skill's.

## Load the list

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" skills list`

## Report back to the caller

State plainly, before doing anything else, which case applies:

- **Empty output, `No concept skills found.`, `[shell command execution disabled by policy]`, or a
  message saying none were found** — this project has no concept-skill list. Report **NO LIST**.
- **A populated list** — report **LIST**, and hand the list (names, versions, paths) back to the
  caller unchanged.

Then continue with whatever the calling skill's next step says to do with that result.
