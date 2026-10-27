---
type: llm
focus: last_message
---

PASS if the answer lists the real callers of moveTask (defined in src/store/actions.ts around line 19): the useDragReorder handler in src/board/useDragReorder.ts (around line 13) AND the cross-concept caller notifyOverdue in src/reminders/notifications.ts (around line 20). It may also mention the drop path through Column and Board. It may also mention real docs, skills or generated files that would go stale (for example skills/*/SKILL.md or scribe-output/*.json); extra mentions of that kind are fine and are not invented callers.
FAIL only if the answer misses either of the two real callers (useDragReorder and notifyOverdue), or names a caller, file or function that does not exist in this project.
