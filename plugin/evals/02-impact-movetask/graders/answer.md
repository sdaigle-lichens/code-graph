---
type: llm
focus: last_message
---

PASS if the answer lists the real callers of moveTask (defined in src/store/actions.ts around line 19): the useDragReorder handler in src/board/useDragReorder.ts (around line 13) AND the cross-concept caller notifyOverdue in src/reminders/notifications.ts (around line 20). It may also mention the drop path through Column and Board. It must not invent callers or files that do not exist.
FAIL if the answer misses either of the two real callers (useDragReorder and notifyOverdue), or lists callers, files or functions that do not exist in this project.
